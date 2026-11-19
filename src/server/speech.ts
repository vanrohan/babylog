import {mkdtemp,writeFile,readFile,rm,mkdir,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {config} from './settings.ts';
import {pcmWavDuration} from './pcm-wav.ts';
import {AppError} from './schema.ts';
const execFileAsync=promisify(execFile);
export interface RecordingInfo {durationMs?:number;chunks?:number;mimeType?:string;capture?:string;sampleRate?:number;frames?:number;peak?:number}
export interface SpeechTiming {conversionMs:number;inferenceMs:number;diagnosticId:string;durationSeconds:number}
export async function pruneSpeechDebug(dir:string,now=Date.now()){
 await mkdir(dir,{recursive:true});
 const items=await readdir(dir,{withFileTypes:true});
 const dated=await Promise.all(items.filter(x=>x.isDirectory()&&/^[0-9a-f-]{36}$/.test(x.name)).map(async x=>({name:x.name,mtime:(await stat(join(dir,x.name))).mtimeMs})));
 dated.sort((a,b)=>b.mtime-a.mtime);
 await Promise.all(dated.filter((x,i)=>i>=100||now-x.mtime>7*86400_000).map(x=>rm(join(dir,x.name),{recursive:true,force:true})));
}
export function startSpeechDebugCleanup(){
 const cleanup=()=>void pruneSpeechDebug(config.speechDebugDir).catch(e=>console.error('Speech cleanup failed:',e.message));
 cleanup();const timer=setInterval(cleanup,3600_000);timer.unref();return ()=>clearInterval(timer);
}
export async function transcribe(buffer:Buffer,onTiming?:(timing:SpeechTiming)=>void,recording:RecordingInfo={},signal?:AbortSignal){
 const dir=await mkdtemp(join(tmpdir(),'babylog-audio-'));
 const diagnosticId=randomUUID();
 const openrouter=!config.sttUrl&&Boolean(config.sttModel);
 const diagnostic:Record<string,unknown>={diagnosticId,createdAt:new Date().toISOString(),language:'en',model:openrouter?config.sttModel:'large-v3-turbo',inputBytes:buffer.length,recording};
 let converted:Buffer|undefined;
 try{
  signal?.throwIfAborted();
  const conversionStart=performance.now();let durationSeconds:number;
  if(openrouter){
   if(!config.openrouterApiKey.trim())throw new AppError('Speech input is unavailable. Type your command or try again.',502);
   durationSeconds=pcmWavDuration(buffer);converted=buffer;
  }else{
   const input=join(dir,'input.audio'),output=join(dir,'speech.wav');
   await writeFile(input,buffer);
   await execFileAsync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-i',input,'-t','126','-ar','16000','-ac','1','-c:a','pcm_s16le',output],{timeout:45_000,maxBuffer:1024*1024,signal});
   converted=await readFile(output);
   const probe=await execFileAsync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',output],{timeout:10_000,signal});
   durationSeconds=Number(probe.stdout.trim());
  }
  const conversionMs=performance.now()-conversionStart;
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0)throw new AppError('The recording contains no audio. Record again.');
  Object.assign(diagnostic,{durationSeconds,conversionMs,convertedBytes:converted.length});
  if(durationSeconds>125)throw new AppError('The recording exceeds two minutes. Record a shorter command. Nothing was transcribed.');
  if(recording.durationMs&&durationSeconds*1000<recording.durationMs-2000)throw new AppError('The recording is incomplete. Play it back and record again.');
  let peak=0,sum=0,samples=0;
  for(let offset=12;offset+8<=converted.length;){
   const size=converted.readUInt32LE(offset+4),end=Math.min(converted.length,offset+8+size);
   if(converted.toString('ascii',offset,offset+4)==='data'){
    for(let i=offset+8;i+1<end;i+=2){const value=converted.readInt16LE(i);peak=Math.max(peak,Math.abs(value));sum+=value*value;samples++;}
    break;
   }
   offset+=8+size+(size%2);
  }
  const rms=Math.sqrt(sum/Math.max(1,samples));Object.assign(diagnostic,{signal:{peak,rms,samples}});
  if(!samples||(peak<16&&rms<2))throw new AppError('No microphone signal was recorded. Check the microphone and record again.');
  signal?.throwIfAborted();
  let request:RequestInit,url:string;
  if(openrouter){
   const parameters={model:config.sttModel,language:'en'};diagnostic.parameters=parameters;
   url='https://openrouter.ai/api/v1/audio/transcriptions';
   request={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.openrouterApiKey},
    body:JSON.stringify({...parameters,input_audio:{data:converted.toString('base64'),format:'wav'}})};
  }else{
   const form=new FormData();form.append('file',new Blob([new Uint8Array(converted)],{type:'audio/wav'}),'speech.wav');
   const parameters={model:'large-v3-turbo',response_format:'verbose_json',language:'en',detect_language:'false',translate:'false',
    prompt:'Breastfeeding, nappy, sleep, bath, pee, poo, vitamin D, umbilical cord.',
    temperature:'0',temperature_inc:'0',no_timestamps:'false',token_timestamps:'false',no_language_probabilities:'true',offset_t:'0',duration:'0'};
   for(const [key,value] of Object.entries(parameters))form.append(key,value);
   diagnostic.parameters=parameters;url=config.sttUrl;request={method:'POST',body:form};
  }
  const inferenceStart=performance.now(),timeout=AbortSignal.timeout(openrouter?60_000:180_000);
  const response=await fetch(url,{...request,signal:signal?AbortSignal.any([signal,timeout]):timeout});
  diagnostic.inferenceMs=performance.now()-inferenceStart;diagnostic.status=response.status;
  if(!response.ok)throw new AppError('Speech input is unavailable. Type your command or try again.',502);
  const result=await response.json() as {text?:unknown}|null;
  if(typeof result?.text!=='string'||!result.text.trim())throw new AppError('No speech was detected. Please try again.');
  if(config.openrouterApiKey&&result.text.includes(config.openrouterApiKey))throw new AppError('Speech input is unavailable. Type your command or try again.',502);
  diagnostic.result=openrouter?{text:result.text}:result;
  onTiming?.({conversionMs,inferenceMs:Number(diagnostic.inferenceMs),diagnosticId,durationSeconds});
  return result.text.trim();
 }catch(e){
  const detail=e instanceof Error?e.message:String(e);
  diagnostic.error=config.openrouterApiKey?detail.replaceAll(config.openrouterApiKey,'[REDACTED]'):detail;
  if(signal?.aborted)throw e;
  const message=e instanceof AppError?e.message:'The recording could not be transcribed. Type your command or try again.';
  throw new AppError(`${message} Debug ID: ${diagnosticId}`,e instanceof AppError?e.status:502);
 }finally{
  try{
   await mkdir(config.speechDebugDir,{recursive:true});
   const saved=join(config.speechDebugDir,diagnosticId);await mkdir(saved);
   await writeFile(join(saved,'input.audio'),buffer);
   if(converted)await writeFile(join(saved,'speech.wav'),converted);
   await writeFile(join(saved,'diagnostic.json'),JSON.stringify(diagnostic,null,2));
   await pruneSpeechDebug(config.speechDebugDir);
  }catch(e){console.error('Speech diagnostics could not be saved:',e instanceof Error?e.message:String(e));}
  await rm(dir,{recursive:true,force:true});
 }
}
export async function speak(text:string){
 const response=await fetch(config.ttsUrl,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({model:'chatterbox',input:text,voice:config.ttsVoice,response_format:'wav'}),signal:AbortSignal.timeout(240_000)});
 if(!response.ok)throw new AppError('Speech output is unavailable. The text response is still available.',502);
 return Buffer.from(await response.arrayBuffer());
}
