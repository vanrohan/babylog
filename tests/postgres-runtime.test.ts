import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {PostgresDatabase} from '../src/server/postgres.ts';

const connection=process.env.TEST_DATABASE_URL;
if(!connection)throw new Error('Set TEST_DATABASE_URL to an isolated test Postgres database.');
const enabled={timeout:5000};
async function fixture(t:TestContext,queryTimeout:number,transactionTimeoutMs=15_000){
 const schema='babylog_runtime_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:connection,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new Pool({connectionString:connection,max:1,query_timeout:3000,options:`-c search_path=${schema}`});
 pool.on('connect',client=>{
  const query=client.query.bind(client);
  client.query=((...args:any[])=>{
   if(typeof args[0]==='string'&&args[0].startsWith('SELECT pg_sleep')){
    const config={text:args[0],values:args[1],query_timeout:queryTimeout};return query(config);
   }
   return (query as (...input:any[])=>unknown)(...args);
  }) as typeof client.query;
 });
 const database=new PostgresDatabase(pool,{transactionTimeoutMs});
 t.after(async()=>{await database.close();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
 await database.query('CREATE TABLE runtime_records(id INTEGER PRIMARY KEY)');
 return {admin,pool,database};
}
async function backendGone(admin:Pool,pid:number){
 const deadline=Date.now()+2000;
 while(Date.now()<deadline){
  if((await admin.query('SELECT COUNT(*) AS count FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0].count==='0')return;
  await delay(10);
 }
 assert.fail('The failed transaction backend remains open.');
}

test('Postgres query timeout discards the connection without committing or retrying writes',enabled,async t=>{
 const {database,admin}=await fixture(t,40);let pid=0,attempts=0;
 await assert.rejects(database.transaction(async()=>{
  attempts++;pid=(await database.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await database.query('INSERT INTO runtime_records VALUES (1)');
  await database.query('SELECT pg_sleep(0.2)');
 }),/Query read timeout/);
 await backendGone(admin,pid);assert.equal(attempts,1);
 assert.equal((await database.query('SELECT COUNT(*) AS count FROM runtime_records')).rows[0].count,'0');
 const next=await database.transaction(async()=>{
  await database.query('INSERT INTO runtime_records VALUES (2)');
  return (await database.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 });
 assert.notEqual(next,pid);assert.equal((await database.query('SELECT COUNT(*) AS count FROM runtime_records')).rows[0].count,'1');
});

test('Postgres server closes an idle transaction while application work waits',enabled,async t=>{
 const {database,admin,pool}=await fixture(t,1000,80);let pid=0;
 const expired=new Promise<Error>(resolve=>pool.on('acquire',client=>client.once('error',resolve)));
 await assert.rejects(database.transaction(async()=>{
  pid=(await database.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await database.query('INSERT INTO runtime_records VALUES (1)');
  assert.match((await expired).message,/idle-in-transaction timeout/);
  await database.query('SELECT 1');
 }),/unavailable|terminated|not queryable/);
 await backendGone(admin,pid);
 assert.equal((await admin.query('SELECT COUNT(*) AS count FROM pg_locks WHERE pid=$1',[pid])).rows[0].count,'0');
 assert.equal((await database.query('SELECT COUNT(*) AS count FROM runtime_records')).rows[0].count,'0');
 await database.transaction(async()=>{await database.query('INSERT INTO runtime_records VALUES (2)');});
 assert.equal((await database.query('SELECT COUNT(*) AS count FROM runtime_records')).rows[0].count,'1');
});

test('Postgres server statement timeout bounds transaction queries independently of the client timeout',enabled,async t=>{
 const {database}=await fixture(t,1000,60);
 await assert.rejects(database.transaction(async()=>{
  await database.query('INSERT INTO runtime_records VALUES (1)');await database.query('SELECT pg_sleep(0.2)');
 }),/statement timeout/);
 assert.equal((await database.query('SELECT COUNT(*) AS count FROM runtime_records')).rows[0].count,'0');
});

test('Postgres cloud pooling creates a new client after each release',enabled,async t=>{
 const database=new PostgresDatabase(connection!,{freshConnections:true});t.after(()=>database.close());
 assert.equal(database.pool.options.max,1);assert.equal(database.pool.options.maxUses,1);
 assert.equal(database.pool.options.query_timeout,10_000);assert.equal(database.pool.options.keepAlive,true);
 const first=await database.pool.connect();const firstPid=(await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;first.release();
 const second=await database.pool.connect();try{
  const secondPid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.notEqual(first,second);assert.notEqual(firstPid,secondPid);
 }finally{second.release();}
});

test('Postgres transaction timeout rejects invalid settings before opening a pool',()=>{
 for(const transactionTimeoutMs of [0,-1,1.5,NaN,Infinity,2_147_483_648])assert.throws(()=>new PostgresDatabase('postgres://invalid',{transactionTimeoutMs}),/positive transaction timeout/);
 const database=new PostgresDatabase('postgres://invalid');assert.equal(database.pool.options.max,3);assert.equal(database.pool.options.idleTimeoutMillis,10_000);return database.close();
});

test('Postgres refuses commit when application work catches a query timeout',enabled,async t=>{
 const {database,admin}=await fixture(t,40);let pid=0,attempts=0,caught=false;
 await assert.rejects(database.transaction(async()=>{
  attempts++;pid=(await database.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await database.query('INSERT INTO runtime_records VALUES (1)');
  try{await database.query('SELECT pg_sleep(0.06)');}
  catch(error){assert.match((error as Error).message,/Query read timeout/);caught=true;}
  return 'The caller cannot make this transaction commit.';
 }),/database connection is unavailable/);
 assert.equal(caught,true);assert.equal(attempts,1);await backendGone(admin,pid);
 assert.equal((await database.query('SELECT COUNT(*) AS count FROM runtime_records')).rows[0].count,'0');
});
