import express,{type Request,type Response,type NextFunction} from 'express';
import multer from 'multer';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {z,ZodError} from 'zod';
import type {DiaryStore,HouseholdAuthentication} from './storage.ts';
import {AppError,careSchema,daySchema,versionSchema} from './schema.ts';
import {config,assistantAvailable,transcriptionAvailable} from './settings.ts';
import {LoginRateLimitError} from './login-policy.ts';
import {assist} from './assistant.ts';
import {speak,transcribe} from './speech.ts';
import {assistantConversationLimit,type AssistantReply,type ConversationTurn} from '../shared.ts';

type AppServices<S extends DiaryStore>={assist:(store:S,command:string,day:string,conversation?:ConversationTurn[])=>Promise<AssistantReply>;transcribe:typeof transcribe;speak:typeof speak};

export function createApp<S extends DiaryStore>(store:S,services:AppServices<S>={assist,transcribe,speak},providedAuth?:HouseholdAuthentication){
 const auth=providedAuth;
 if(!auth)throw new Error('Pass initialized authentication for the configured diary storage.');
 const app=express();
 app.disable('etag');
 const token=(req:Request)=>req.headers.cookie?.split(';').map(part=>part.trim()).find(part=>part.startsWith('babylog_session='))?.slice('babylog_session='.length)??'';
 const cookieOptions={httpOnly:true,sameSite:'strict' as const,secure:!!config.publicOrigin&&new URL(config.publicOrigin).protocol==='https:',path:'/'};
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','same-origin');
  if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   const origin=req.get('origin');
   const allowed=new Set([config.publicOrigin?new URL(config.publicOrigin).origin:'',`http://${req.get('host')}`,`https://${req.get('host')}`].filter(Boolean));
   if(origin&&!allowed.has(origin))return res.status(403).json({error:'Use the Babylog website to make changes.'});
  }
  next();
 });
 app.use(express.json({limit:'128kb'}));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024,files:1}});
 app.get('/api/health',(_req,res)=>res.json({ok:true}));
 app.get('/api/auth/session',async(req,res)=>res.json({user:await auth.session(token(req)),setupRequired:!auth.user}));
 app.post('/api/auth/login',async(req,res)=>{
  const input=z.object({username:z.string().min(1).max(64),password:z.string().min(1).max(128)}).parse(req.body);
  const result=await auth.login(input.username,input.password,req.ip??'unknown');
  await auth.logout(token(req));res.cookie('babylog_session',result.token,{...cookieOptions,maxAge:30*86400_000}).json({user:result.user});
 });
 app.use('/api',async(req,_res,next)=>{if(!await auth.session(token(req)))throw new AppError('Sign in to continue.',401);next();});
 app.post('/api/auth/logout',async(req,res)=>{await auth.logout(token(req));res.clearCookie('babylog_session',cookieOptions).json({ok:true});});
 app.get('/api/config',(_req,res)=>res.json({timeZone:config.timeZone,model:config.model,assistantAvailable:assistantAvailable(),transcriptionAvailable:transcriptionAvailable()}));
 app.get('/api/entries',async(req,res)=>{
  const day=req.query.day?daySchema.parse(req.query.day):undefined;
  res.json(await store.listEntries(day,config.timeZone));
 });
 app.post('/api/entries',async(req,res)=>res.status(201).json(await store.createEntry(req.body)));
 app.post('/api/entry-saves/:key',async(req,res)=>{
  const key=z.uuid().parse(req.params.key),input=z.object({id:z.uuid().optional(),entry:z.unknown()}).parse(req.body);
  res.json(await store.saveEntry(key,input.entry,input.id));
 });
 app.put('/api/entries/:id',async(req,res)=>res.json(await store.updateEntry(String(req.params.id),req.body,versionSchema.parse(req.body?.version))));
 app.get('/api/entries/:id/undo',async(req,res)=>res.json({undo:await store.getEntryUndo(String(req.params.id))}));
 app.post('/api/entries/:id/undo',async(req,res)=>res.json(await store.undoEntry(String(req.params.id),z.uuid().parse(req.body?.undoId))));
 app.delete('/api/entries/:id',async(req,res)=>{await store.deleteEntry(String(req.params.id),versionSchema.parse(req.body?.version));res.json({ok:true});});
 app.get('/api/care/:day',async(req,res)=>res.json(await store.getCare(String(req.params.day))));
 app.get('/api/care-tasks',async(_req,res)=>res.json(await store.listCareTasks()));
 app.post('/api/care-tasks',async(req,res)=>res.status(201).json(await store.createCareTask(req.body)));
 app.put('/api/care-tasks/:key',async(req,res)=>res.json(await store.updateCareTask(String(req.params.key),req.body,versionSchema.parse(req.body?.version))));
 app.delete('/api/care-tasks/:key',async(req,res)=>res.json(await store.removeCareTask(String(req.params.key),versionSchema.parse(req.body?.version))));
 app.put('/api/care/:day',async(req,res)=>{
  const input=careSchema.parse({...req.body,day:req.params.day});
  res.json(await store.setCare(input.day,input.key,input.done,input.version,input.taskVersion));
 });
 app.get('/api/export',async(_req,res)=>{res.attachment('babylog-export.json').json(await store.exportData());});
 const requireAssistant=(_req:Request,_res:Response,next:NextFunction)=>{
  if(!assistantAvailable())throw new AppError('Assistant is unavailable.',503);
  next();
 };
 const requireTranscription=(_req:Request,_res:Response,next:NextFunction)=>{
  if(!transcriptionAvailable())throw new AppError('Speech input is unavailable. Type your instruction.',503);
  next();
 };
 let busy=false;
 app.post('/api/assistant',requireAssistant,async(req,res)=>{
  const input=z.object({command:z.string().trim().min(1).max(4000),day:daySchema,conversation:z.array(z.object({command:z.string().trim().min(1).max(4000),reply:z.string().max(4000),at:z.iso.datetime({offset:true})})).max(assistantConversationLimit-1,'This conversation reaches its limit. Start a new instruction.').default([])}).parse(req.body);
  if(busy)throw new AppError('The assistant is busy. Try again shortly.',429);
  busy=true;
  try{const interpretedAt=new Date().toISOString();res.json({...await services.assist(store,input.command,input.day,input.conversation),interpretedAt});}finally{busy=false;}
 });
 app.post('/api/proposals/:id/confirm',requireAssistant,async(req,res)=>res.json(await store.confirm(String(req.params.id))));
 app.post('/api/proposals/:id/reject',requireAssistant,async(req,res)=>{await store.reject(String(req.params.id));res.json({ok:true});});
 app.post('/api/transcribe',requireAssistant,requireTranscription,upload.single('audio'),async(req,res)=>{
  if(!req.file?.buffer.length)throw new AppError('Record a voice command first.');
  const recording=z.object({durationMs:z.coerce.number().finite().min(0).max(600_000).optional(),chunks:z.coerce.number().int().min(1).max(10000).optional(),mimeType:z.string().max(100).optional(),capture:z.enum(['pcm-worklet']).optional(),sampleRate:z.coerce.number().int().min(8000).max(384000).optional(),frames:z.coerce.number().int().min(0).max(48_000_000).optional(),peak:z.coerce.number().finite().min(0).max(1).optional()}).parse(req.body??{});
  let diagnostics:import('./speech.ts').SpeechTiming|undefined;
  const controller=new AbortController(),cancel=()=>controller.abort();
  req.once('aborted',cancel);res.once('close',cancel);
  try{
   const text=await services.transcribe(req.file.buffer,timing=>{
    diagnostics=timing;res.set('Server-Timing',`audio;dur=${timing.conversionMs.toFixed(1)}, transcription;dur=${timing.inferenceMs.toFixed(1)}`);
   },recording,controller.signal);
   if(!controller.signal.aborted)res.json({text,diagnostics});
  }catch(error){if(!controller.signal.aborted)throw error;}
  finally{req.removeListener('aborted',cancel);res.removeListener('close',cancel);}
 });
 app.post('/api/speech',requireAssistant,async(req,res)=>{
  if(!config.ttsUrl)throw new AppError('Speech output is unavailable.',503);
  const {text}=z.object({text:z.string().trim().min(1).max(1000)}).parse(req.body);
  res.type('audio/wav').send(await services.speak(text));
 });
 const dist=resolve(config.clientDirectory);
 if(existsSync(dist)){
  // Deployment archives normalize timestamps. Metadata validators can return stale HTML.
  app.get(['/','/index.html','/assistant','/dashboard'],(_req,res)=>{
   res.set('Cache-Control','no-store');
   res.sendFile(resolve(dist,'index.html'),{etag:false,lastModified:false,cacheControl:false});
  });
  app.use(express.static(dist,{index:false,etag:false,lastModified:false,setHeaders:(res,path)=>{
   if(path.endsWith('sw.js'))res.setHeader('Cache-Control','no-store');
  }}));
 }
 app.use((_req,res)=>res.status(404).json({error:'This page or record was not found.'}));
 app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  if(error instanceof LoginRateLimitError)res.set('Retry-After',String(error.retryAfter));
  if(error instanceof ZodError)return res.status(400).json({error:error.issues.map(x=>x.message).join(' ')});
  if(error instanceof AppError)return res.status(error.status).json({error:error.message});
  if(error instanceof multer.MulterError)return res.status(400).json({error:'The recording is too large. Record a shorter command.'});
  if(error instanceof SyntaxError)return res.status(400).json({error:'The request contains invalid data.'});
  console.error(error);
  return res.status(500).json({error:'The request failed. Your unsaved form is still available. Please try again.'});
 });
 return app;
}
