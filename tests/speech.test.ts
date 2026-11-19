import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transcribe,pruneSpeechDebug} from '../src/server/speech.ts';
import {mkdtemp,readFile,readdir,rm,mkdir,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '../src/server/settings.ts';
import {beforeEach,afterEach} from 'node:test';
let debugDir:string;let originalDir:string;let originalSpeech:{sttUrl:string;sttModel:string;openrouterApiKey:string};
beforeEach(async()=>{originalSpeech={sttUrl:config.sttUrl,sttModel:config.sttModel,openrouterApiKey:config.openrouterApiKey};originalDir=config.speechDebugDir;debugDir=await mkdtemp(join(tmpdir(),'babylog-speech-test-'));config.speechDebugDir=debugDir;});
afterEach(async()=>{Object.assign(config,originalSpeech);config.speechDebugDir=originalDir;await rm(debugDir,{recursive:true,force:true});});
function sample(seconds=.1,amplitude=1000){
 const bytes=Math.round(seconds*32000);const wav=Buffer.alloc(44+bytes);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(bytes,40);
 for(let i=0;i<bytes/2;i++)wav.writeInt16LE(Math.round(amplitude*Math.sin(i*2*Math.PI*440/16000)),44+i*2);
 return wav;
}
test('silent and near-silent recordings never reach Whisper, while quiet audio remains usable',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({text:'Quiet speech.'});});
 await assert.rejects(transcribe(sample(7.5,0),undefined,{durationMs:7742}),/No microphone signal/);
 await assert.rejects(transcribe(sample(2,1)),/No microphone signal/);
 assert.equal(calls,0);
 assert.equal(await transcribe(sample(2,30)),'Quiet speech.');assert.equal(calls,1);
 const saved=await Promise.all((await readdir(debugDir)).map(async id=>JSON.parse(await readFile(join(debugDir,id,'diagnostic.json'),'utf8'))));
 assert(saved.some(d=>d.signal.peak===0&&d.error.includes('No microphone signal')));
});
test('speech sends English vocabulary guidance and preserves the returned words',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
  const form=init.body as FormData;
  assert.equal(form.get('language'),'en');assert.match(String(form.get('prompt')),/Breastfeeding.*nappy/);
  assert.equal(form.get('token_timestamps'),'false');assert.equal(form.get('no_timestamps'),'false');
  assert.equal((form.get('file') as File).type,'audio/wav');
  return new Response(JSON.stringify({text:++calls===1?' I had a bath. ':' Add a nappy change. '}),{status:200});
 });
 let timings=false;
 assert.equal(await transcribe(sample(),timing=>{assert(timing.conversionMs>=0);assert(timing.inferenceMs>=0);timings=true;}),'I had a bath.');
 assert(timings);assert.equal(await transcribe(sample()),'Add a nappy change.');
});
test('speech failure and empty transcripts return errors without inventing a command',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:503}));
 await assert.rejects(transcribe(sample()),/Speech input is unavailable/);
 mock.mock.mockImplementation(async()=>new Response(JSON.stringify({text:'   '}),{status:200}));
 await assert.rejects(transcribe(sample()),/No speech was detected/);
});

test('full audio reaches STT and saved diagnostics include original audio, timings, and transcript',async t=>{
 const original=sample(121);
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
  const form=init.body as FormData;
  assert.equal(form.get('language'),'en');assert.equal(form.get('detect_language'),'false');
  assert.equal(form.get('translate'),'false');assert.equal(form.get('duration'),'0');
  const audio=Buffer.from(await (form.get('file') as File).arrayBuffer());
  assert(audio.length>=121*32000);
  return Response.json({text:'Start and final words.',duration:121,segments:[{text:'final words'}]});
 });
 assert.equal(await transcribe(original,undefined,{durationMs:121000,chunks:122,mimeType:'audio/wav'}),'Start and final words.');
 const [id]=await readdir(debugDir);const saved=join(debugDir,id);
 assert.deepEqual(await readFile(join(saved,'input.audio')),original);
 const diagnostic=JSON.parse(await readFile(join(saved,'diagnostic.json'),'utf8'));
 assert.equal(diagnostic.durationSeconds,121);assert.equal(diagnostic.recording.chunks,122);
 assert.equal(diagnostic.result.text,'Start and final words.');assert(diagnostic.inferenceMs>=0);
});
test('overlong, incomplete, and corrupt recordings fail before inference and retain diagnostics',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({text:'invented'});});
 await assert.rejects(transcribe(sample(126)),/exceeds two minutes/);
 await assert.rejects(transcribe(sample(1),undefined,{durationMs:10000}),/incomplete/);
 await assert.rejects(transcribe(Buffer.from('broken audio')),/could not be transcribed/);
 assert.equal(calls,0);assert.equal((await readdir(debugDir)).length,3);
});
test('diagnostic retention removes old recordings and keeps unrelated files',async()=>{
 const old=join(debugDir,'11111111-1111-1111-1111-111111111111');await mkdir(old);
 await utimes(old,new Date(0),new Date(0));await mkdir(join(debugDir,'keep'));
 await pruneSpeechDebug(debugDir);
 assert.deepEqual(await readdir(debugDir),['keep']);
});
test('diagnostic retention keeps only the newest 100 recordings',async()=>{
 for(let i=0;i<101;i++){
  const path=join(debugDir,`${String(i).padStart(8,'0')}-1111-1111-1111-111111111111`);await mkdir(path);
  await utimes(path,new Date(Date.now()-i*1000),new Date(Date.now()-i*1000));
 }
 await pruneSpeechDebug(debugDir);const names=await readdir(debugDir);assert.equal(names.length,100);
 assert(!names.includes('00000100-1111-1111-1111-111111111111'));
});
test('AAC and Opus conversion preserve the final audio segment',async t=>{
 const {writeFile}=await import('node:fs/promises');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const exec=promisify(execFile);
 const input=sample(2);for(let i=16000;i<32000;i++)input.writeInt16LE(Math.round(10000*Math.sin(i*2*Math.PI*440/16000)),44+i*2);
 const source=join(debugDir,'source.wav');await writeFile(source,input);
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
  calls++;const file=(init.body as FormData).get('file') as File;const bytes=Buffer.from(await file.arrayBuffer());
  assert(bytes.length>=2*32000);assert(bytes.subarray(-6400).some(x=>x!==0));
  return Response.json({text:'The last word.'});
 });
 for(const [extension,codec] of [['mp4','aac'],['webm','libopus']]){
  const path=join(debugDir,'recording.'+extension);await exec('ffmpeg',['-nostdin','-v','error','-y','-i',source,'-c:a',codec,path]);
  let duration=0;assert.equal(await transcribe(await readFile(path),timing=>{duration=timing.durationSeconds;},{durationMs:2000}),'The last word.');
  assert(duration>=2&&duration<2.2);
 }
 assert.equal(calls,2);
});

const openrouterSpeech=()=>{config.sttUrl='';config.sttModel='qwen/qwen3-asr-0.6b';config.openrouterApiKey='synthetic-private-provider-key';};

test('OpenRouter receives complete validated WAV audio and a server-only key',async t=>{
 openrouterSpeech();const audio=sample(2);let calls=0;
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
  calls++;assert.equal(url,'https://openrouter.ai/api/v1/audio/transcriptions');
  assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+config.openrouterApiKey);
  const body=JSON.parse(String(init.body));assert.deepEqual(Object.keys(body).sort(),['input_audio','language','model']);
  assert.equal(body.model,'qwen/qwen3-asr-0.6b');assert.equal(body.language,'en');assert.equal(body.input_audio.format,'wav');
  assert.deepEqual(Buffer.from(body.input_audio.data,'base64'),audio);assert(!String(init.body).includes(config.openrouterApiKey));
  return Response.json({text:' The baby had a bath. ',privateMetadata:config.openrouterApiKey});
 });
 assert.equal(await transcribe(audio),'The baby had a bath.');assert.equal(calls,1);
 const [id]=await readdir(debugDir);const diagnostic=await readFile(join(debugDir,id,'diagnostic.json'),'utf8');
 assert(!diagnostic.includes(config.openrouterApiKey));assert.deepEqual(await readFile(join(debugDir,id,'speech.wav')),audio);
});

test('OpenRouter rejects malformed, truncated, silent, overlong, and incomplete WAV before upload',async t=>{
 openrouterSpeech();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({text:'Invalid.'});});
 const beyond=sample();beyond.writeUInt32LE(beyond.length,40);
 const invalid=[Buffer.from('broken'),sample().subarray(0,50),beyond];
 for(const [offset,value,bytes] of [[20,3,2],[22,2,2],[24,48000,4],[28,64000,4],[32,4,2],[34,8,2],[40,3199,4]]){
  const audio=sample();if(bytes===2)audio.writeUInt16LE(value,offset);else audio.writeUInt32LE(value,offset);invalid.push(audio);
 }
 for(const audio of invalid)await assert.rejects(transcribe(audio),/incomplete or unsupported/);
 await assert.rejects(transcribe(sample(2,0)),/No microphone signal/);
 await assert.rejects(transcribe(sample(126)),/exceeds two minutes/);
 await assert.rejects(transcribe(sample(1),undefined,{durationMs:10000}),/recording is incomplete/);
 assert.equal(calls,0);
});

test('OpenRouter failures and invalid transcript types never expose provider details',async t=>{
 openrouterSpeech();let calls=0;
 const fetch=t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:config.openrouterApiKey}},{status:429});});
 await assert.rejects(transcribe(sample()),error=>{assert(!String(error).includes(config.openrouterApiKey));return /Speech input is unavailable/.test(String(error));});
 for(const body of [null,{}, {text:123},{text:'   '},{text:config.openrouterApiKey}]){
  fetch.mock.mockImplementation(async()=>{calls++;return Response.json(body);});
  await assert.rejects(transcribe(sample()),error=>{assert(!String(error).includes(config.openrouterApiKey));return /No speech|Speech input is unavailable/.test(String(error));});
 }
 assert.equal(calls,6);
});

test('cancelling transcription aborts the provider request without an automatic retry',async t=>{
 openrouterSpeech();const controller=new AbortController(),reason=new DOMException('Cancelled','AbortError');
 let received!:()=>void;const started=new Promise<void>(resolve=>{received=resolve;});let calls=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
  calls++;received();return new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true}));
 });
 const pending=transcribe(sample(),undefined,{},controller.signal),rejected=assert.rejects(pending,error=>error===reason);
 await started;controller.abort(reason);await rejected;assert.equal(calls,1);
});

test('a legacy STT URL never receives the configured OpenRouter key',async t=>{
 openrouterSpeech();config.sttUrl='http://legacy-speech.invalid/transcribe';
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
  assert.equal(url,config.sttUrl);assert.equal(new Headers(init.headers).get('Authorization'),null);
  assert(init.body instanceof FormData);assert.equal(init.body.get('model'),'large-v3-turbo');
  return Response.json({text:'Legacy transcript.'});
 });
 assert.equal(await transcribe(sample()),'Legacy transcript.');
});
