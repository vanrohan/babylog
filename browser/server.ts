import {once} from 'node:events';
import type {Server} from 'node:http';
import {createApp} from '../src/server/app.ts';
import {config} from '../src/server/settings.ts';
import {createTestDiary,testAuth} from '../tests/test-diary.ts';
// Synthetic services keep browser tests away from external providers.
config.publicOrigin='';config.openrouterApiKey='browser-test';config.sttUrl='http://speech.test/transcribe';
const fixture=await createTestDiary(),{store}=fixture;
config.authUsername='browser-owner';config.authPassword='Synthetic browser password 123';
let server:Server|undefined;
try{
 const auth=await testAuth(store,{username:config.authUsername,password:config.authPassword});
 const active=createApp(store,{assist:async()=>{throw new Error('Mock Assistant in the browser test.');},transcribe:async()=>{throw new Error('Mock transcription in the browser test.');},speak:async()=>{throw new Error('Mock speech in the browser test.');}},auth).listen(3006,'127.0.0.1');
 server=active;await once(active,'listening');
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>active.close(()=>{
  void fixture.close().then(()=>process.exit(0)).catch(()=>process.exit(1));
 }));
}catch(error){
 try{
  if(server?.listening){const active=server;await new Promise<void>((resolve,reject)=>{active.close(error=>error?reject(error):resolve());active.closeAllConnections();});}
 }finally{await fixture.close();}
 throw error;
}
