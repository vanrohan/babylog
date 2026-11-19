import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {startSpeechDebugCleanup} from '../src/server/speech.ts';
import {createRuntime} from '../src/server/runtime.ts';

if(existsSync('.env'))loadEnvFile('.env');
const databaseUrl=process.env.DEV_DATABASE_URL?.trim();
if(!databaseUrl)throw new Error('Set DEV_DATABASE_URL to a development Postgres database.');
const {app,store}=await createRuntime({
 databaseUrl,host:'127.0.0.1',port:3005,publicOrigin:'http://127.0.0.1:3005',timeZone:'Europe/Berlin',
 username:process.env.AUTH_USERNAME??'',password:process.env.AUTH_PASSWORD??'',
 openrouterKey:process.env.OPENROUTER_API_KEY,model:process.env.OPENROUTER_MODEL,sttModel:process.env.OPENROUTER_STT_MODEL,freshConnections:true
});
const stopSpeechCleanup=startSpeechDebugCleanup();
const server=app.listen(3005,'127.0.0.1',()=>console.log('Babylog development: http://127.0.0.1:3005'));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;stopSpeechCleanup();
 server.close(()=>{void store.close().then(()=>process.exit(0)).catch(()=>process.exit(1));});
});
