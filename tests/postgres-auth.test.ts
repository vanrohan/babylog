import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDatabase} from '../src/server/postgres.ts';
import {PostgresStore} from '../src/server/postgres-store.ts';
import {PostgresHouseholdAuth} from '../src/server/postgres-auth.ts';
import {createApp} from '../src/server/app.ts';
import {loginAttemptKey,loginAttemptWindowMs,LoginRateLimitError} from '../src/server/login-policy.ts';

const connection=process.env.TEST_DATABASE_URL;
if(!connection)throw new Error('Set TEST_DATABASE_URL to an isolated test Postgres database.');
const enabled={};
const credentials={username:'household',password:'Synthetic Postgres password 123'};
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');

async function fixture(t:TestContext){
 const schema='babylog_auth_test_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:connection,max:1});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const databases=[0,1].map(()=>new PostgresDatabase(new Pool({connectionString:connection,max:2,options:`-c search_path=${schema}`})));
 const stores=databases.map(database=>new PostgresStore(database));
 t.after(async()=>{await Promise.all(databases.map(database=>database.close()));await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
 await stores[0].initialize();
 const auth=databases.map(database=>new PostgresHouseholdAuth(database,credentials));
 return {databases,stores,auth};
}

test('Postgres concurrent unchanged startup preserves independent sessions',enabled,async t=>{
 const {databases,stores,auth}=await fixture(t);
 await Promise.all(auth.map(accounts=>accounts.initialize()));
 assert.equal(auth[0].user!.id,auth[1].user!.id);
 const one=await auth[0].login('HOUSEHOLD',credentials.password,'first');
 const two=await auth[1].login(credentials.username,credentials.password,'second');
 assert.notEqual(one.token,two.token);
 await Promise.all(auth.map(accounts=>accounts.initialize()));
 assert.equal((await auth[1].session(one.token))?.id,one.user.id);
 const metadata=(await databases[0].query('SELECT * FROM household_auth')).rows;
 assert(!JSON.stringify(metadata).includes(credentials.password));
 const sessions=(await databases[0].query('SELECT * FROM household_sessions')).rows;
 assert(!JSON.stringify(sessions).includes(one.token));assert(!JSON.stringify(sessions).includes(two.token));
 await auth[1].logout(one.token);
 assert.equal(await auth[0].session(one.token),null);assert(await auth[0].session(two.token));
 assert.equal(await auth[0].session(two.token,Date.now()+31*86400_000),null);
});

test('Postgres credential changes reject old instances and missing setup closes access',enabled,async t=>{
 const {databases,stores,auth}=await fixture(t);await auth[0].initialize();
 const one=await auth[0].login(credentials.username,credentials.password,'first');
 const replacement={...credentials,password:'  Replacement exact password 456  '};
 const changed=new PostgresHouseholdAuth(databases[1],replacement);await changed.initialize();
 assert.notEqual(changed.user!.id,one.user.id);
 assert.equal(await changed.session(one.token),null);assert.equal(await auth[0].session(one.token),null);
 await assert.rejects(auth[0].login(credentials.username,credentials.password,'first'),/setup changed/);
 await assert.rejects(changed.login(replacement.username,replacement.password.trim(),'second'),/incorrect/);
 const current=await changed.login(replacement.username,replacement.password,'second');
 const renamed=new PostgresHouseholdAuth(databases[0],{...replacement,username:'new-household'});await renamed.initialize();
 assert.equal(await changed.session(current.token),null);
 const renamedSession=await renamed.login('new-household',replacement.password,'first');
 for(const missing of [{username:'',password:''},{...replacement,password:''},{...replacement,username:''}]){
  const closed=new PostgresHouseholdAuth(databases[1],missing);await closed.initialize();
  assert.equal(closed.user,null);assert.equal(await closed.session(renamedSession.token),null);
  await assert.rejects(closed.login(credentials.username,credentials.password,'first'),/incomplete/);
 }
 assert.equal((await databases[0].query('SELECT * FROM household_sessions')).rowCount,0);
});

test('Postgres concurrent failed logins commit attempt limits across instances and expire correctly',enabled,async t=>{
 const {databases,auth}=await fixture(t);await Promise.all(auth.map(accounts=>accounts.initialize()));
 const now=Date.now();
 const session=await auth[0].login(credentials.username,credentials.password,'device',now);
 const failures=await Promise.allSettled(Array.from({length:20},(_,index)=>auth[index%2].login(index%2?'HOUSEHOLD':'unknown_'+index,'wrong','address_'+index,now)));
 for(const failure of failures)assert.equal(failure.status,'rejected');
 assert.equal(failures.filter(result=>result.status==='rejected'&&result.reason.status===401).length,10);
 assert.equal(failures.filter(result=>result.status==='rejected'&&result.reason.status===429).length,10);
 const attempts=(await databases[1].query('SELECT count FROM household_login_attempts WHERE key=$1',[loginAttemptKey])).rows[0];
 assert.equal(attempts.count,10);
 await assert.rejects(auth[1].login(credentials.username,credentials.password,'shared-address',now),error=>(error as {status:number}).status===429);
 await assert.rejects(auth[0].login(credentials.username,credentials.password,'other-address',now+60_000),error=>error instanceof LoginRateLimitError&&error.retryAfter===840);
 assert(await auth[1].session(session.token,now+60_000));
 const restarted=new PostgresHouseholdAuth(databases[1],credentials);await restarted.initialize();
 await assert.rejects(restarted.login(credentials.username,credentials.password,'new-address',now+loginAttemptWindowMs-500),error=>error instanceof LoginRateLimitError&&error.retryAfter===1);
 assert((await restarted.login(credentials.username,credentials.password,'shared-address',now+loginAttemptWindowMs)).token);
 assert.equal((await databases[0].query('SELECT * FROM household_login_attempts WHERE key=$1',[loginAttemptKey])).rowCount,0);
});

test('Postgres successful login does not refill the shared failed-attempt budget',enabled,async t=>{
 const {databases,auth}=await fixture(t);await Promise.all(auth.map(accounts=>accounts.initialize()));
 const now=Date.now();
 for(let i=0;i<4;i++)await assert.rejects(auth[i%2].login('unknown_'+i,'wrong','address_'+i,now),/incorrect/);
 assert((await auth[1].login(credentials.username,credentials.password,'device',now+1)).token);
 const attempt=(await databases[0].query('SELECT count,"resetAt" FROM household_login_attempts WHERE key=$1',[loginAttemptKey])).rows[0];
 assert.equal(attempt.count,4);assert.equal(Number(attempt.resetAt),now+loginAttemptWindowMs);
 for(let i=4;i<10;i++)await assert.rejects(auth[i%2].login('unknown_'+i,'wrong','address_'+i,now+2),/incorrect/);
 await assert.rejects(auth[0].login(credentials.username,credentials.password,'device',now+3),LoginRateLimitError);
});

test('Postgres HTTP instances share records, reject stale writes, and sign out only one device',enabled,async t=>{
 const {databases,stores,auth}=await fixture(t);await Promise.all(auth.map(accounts=>accounts.initialize()));
 const servers=stores.map((store,index)=>createApp(store,undefined,auth[index]).listen(0,'127.0.0.1'));
 t.after(async()=>{await Promise.all(servers.map(server=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))));});
 await Promise.all(servers.map(server=>once(server,'listening')));
 const origins=servers.map(server=>{const address=server.address();assert(address&&typeof address==='object');return `http://127.0.0.1:${address.port}/api`;});
 async function request(index:number,path:string,method='GET',body?:unknown,cookie=''){
  const response=await fetch(origins[index]+path,{method,headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return {response,data:await response.json()};
 }
 async function login(index:number){const result=await request(index,'/auth/login','POST',credentials);assert.equal(result.response.status,200);return result.response.headers.get('set-cookie')!.split(';')[0];}
 assert.equal((await request(0,'/entries')).response.status,401);assert.equal((await request(1,'/export')).response.status,401);
 const one=await login(0),two=await login(1);
 const created=await request(0,'/entries','POST',{activity:'feeding',feedingType:'Bottle',startAt:'2026-11-18T10:00:00.000Z',status:'active',notes:'Shared record.'},one);
 assert.equal(created.response.status,201);
 const entry=created.data;assert.equal((await request(1,'/entries','GET',undefined,two)).data[0].id,entry.id);
 const completed=await request(1,'/entries/'+entry.id,'PUT',{...entry,endAt:'2026-11-18T10:20:00.000Z',status:'completed'},two);
 assert.equal(completed.response.status,200);assert.equal(completed.data.version,2);
 assert.equal((await request(0,'/entries/'+entry.id,'PUT',{...entry,notes:'Old draft.'},one)).response.status,409);
 assert.equal((await request(0,'/auth/logout','POST',{},one)).response.status,200);
 assert.equal((await request(1,'/entries','GET',undefined,one)).response.status,401);
 assert.equal((await request(0,'/entries','GET',undefined,two)).response.status,200);
 await databases[0].query('UPDATE household_sessions SET "expiresAt"=$1 WHERE hash=$2',[Date.now()-1,hash(two.slice('babylog_session='.length))]);
 assert.equal((await request(1,'/entries','GET',undefined,two)).response.status,401);
 assert.equal((await request(0,'/auth/session','GET',undefined,two)).data.user,null);
 const replacement=new PostgresHouseholdAuth(databases[1],{...credentials,password:'Replacement HTTP password 456'});await replacement.initialize();
 assert.equal((await request(0,'/auth/login','POST',credentials)).response.status,503);
});
