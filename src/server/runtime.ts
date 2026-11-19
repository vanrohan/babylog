import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config,defaultAssistantModel,defaultTranscriptionModel} from './settings.ts';
import {PostgresDatabase} from './postgres.ts';
import {PostgresStore} from './postgres-store.ts';
import {PostgresHouseholdAuth} from './postgres-auth.ts';

export interface RuntimeInput {
 databaseUrl:string;
 host?:string;
 port:number;
 publicOrigin:string;
 timeZone:string;
 username:string;
 password:string;
 openrouterKey?:string;
 model?:string;
 sttModel?:string;
 clientDirectory?:string;
 freshConnections?:boolean;
}

export async function createRuntime(input:RuntimeInput){
 if(!input.databaseUrl.trim())throw new Error('Set a Postgres connection for the diary.');
 const origin=new URL(input.publicOrigin);
 const local=origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
 if(!local&&origin.protocol!=='https:')throw new Error('Use HTTPS for the public app address.');
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Use the app origin without credentials or a path.');
 new Intl.DateTimeFormat('en',{timeZone:input.timeZone});
 Object.assign(config,{
  host:input.host??'0.0.0.0',port:input.port,publicOrigin:origin.origin,timeZone:input.timeZone,
  authUsername:input.username,authPassword:input.password,
  openrouterApiKey:input.openrouterKey?.trim()??'',model:input.model?.trim()||defaultAssistantModel,
  sttUrl:'',sttModel:input.sttModel?.trim()??defaultTranscriptionModel,ttsUrl:'',speechDebugDir:join(tmpdir(),'babylog-speech-debug'),
  clientDirectory:input.clientDirectory??'dist'
 });
 const store=new PostgresStore(new PostgresDatabase(input.databaseUrl,{freshConnections:input.freshConnections}));
 try{
  await store.initialize();
  const auth=new PostgresHouseholdAuth(store.database,{username:input.username,password:input.password});
  await auth.initialize();
  const {createApp}=await import('./app.ts');
  return {app:createApp(store,undefined,auth),store,auth};
 }catch(error){
  await store.close();
  throw error;
 }
}
