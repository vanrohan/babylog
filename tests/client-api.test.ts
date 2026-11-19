import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/client/api.ts';

test('client API reads JSON responses and preserves server errors',async t=>{
 const fetch=t.mock.method(globalThis,'fetch');
 fetch.mock.mockImplementation(async()=>Response.json({text:'Bath at six.'}));
 assert.deepEqual(await api('/transcribe'),{text:'Bath at six.'});
 fetch.mock.mockImplementation(async()=>Response.json([]));
 assert.deepEqual(await api('/entries'),[]);
 for(const status of [400,401,403,502]){
  fetch.mock.mockImplementation(async()=>Response.json({error:'Use the Babylog website to make changes.'},{status}));
  await assert.rejects(api('/transcribe'),/Use the Babylog website/);
 }
});

test('client API handles outage pages, empty responses, and malformed JSON',async t=>{
 const fetch=t.mock.method(globalThis,'fetch');
 for(const [status,body] of [[502,'<html>Bad gateway</html>'],[503,''],[200,'<html>Unavailable</html>'],[200,'{'],[200,'null'],[200,'"text"'],[502,'{"error":{}}']] as const){
  fetch.mock.mockImplementation(async()=>new Response(body,{status}));
  await assert.rejects(api('/transcribe'),/Babylog is temporarily unavailable/);
 }
});

test('client API explains login failures without discarding the current page',async t=>{
 const fetch=t.mock.method(globalThis,'fetch');
 for(const status of [401,403]){
  fetch.mock.mockImplementation(async()=>new Response('<html>Sign in</html>',{status}));
  await assert.rejects(api('/transcribe'),/Keep this page open and sign in through another tab/);
 }
 const redirected=new Response('<html>Sign in</html>');Object.defineProperty(redirected,'redirected',{value:true});
 fetch.mock.mockImplementation(async()=>redirected);
 await assert.rejects(api('/transcribe'),/login needs renewal/);
});

test('client API handles lost connections and preserves cancellation',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Load failed');});
 await assert.rejects(api('/transcribe'),/temporarily unavailable/);
 const abort=new DOMException('Cancelled','AbortError');
 fetch.mock.mockImplementation(async()=>{throw abort;});
 await assert.rejects(api('/transcribe'),error=>error===abort);
 const controller=new AbortController();controller.abort();
 const reason=new Error('Navigation');fetch.mock.mockImplementation(async()=>{throw reason;});
 await assert.rejects(api('/transcribe',{signal:controller.signal}),error=>error===reason);
});

test('client API handles a lost response body and body cancellation',async t=>{
 const response=new Response('{}');
 const read=t.mock.method(response,'json',async()=>{throw new TypeError('Load failed');});
 t.mock.method(globalThis,'fetch',async()=>response);
 await assert.rejects(api('/transcribe'),/temporarily unavailable/);
 const abort=new DOMException('Cancelled','AbortError');read.mock.mockImplementation(async()=>{throw abort;});
 await assert.rejects(api('/transcribe'),error=>error===abort);
});

test('uncertain diary writes ask for a diary check before retrying',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('<html>Bad gateway</html>',{status:502}));
 for(const [path,method] of [['/entries','POST'],['/entries/example','PUT'],['/entries/example','DELETE'],['/proposals/example/confirm','POST']]){
  await assert.rejects(api(path,{method}),/Check the diary before you try again/);
 }
 await assert.rejects(api('/transcribe',{method:'POST'}),/Wait a moment, then try again/);
});

test('keyed saves retry a temporary failure once with the same request and preserve exact payloads',async t=>{
 const {saveEntryRequest}=await import('../src/client/api.ts');
 const key='16373012-ac78-4d04-a1f5-f1a399d24528',entry={notes:'Exact draft.',startAt:'2026-11-03T10:00:17.123Z'};
 const saved={id:'saved-entry',version:1};
 for(const failure of ['network','body','gateway','server','incomplete']){
  let attempts=0;
  const calls:{path:unknown;body:unknown}[]=[];
  t.mock.method(globalThis,'fetch',async(path:RequestInfo|URL,init?:RequestInit)=>{
   calls.push({path,body:init?.body});attempts++;
   if(attempts===1){
    if(failure==='network')throw new TypeError('Load failed');
    if(failure==='body')return new Response('{');
    if(failure==='incomplete')return Response.json({});
    return Response.json({error:'Temporary failure.'},{status:failure==='gateway'?502:500});
   }
   return Response.json(saved);
  });
  assert.deepEqual(await saveEntryRequest(key,entry),saved);assert.equal(attempts,2);assert.deepEqual(calls[0],calls[1]);
  assert.equal(calls[0].path,'/api/entry-saves/'+key);assert.equal(calls[0].body,JSON.stringify({entry}));
 }
});

test('keyed saves stop after two temporary failures and never retry definite rejections or cancellation',async t=>{
 const {saveEntryRequest}=await import('../src/client/api.ts');
 const key='16373012-ac78-4d04-a1f5-f1a399d24528';let attempts=0;
 const fetch=t.mock.method(globalThis,'fetch',async()=>{attempts++;throw new TypeError('Load failed');});
 await assert.rejects(saveEntryRequest(key,{}),/save is unconfirmed/);assert.equal(attempts,2);
 for(const status of [400,401,403,404,409,429]){
  attempts=0;fetch.mock.mockImplementation(async()=>{attempts++;return Response.json({error:'Definite rejection.'},{status});});
  await assert.rejects(saveEntryRequest(key,{}),/Definite rejection/);assert.equal(attempts,1);
 }
 const controller=new AbortController(),reason=new DOMException('Cancelled','AbortError');attempts=0;
 fetch.mock.mockImplementation(async()=>{attempts++;controller.abort(reason);throw reason;});
 await assert.rejects(saveEntryRequest(key,{},undefined,controller.signal),error=>error===reason);assert.equal(attempts,1);
});

test('keyed save timeouts stop each attempt and leave a safe retry message',async t=>{
 const {saveEntryRequest}=await import('../src/client/api.ts');
 t.mock.timers.enable({apis:['setTimeout']});let attempts=0;
 t.mock.method(globalThis,'fetch',async(_path:RequestInfo|URL,init?:RequestInit)=>{attempts++;return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}));});
 const save=saveEntryRequest('16373012-ac78-4d04-a1f5-f1a399d24528',{});
 const rejected=assert.rejects(save,/save is unconfirmed/);
 t.mock.timers.tick(25_000);await new Promise(resolve=>setImmediate(resolve));assert.equal(attempts,2);
 t.mock.timers.tick(25_000);await rejected;assert.equal(attempts,2);
});
