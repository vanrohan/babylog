import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDatabase} from '../src/server/postgres.ts';
import {PostgresStore} from '../src/server/postgres-store.ts';
import {PostgresHouseholdAuth} from '../src/server/postgres-auth.ts';

export function testDatabaseUrl(){
 const connection=process.env.TEST_DATABASE_URL;
 if(!connection)throw new Error('Set TEST_DATABASE_URL to an isolated test Postgres database.');
 return connection;
}

export async function createTestDiary(){
 const connection=testDatabaseUrl();
 const schema='babylog_test_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:connection,max:1});
 const stores:PostgresStore[]=[];
 let closed=false;
 const open=async()=>{
  const pool=new Pool({connectionString:connection,max:3,options:`-c search_path=${schema}`});
  const database=new PostgresDatabase(pool),store=new PostgresStore(database);
  const closeStore=store.close.bind(store);let stopped=false;
  store.close=async()=>{if(stopped)return;stopped=true;await closeStore();};
  stores.push(store);await store.initialize();return store;
 };
 const close=async()=>{
  if(closed)return;closed=true;
  await Promise.all(stores.map(store=>store.close()));
  try{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await admin.end();}
 };
 try{
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const store=await open();return {store,database:store.database,open,close};
 }catch(error){await close();throw error;}
}

export async function testAuth(store:PostgresStore,credentials:{username:string;password:string}){
 const auth=new PostgresHouseholdAuth(store.database,credentials);await auth.initialize();return auth;
}
