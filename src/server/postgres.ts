import {AsyncLocalStorage} from 'node:async_hooks';
import {Pool,type PoolClient,type QueryResult,type QueryResultRow} from 'pg';

// One household lock serializes compound changes across service instances.
const householdLock=[1648557164,1];
const brokenConnection=(error:unknown)=>{
 const detail=error as {message?:unknown;code?:unknown}|null;
 return typeof detail?.message==='string'&&(/Query read timeout|Connection terminated|Connection closed|not queryable/.test(detail.message)||typeof detail.code==='string'&&(/^(08|57P0[123])/.test(detail.code)||['ECONNRESET','EPIPE','ETIMEDOUT'].includes(detail.code)));
};
export class PostgresDatabase {
 readonly pool:Pool;
 private readonly connection=new AsyncLocalStorage<PoolClient>();
 private readonly unusable=new WeakSet<PoolClient>();
 private readonly transactionTimeoutMs:number;
 private sequence=0;
 constructor(connection:string|Pool,options:{freshConnections?:boolean;transactionTimeoutMs?:number}={}){
  this.transactionTimeoutMs=options.transactionTimeoutMs??15_000;
  if(!Number.isSafeInteger(this.transactionTimeoutMs)||this.transactionTimeoutMs<1||this.transactionTimeoutMs>2_147_483_647)throw new Error('Use a positive transaction timeout within the Postgres millisecond limit.');
  this.pool=typeof connection==='string'?new Pool({connectionString:connection,max:options.freshConnections?1:3,maxUses:options.freshConnections?1:undefined,connectionTimeoutMillis:10_000,idleTimeoutMillis:10_000,query_timeout:10_000,keepAlive:true}):connection;
  this.pool.on('error',()=>console.error('An idle database connection closed. The next request will reconnect.'));
 }
 async query<T extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[]):Promise<QueryResult<T>>{
  let index=0;
  const sql=text.includes('?')?text.replace(/\?/g,()=>`$${++index}`):text;
  const client=this.connection.getStore();
  if(client&&this.unusable.has(client))throw new Error('The database connection is unavailable.');
  try{return await (client??this.pool).query<T>(sql,values);}
  catch(error){if(client&&brokenConnection(error))this.unusable.add(client);throw error;}
 }
 async transaction<T>(work:()=>Promise<T>):Promise<T>{
  if(this.connection.getStore())return work();
  const client=await this.pool.connect();
  let discard=false;
  const onError=()=>{discard=true;this.unusable.add(client);};
  client.on('error',onError);
  try{
   await client.query(`BEGIN; SET LOCAL idle_in_transaction_session_timeout='${this.transactionTimeoutMs}ms'; SET LOCAL statement_timeout='${this.transactionTimeoutMs}ms';`);
   await client.query('SELECT pg_advisory_xact_lock($1,$2)',householdLock);
   const result=await this.connection.run(client,work);
   if(discard||this.unusable.has(client))throw new Error('The database connection is unavailable.');
   await client.query('COMMIT');
   return result;
  }catch(error){
   discard=discard||this.unusable.has(client)||brokenConnection(error);
   if(!discard)try{await client.query('ROLLBACK');}catch{discard=true;}
   throw error;
  }finally{client.removeListener('error',onError);client.release(discard);}
 }
 async savepoint<T>(work:()=>Promise<T>,options:{rollback?:boolean}={}):Promise<T>{
  return this.transaction(async()=>{
   const name=`babylog_${++this.sequence}`;
   await this.query(`SAVEPOINT ${name}`);
   try{
    const value=await work();
    if(options.rollback)await this.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await this.query(`RELEASE SAVEPOINT ${name}`);
    return value;
   }catch(error){
    await this.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await this.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
   }
  });
 }
 async close(){await this.pool.end();}
}
