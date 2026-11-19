import type {Entry} from '../shared.ts';

class ApiError extends Error {
 constructor(message:string,readonly retryable=false){super(message);}
}

export async function api<T=any>(path:string,init:RequestInit={}):Promise<T>{
 const diaryWrite=!['GET','HEAD'].includes((init.method??'GET').toUpperCase())&&path!=='/transcribe';
 const retry=diaryWrite?'Check the diary before you try again.':'Wait a moment, then try again.';
 const unavailable='Babylog is temporarily unavailable. '+retry;
 const login='Your Babylog login needs renewal. Keep this page open and sign in through another tab. '+retry;
 let response:Response;
 try{response=await fetch('/api'+path,{...init,headers:init.body instanceof FormData?init.headers:{'Content-Type':'application/json',...init.headers}});}
 catch(error){if(init.signal?.aborted||(error instanceof Error&&error.name==='AbortError'))throw error;throw new ApiError(unavailable,true);}
 if(response.status===401&&path!=='/auth/login'&&typeof window!=='undefined')window.dispatchEvent(new Event('babylog:unauthorized'));
 let result:any;
 try{result=await response.json();}
 catch(error){
  if(init.signal?.aborted||(error instanceof Error&&error.name==='AbortError'))throw error;
  throw new ApiError(response.status===401||response.status===403||response.redirected?login:unavailable,!response.redirected&&(response.ok||response.status>=500));
 }
 if(!response.ok)throw new ApiError(typeof result?.error==='string'&&result.error.trim()?result.error:response.status===401||response.status===403?login:unavailable,response.status>=500);
 if(result===null||typeof result!=='object')throw new ApiError(unavailable,true);
 return result;
}
export const json=(method:string,body:unknown):RequestInit=>({method,body:JSON.stringify(body)});

export async function saveEntryRequest(key:string,entry:unknown,id?:string,signal?:AbortSignal):Promise<Entry>{
 const request=json('POST',{id,entry});
 for(let attempt=0;attempt<2;attempt++){
  signal?.throwIfAborted();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25_000);
  try{
   const result=await api<Entry>('/entry-saves/'+key,{...request,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal});
   if(typeof result.id!=='string'||!Number.isSafeInteger(result.version))throw new ApiError('The save response is incomplete.',true);
   return result;
  }catch(error){
   if(signal?.aborted)throw error;
   if(!controller.signal.aborted&&!(error instanceof ApiError&&error.retryable))throw error;
   if(attempt===1)throw new Error('The save is unconfirmed. Your draft stays here. Retry Save to check it safely.');
  }finally{clearTimeout(timer);}
 }
 throw new Error('The save is unconfirmed.');
}
