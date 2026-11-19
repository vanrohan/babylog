import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const username=process.env.AUTH_USERNAME??'',password=process.env.AUTH_PASSWORD??'';
const args=process.argv.slice(2),options=new Map<string,string>();
for(let index=0;index<args.length;index++){
 const key=args[index];
 if(!['--origin','--idle-seconds','--expected-entries'].includes(key)||options.has(key))throw new Error('Use --origin, --idle-seconds, and --expected-entries once each.');
 const value=args[++index];if(!value)throw new Error(`Supply a value for ${key}.`);options.set(key,value);
}
const origin=new URL(options.get('--origin')??'https://babylog.vanderwalt.de');
assert.equal(origin.protocol,'https:');assert.equal(origin.pathname,'/');assert(!origin.username&&!origin.password&&!origin.search&&!origin.hash);
const idle=Number(options.get('--idle-seconds')??0),expected=options.has('--expected-entries')?Number(options.get('--expected-entries')):undefined;
assert(Number.isInteger(idle)&&idle>=0&&idle<=600);
assert(expected===undefined||Number.isInteger(expected)&&expected>=0);
assert(username&&password,'Set the shared login in the local environment.');
const cookies:string[]=[];
const timings:number[]=[];
let summary:Record<string,unknown>|undefined;
async function request(path:string,method='GET',body?:unknown,cookie=''){
 const start=performance.now();
 const response=await fetch(origin.origin+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin.origin,Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 timings.push(Math.round(performance.now()-start));
 return {response,data:await response.json()};
}
async function login(){
 const result=await request('/auth/login','POST',{username:username,password:password});
 assert.equal(result.response.status,200,'The cloud login must succeed.');
 const cookie=result.response.headers.get('set-cookie')?.split(';')[0];assert(cookie);cookies.push(cookie);return cookie;
}
if(idle){
 console.log(`Waiting ${idle} seconds without app requests before the first login.`);
 for(let remaining=idle;remaining>0;remaining-=Math.min(remaining,60))await new Promise(resolve=>setTimeout(resolve,Math.min(remaining,60)*1000));
}
try{
 // Check login before health requests to expose cold-start failures.
 const first=await login();
 const [entries,second]=await Promise.all([request('/entries','GET',undefined,first),login()]);
 assert.equal(entries.response.status,200);assert(Array.isArray(entries.data));
 if(expected!==undefined)assert.equal(entries.data.length,expected);
 const [peer,configuration]=await Promise.all([request('/entries','GET',undefined,second),request('/config','GET',undefined,first)]);
 assert.equal(peer.response.status,200);
 const digest=(entries:{id:string}[])=>createHash('sha256').update(JSON.stringify([...entries].sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
 assert.equal(digest(peer.data),digest(entries.data),'Household device reads must contain the same entries.');
 assert.equal(configuration.response.status,200);
 const anonymous=await request('/entries');assert.equal(anonymous.response.status,401);
 const exported=await request('/export');assert.equal(exported.response.status,401);
 summary={passed:true,entries:entries.data.length,assistantAvailable:configuration.data.assistantAvailable,requestMs:timings};
}finally{
 const results=await Promise.allSettled(cookies.map(cookie=>request('/auth/logout','POST',{},cookie)));
 if(results.some(result=>result.status==='rejected'||result.value.response.status!==200))throw new Error('Cloud checks could not end every test session.');
}
console.log(JSON.stringify(summary));
