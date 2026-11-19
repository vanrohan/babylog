import {after} from 'node:test';
import {randomUUID} from 'node:crypto';
import type {PostgresStore} from '../src/server/postgres-store.ts';
import {assistantOperations,currentSleepTarget} from '../src/server/assistant.ts';
import {AppError} from '../src/server/schema.ts';
import {createTestDiary} from './test-diary.ts';
export {createTestDiary,testDatabaseUrl,testAuth} from './test-diary.ts';

type Fixture=Awaited<ReturnType<typeof createTestDiary>>;
const fixtures=new Map<string,Fixture>();
after(async()=>{for(const fixture of fixtures.values())await fixture.close();fixtures.clear();});
export async function testStore(name?:string){
 const key=name??randomUUID(),existing=fixtures.get(key);
 if(existing)return existing.open();
 const fixture=await createTestDiary();fixtures.set(key,fixture);return fixture.store;
}

export async function testAssistantOperations(input:unknown,store:PostgresStore,sideEvidence?:string,taskVersions?:ReadonlyMap<string,number>){
 const entries=await store.listEntries();
 return assistantOperations(input,{getEntry:(id:string)=>{
  const entry=entries.find(entry=>entry.id===id);if(!entry)throw new AppError('Entry not found.',404);return entry;
 }},sideEvidence,taskVersions);
}
export async function testCurrentSleepTarget(store:PostgresStore,commands:string){
 const entries=await store.listEntries();return currentSleepTarget({listEntries:()=>entries},commands);
}
export async function failEntryWrites(store:PostgresStore,name:string,operation:'INSERT'|'UPDATE'|'DELETE',message:string,predicate=''){
 if(!/^[a-z_]+$/.test(name))throw new Error('Use a simple test trigger name.');
 await store.database.query(`CREATE FUNCTION ${name}_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${message.replaceAll("'","''")}'; END $$;
 CREATE TRIGGER ${name} BEFORE ${operation} ON entries FOR EACH ROW ${predicate?`WHEN (${predicate})`:''} EXECUTE FUNCTION ${name}_failure();`);
}
