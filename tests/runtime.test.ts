import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime,type RuntimeInput} from '../src/server/runtime.ts';
import {PostgresDatabase} from '../src/server/postgres.ts';
import {config,assistantAvailable,transcriptionAvailable} from '../src/server/settings.ts';
import {createTestDiary} from './test-diary.ts';

const input:RuntimeInput={databaseUrl:'postgres://unused',host:'127.0.0.1',port:0,publicOrigin:'https://babylog.example',timeZone:'Europe/Berlin',username:'household',password:'Synthetic runtime password 123'};
async function fixture(){
 const diary=await createTestDiary();
 const connection=new URL(process.env.TEST_DATABASE_URL!);
 const schema=(await diary.database.query('SELECT current_schema() AS name')).rows[0].name;
 connection.searchParams.set('options',`-c search_path=${schema}`);
 return {...diary,databaseUrl:connection.href};
}

test('Compute runtime uses the supplied diary and enables OpenRouter transcription with a server key',async t=>{
 const diary=await fixture();t.after(()=>diary.close());
 config.sttUrl='http://old-test-service.invalid';config.ttsUrl='http://old-test-service.invalid';
 const runtime=await createRuntime({...input,databaseUrl:diary.databaseUrl,openrouterKey:'  synthetic-key  ',model:'provider/model'});
 t.after(()=>runtime.store.close());
 const saved=await runtime.store.createEntry({activity:'bath',startAt:'2026-11-18T12:00:00Z'});
 assert.equal((await diary.store.getEntry(saved.id)).id,saved.id);
 assert.equal(assistantAvailable(),true);assert.equal(config.openrouterApiKey,'synthetic-key');assert.equal(config.model,'provider/model');
 assert.equal(config.sttUrl,'');assert.equal(config.ttsUrl,'');
 assert.equal(config.sttModel,'qwen/qwen3-asr-0.6b');assert.equal(transcriptionAvailable(),true);
 assert.equal(config.publicOrigin,input.publicOrigin);assert.equal(config.timeZone,'Europe/Berlin');
 assert((await runtime.auth.login(input.username,input.password,'synthetic-device')).token);
});

test('Compute runtime keeps missing login configuration closed and hides an absent Assistant',async t=>{
 const diary=await fixture();t.after(()=>diary.close());
 const runtime=await createRuntime({...input,databaseUrl:diary.databaseUrl,username:'',password:'',openrouterKey:'   '});
 t.after(()=>runtime.store.close());
 assert.equal(runtime.auth.user,null);assert.equal(assistantAvailable(),false);assert.equal(transcriptionAvailable(),false);assert.equal(config.model,'deepseek/deepseek-v4.1-flash-1017');
 await assert.rejects(runtime.auth.login(input.username,input.password,'synthetic-device'),/incomplete/);
 assert.equal(await runtime.auth.session('unknown'),null);
});

test('Compute runtime rejects invalid connection, origin, and timezone before opening a diary',async()=>{
 await assert.rejects(createRuntime({...input,databaseUrl:' '}),/Postgres connection/);
 for(const publicOrigin of ['http://outside.invalid','https://name:password@example.invalid','https://example.invalid/path','https://example.invalid/?query=1','https://example.invalid/#fragment']){
  await assert.rejects(createRuntime({...input,publicOrigin}));
 }
 await assert.rejects(createRuntime({...input,timeZone:'Unknown/Zone'}),RangeError);
});

test('Compute runtime closes the database pool when authentication initialization fails',async t=>{
 const diary=await fixture();t.after(()=>diary.close());
 const original=PostgresDatabase.prototype.close;let closed=0;
 t.mock.method(PostgresDatabase.prototype,'close',async function(this:PostgresDatabase){closed++;return original.call(this);});
 await assert.rejects(createRuntime({...input,databaseUrl:diary.databaseUrl,username:'invalid user'}));
 assert.equal(closed,1);
 assert.equal(Number((await diary.database.query('SELECT COUNT(*) AS count FROM entries')).rows[0].count),0);
});
