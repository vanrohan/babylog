import {fileURLToPath} from 'node:url';
import service from './compute-service.ts';
import {config} from './settings.ts';
import {startSpeechDebugCleanup} from './speech.ts';
import {createRuntime} from './runtime.ts';

const input=service.input();
const {app,store}=await createRuntime({
 databaseUrl:service.load().diary.url,port:service.port(),publicOrigin:input.publicOrigin,timeZone:input.timeZone,
 username:input.username?.expose()??'',password:input.password?.expose()??'',
 openrouterKey:input.openrouterKey?.expose(),model:input.model,sttModel:input.sttModel,freshConnections:true,
 clientDirectory:fileURLToPath(new URL('./public',import.meta.url))
});
const stopSpeechCleanup=startSpeechDebugCleanup();
const server=app.listen(config.port,config.host,()=>console.log('Babylog cloud service is ready.'));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;stopSpeechCleanup();
 server.close(()=>{void store.close().then(()=>process.exit(0)).catch(()=>process.exit(1));});
});
