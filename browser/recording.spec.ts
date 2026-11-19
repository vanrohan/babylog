import {test,expect} from './test.ts';
test.use({serviceWorkers:'block'});

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const mic={mode:'tone',gain:null as GainNode|null,calls:0,stops:0,stream:null as MediaStream|null,streams:[] as MediaStream[],context:null as AudioContext|null,contexts:[] as AudioContext[]};(window as any).testMic=mic;
  const resume=AudioContext.prototype.resume;
  AudioContext.prototype.resume=function(){if(!mic.contexts.includes(this))mic.contexts.push(this);return resume.call(this);};
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
   mic.calls++;if(mic.mode==='deny')throw new DOMException('Denied','NotAllowedError');
   const context=new AudioContext();await context.resume();mic.context=context;
   const oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
   mic.gain=gain;gain.gain.value=mic.mode==='silent'?0:mic.mode==='weak'?.001:.1;oscillator.connect(gain);gain.connect(destination);oscillator.start();mic.stream=destination.stream;mic.streams.push(destination.stream);
   for(const track of destination.stream.getTracks()){
    const stop=track.stop.bind(track);let stopped=false;
    track.stop=()=>{if(stopped)return;stopped=true;mic.stops++;stop();void context.close();};
   }
   return destination.stream;
  }}});
 });
});

async function readAudio(page:import('@playwright/test').Page){
 return page.getByLabel('Play full recording').evaluate(async(element:HTMLAudioElement)=>{
  const bytes=await (await fetch(element.src)).arrayBuffer(),view=new DataView(bytes);
  let peak=0,tail=0;for(let i=44;i<bytes.byteLength;i+=2){const value=Math.abs(view.getInt16(i,true));peak=Math.max(peak,value);if(i>bytes.byteLength-3200)tail=Math.max(tail,value);}
  return {rate:view.getUint32(24,true),duration:(bytes.byteLength-44)/32000,peak,tail,bytes:Array.from(new Uint8Array(bytes))};
 });
}

test('real PCM command and reply recordings preserve full audio and retry the same reply',async({page},info)=>{
 const uploads:Buffer[]=[];await page.route('**/api/transcribe',route=>{
  uploads.push(route.request().postDataBuffer()!);
  return uploads.length===2?route.fulfill({status:502,json:{error:'Speech unavailable.'}}):route.fulfill({json:{text:uploads.length===1?'Add a bath.':'At two fifteen.'}});
 });
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:'What time?',proposal:null}}));
 await page.goto('/assistant');
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');
 await page.waitForTimeout(2300);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByLabel('Your instruction')).toHaveValue('Add a bath.');
 const first=await readAudio(page);expect(first.rate).toBe(16000);expect(first.duration).toBeGreaterThan(2);expect(first.peak).toBeGreaterThan(1000);expect(first.tail).toBeGreaterThan(1000);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Record reply',exact:true}).click();await page.waitForTimeout(1200);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Speech unavailable');const reply=await readAudio(page);expect(reply.duration).toBeGreaterThan(1);expect(reply.tail).toBeGreaterThan(1000);
 await page.getByRole('button',{name:'Retry transcription',exact:true}).click();await expect(page.getByLabel('Your reply')).toHaveValue('At two fifteen.');
 expect((await readAudio(page)).bytes).toEqual(reply.bytes);expect(uploads).toHaveLength(3);
 const audio=(body:Buffer)=>{const start=body.indexOf('RIFF'),size=body.readUInt32LE(start+4)+8;return body.subarray(start,start+size);};
 expect(audio(uploads[1])).toEqual(audio(uploads[2]));
 expect(await page.evaluate(()=>(window as any).testMic.streams.every((stream:MediaStream)=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true);
 await page.screenshot({path:info.outputPath('recorded-reply.png')});
});

test('silent capture gets a local signal error and preserves the typed instruction',async({page},info)=>{
 await page.goto('/assistant');await page.evaluate(()=>{(window as any).testMic.mode='silent';});
 await page.getByLabel('Your instruction').fill('Keep this instruction.');
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await page.waitForTimeout(2200);
 await expect(page.locator('.recording-time')).toContainText('Recording level is low');
 await page.screenshot({path:info.outputPath('no-microphone-signal.png')});
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(page.getByRole('alert')).toContainText('No microphone signal was recorded');
 expect((await readAudio(page)).peak).toBe(0);await expect(page.getByLabel('Your instruction')).toHaveValue('Keep this instruction.');
});

test('capture interruption retains playback, skips transcription, and permits a new reply recording',async({page})=>{
 let uploads=0;await page.route('**/api/transcribe',route=>{uploads++;return route.fulfill({json:{text:'At two fifteen.'}});});
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:'What time?',proposal:null}}));
 await page.goto('/assistant');await page.getByLabel('Your instruction').fill('Add a bath.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Record reply',exact:true}).click();await page.waitForTimeout(500);
 await page.evaluate(()=>{(window as any).testMic.stream.getTracks()[0].dispatchEvent(new Event('mute'));});
 await expect(page.getByRole('alert')).toContainText('interrupted');await expect(page.getByLabel('Play full recording')).toBeVisible();expect(uploads).toBe(0);
 await page.getByRole('button',{name:'Record reply',exact:true}).click();await page.waitForTimeout(500);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByLabel('Your reply')).toHaveValue('At two fifteen.');expect(uploads).toBe(1);
 const prior=(await readAudio(page)).bytes;
 await page.evaluate(()=>{(window as any).testMic.mode='deny';});await page.getByRole('button',{name:'Record reply',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Microphone unavailable');expect((await readAudio(page)).bytes).toEqual(prior);
 await expect(page.getByLabel('Your reply')).toHaveValue('At two fifteen.');
});

test('missing PCM frames fail startup and release capture resources',async({page})=>{
 await page.addInitScript(()=>{
  const Context=AudioContext;
  class NoFrames extends Context{createMediaStreamSource(stream:MediaStream){const source=super.createMediaStreamSource(stream);source.connect=(()=>source) as typeof source.connect;return source;}}
  Object.defineProperty(window,'AudioContext',{value:NoFrames});
 });
 await page.goto('/assistant');await page.getByRole('button',{name:'Record voice',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('No microphone audio arrived',{timeout:10000});
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).testMic.stream.getTracks()[0].readyState)).toBe('ended');
});

for(const cause of ['background','suspended context'])test(`${cause} stops capture without submitting partial speech`,async({page})=>{
 let uploads=0;await page.route('**/api/transcribe',route=>{uploads++;return route.fulfill({json:{text:'Partial words.'}});});
 await page.goto('/assistant');await page.getByLabel('Your instruction').fill('Keep the full instruction.');
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await page.waitForTimeout(500);
 await page.evaluate(async cause=>{
  if(cause==='background'){
   Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
  }else await (window as any).testMic.contexts[0].suspend();
 },cause);
 await expect(page.getByRole('alert')).toContainText('interrupted');await expect(page.getByLabel('Play full recording')).toBeVisible();
 await expect(page.getByLabel('Your instruction')).toHaveValue('Keep the full instruction.');expect(uploads).toBe(0);
 expect(await page.evaluate(()=>(window as any).testMic.stream.getTracks()[0].readyState)).toBe('ended');
});


test('weak capture avoids automatic transcription and permits explicit retry and a fresh recording',async({page})=>{
 let uploads=0;await page.route('**/api/transcribe',route=>{uploads++;return route.fulfill({json:{text:'Add a bath.'}});});
 await page.goto('/assistant');await page.evaluate(()=>{(window as any).testMic.mode='weak';});
 await page.getByLabel('Your instruction').fill('Keep this instruction.');
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await page.waitForTimeout(600);
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Recording level is low');expect(uploads).toBe(0);
 const weak=await readAudio(page);expect(weak.peak).toBeGreaterThan(0);expect(weak.peak).toBeLessThan(100);
 await expect(page.getByLabel('Your instruction')).toHaveValue('Keep this instruction.');
 await page.getByRole('button',{name:'Retry transcription',exact:true}).click();await expect(page.getByRole('region',{name:'Recorded transcript'})).toBeVisible();expect(uploads).toBe(1);
 await page.getByRole('button',{name:'Keep typed command',exact:true}).click();
 await page.evaluate(()=>{(window as any).testMic.mode='tone';});
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await page.waitForTimeout(600);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByRole('region',{name:'Recorded transcript'})).toBeVisible();expect(uploads).toBe(2);
 expect(await page.evaluate(()=>(window as any).testMic.streams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});

test('a short command after initial silence still transcribes automatically',async({page})=>{
 let uploads=0;await page.route('**/api/transcribe',route=>{uploads++;return route.fulfill({json:{text:'Pee.'}});});
 await page.goto('/assistant');await page.evaluate(()=>{(window as any).testMic.mode='silent';});
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await page.waitForTimeout(700);
 await page.evaluate(()=>{(window as any).testMic.gain.gain.value=.1;});await page.waitForTimeout(450);
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(page.getByLabel('Your instruction')).toHaveValue('Pee.');expect(uploads).toBe(1);
});

test('weak reply keeps the conversation and typed reply through explicit transcription retry',async({page})=>{
 const requests:any[]=[];let uploads=0;
 await page.route('**/api/assistant',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{message:'What time?',proposal:null,interpretedAt:'2026-11-12T09:00:00Z'}});});
 await page.route('**/api/transcribe',route=>{uploads++;return route.fulfill({json:{text:'At two fifteen.'}});});
 await page.goto('/assistant');await page.getByLabel('Your instruction').fill('Add a bath.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByLabel('Your reply').fill('Keep my reply.');await page.evaluate(()=>{(window as any).testMic.mode='weak';});
 await page.getByRole('button',{name:'Record reply',exact:true}).click();await page.waitForTimeout(600);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Recording level is low');await expect(page.getByLabel('Your reply')).toHaveValue('Keep my reply.');expect(uploads).toBe(0);
 await page.getByRole('button',{name:'Retry transcription',exact:true}).click();await expect(page.getByRole('region',{name:'Recorded transcript'})).toContainText('At two fifteen.');
 await page.getByRole('button',{name:'Use transcript',exact:true}).click();await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect.poll(()=>requests.length).toBe(2);expect(requests[1].command).toBe('At two fifteen.');expect(requests[1].conversation).toEqual([{command:'Add a bath.',reply:'What time?',at:'2026-11-12T09:00:00Z'}]);
});


test('brief noise peaks in a weak recording do not bypass the low-level check',async({page})=>{
 let uploads=0;await page.route('**/api/transcribe',route=>{uploads++;return route.fulfill({json:{text:'Unwanted transcript.'}});});
 await page.goto('/assistant');await page.evaluate(()=>{(window as any).testMic.mode='weak';});
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await page.waitForTimeout(500);
 await page.evaluate(()=>{(window as any).testMic.gain.gain.value=.005;});await page.waitForTimeout(450);
 await page.evaluate(()=>{(window as any).testMic.gain.gain.value=.001;});await page.waitForTimeout(1000);
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Recording level is low');expect(uploads).toBe(0);
});
