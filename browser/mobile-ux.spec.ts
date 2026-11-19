import {test,expect,type Page} from './test.ts';

test.beforeEach(async({request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
});
async function fakeMicrophone(page:Page){
 await page.addInitScript(()=>{
  const microphone={calls:0,stops:0,mode:'allow',allow:()=>{}};(window as any).microphone=microphone;
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
   microphone.calls++;if(microphone.mode==='deny')throw new Error('Permission denied.');
   if(microphone.mode==='delay')await new Promise<void>(resolve=>{microphone.allow=resolve;});
   const context=new AudioContext();await context.resume();const tone=context.createOscillator();const output=context.createMediaStreamDestination();tone.connect(output);tone.start();
   for(const track of output.stream.getTracks()){
    const stop=track.stop.bind(track);let stopped=false;
    track.stop=()=>{if(stopped)return;stopped=true;microphone.stops++;stop();void context.close();};
   }
   return output.stream;
  }}});
 });
}

test('current care leads on phones and a collapsed form keeps the full draft',async({page,request},info)=>{
 await request.post('/api/entries',{data:{activity:'nappy',startAt:'2026-11-03T09:15:00Z',pee:true,notes:'Quick check.'}});
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');
 await expect(page.getByRole('listbox',{name:'Start hour',exact:true})).toBeHidden();
 await expect(page.locator('.timeline-entry')).toContainText('Quick check.');
 if(info.project.name==='phone'){
  const summary=(await page.getByRole('region',{name:'Latest Care',exact:true}).boundingBox())!;
  expect(summary.y+summary.height).toBeLessThan(750);
  expect((await page.locator('.timeline-entry').boundingBox())!.y).toBeGreaterThan(summary.y+summary.height);
 }
 await page.screenshot({path:info.outputPath('time-log-collapsed.png'),fullPage:true});
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByLabel('Breast side',{exact:true}).selectOption('left');
 await page.getByLabel('Notes').fill('Unsaved notes.');await page.getByLabel('Pee',{exact:true}).check();await page.getByLabel('Temperature',{exact:true}).fill('36.7');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();
 await expect(page.getByLabel('Notes')).toBeHidden();
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await expect(page.getByLabel('Notes')).toHaveValue('Unsaved notes.');await expect(page.getByLabel('Pee',{exact:true})).toBeChecked();await expect(page.getByLabel('Temperature',{exact:true})).toHaveValue('36.7');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Save failed. Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('save is unconfirmed');await expect(page.getByLabel('Notes')).toHaveValue('Unsaved notes.');
 await page.unroute('**/api/entry-saves/*');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByLabel('Notes')).toBeHidden();
 await page.getByRole('button',{name:'Edit Nappy change at 10:15'}).click();await expect(page.getByLabel('Notes')).toHaveValue('Quick check.');
 await page.screenshot({path:info.outputPath('time-log-edit.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('long notes and source details stay collapsed without changing stored notes',async({page,request})=>{
 const body='The original caregiver note stays complete. '.repeat(7);
 const source='Source: BabyDiary.pdf, page 1, nappy row 1.';
 const marker='Import: '+'a'.repeat(64)+':p1-nappy row 1';const notes=body+'\n'+source+'\n'+marker;
 const response=await request.post('/api/entries',{data:{activity:'nappy',startAt:'2026-11-03T09:15:00Z',notes}});const entry=await response.json();
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');
 const record=page.locator('.timeline-entry');await expect(record.getByText(body,{exact:true})).toBeHidden();
 await record.locator('summary').filter({hasText:/^Notes/}).click();await expect(record.getByText(body,{exact:true})).toBeVisible();
 await record.getByText('Source details',{exact:true}).click();await expect(record.getByText(source,{exact:false})).toBeVisible();
 const [saved]=await (await request.get('/api/entries')).json();expect(saved.id).toBe(entry.id);expect(saved.notes).toBe(notes);
});

test('Assistant closes only after a confirmed save and reports the affected day',async({page,request},info)=>{
 await page.clock.install();let confirms=0;let refreshFailure=false;
 const entry={activity:'bath',startAt:'2026-11-02T13:20:00Z',endAt:null,status:'completed',pee:false,poo:false,temperature:null,notes:''};
 const proposal={id:'save-check',summary:'Add a bath.',operations:[{type:'create_entry',entry}],targets:[],status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()};
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:proposal.summary,proposal}}));
 await page.route('**/api/proposals/save-check/confirm',async route=>{confirms++;if(confirms===1)return route.fulfill({status:409,json:{error:'The proposal is stale. Review it again.'}});await request.post('/api/entries',{data:entry});refreshFailure=true;return route.fulfill({json:{...proposal,status:'confirmed'}});});
 await page.route('**/api/entries**',route=>refreshFailure?route.fulfill({status:503,json:{error:'Diary refresh failed. Try again.'}}):route.continue());
 await page.goto('/');const launcher=page.getByRole('button',{name:'Settings',exact:true}).last();await launcher.click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await expect(page.getByRole('region',{name:'Assistant',exact:true})).toBeVisible();
 await page.getByLabel('Your instruction').fill('Add a bath yesterday at 14:20.');await page.getByRole('button',{name:'Send'}).click();
 await page.getByRole('button',{name:'Confirm changes'}).click();await expect(page.getByRole('alert')).toContainText('stale');await expect(page.getByRole('region',{name:'Assistant',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('assistant-review.png'),fullPage:true});
 await page.getByRole('button',{name:'Confirm changes'}).click();
 await expect(page.getByRole('region',{name:'Assistant',exact:true})).toHaveCount(0);await expect(page.getByRole('status').filter({hasText:'Bath added (2026-11-02 14:20).'})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('Diary refresh failed');expect(confirms).toBe(2);expect((await (await request.get('/api/entries')).json()).length).toBe(1);
 await page.getByRole('button',{name:'View day'}).click();await expect(page.getByRole('textbox',{name:'Diary date',exact:true})).toHaveValue('2026-11-02');
 refreshFailure=false;await page.clock.fastForward(10000);await expect(page.locator('.timeline-entry')).toContainText('Bath');
});

test('a transcript needs review and cannot silently replace a typed command',async({page})=>{
 await fakeMicrophone(page);let commands:string[]=[];
 await page.route('**/api/transcribe',route=>route.fulfill({json:{text:'I had a bath at six.'}}));
 await page.route('**/api/assistant',route=>{commands.push(route.request().postDataJSON().command);return route.fulfill({json:{message:'Which date?',proposal:null}});});
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByLabel('Your instruction').fill('Keep my typed command.');
 await page.getByRole('button',{name:'Record voice'}).click();await expect(page.getByRole('region',{name:'Assistant',exact:true}).getByRole('status')).toContainText('Recording');await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();
 await expect(page.getByRole('region',{name:'Recorded transcript'})).toContainText('I had a bath at six.');await expect(page.getByRole('heading',{name:'Recorded transcript',exact:true})).toBeFocused();await expect(page.getByLabel('Your instruction')).toHaveValue('Keep my typed command.');
 await expect(page.getByRole('button',{name:'Send'})).toBeDisabled();expect(commands).toEqual([]);
 await page.getByRole('button',{name:'Keep typed command'}).click();await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeFocused();await expect(page.getByLabel('Your instruction')).toHaveValue('Keep my typed command.');
 await page.getByRole('button',{name:'Record voice'}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();await page.getByRole('button',{name:'Use transcript'}).click();
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeFocused();await expect(page.getByLabel('Your instruction')).toBeEditable();await expect(page.getByLabel('Your instruction')).toHaveValue('I had a bath at six.');await page.getByLabel('Your instruction').fill('I had a bath at seven.');expect(commands).toEqual([]);
 await page.getByRole('button',{name:'Send'}).click();await expect(page.getByText('Which date?',{exact:true})).toBeVisible();expect(commands).toEqual(['I had a bath at seven.']);
});

test('microphone and transcription failures preserve a typed command',async({page})=>{
 await fakeMicrophone(page);await page.goto('/');
 expect(await page.evaluate(()=>(window as any).microphone.calls)).toBe(0);
 await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();await page.getByLabel('Your instruction').fill('Keep this command.');
 await page.evaluate(()=>{(window as any).microphone.mode='deny';});
 await page.getByRole('button',{name:'Record voice'}).click();await expect(page.getByRole('alert')).toContainText('Microphone unavailable');await expect(page.getByLabel('Your instruction')).toHaveValue('Keep this command.');
 await page.evaluate(()=>{(window as any).microphone.mode='allow';});
 await page.route('**/api/transcribe',route=>route.fulfill({status:502,json:{error:'Transcription failed. Try again.'}}));
 await page.getByRole('button',{name:'Record voice'}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();
 await expect(page.getByRole('alert')).toContainText('Transcription failed');await expect(page.getByLabel('Your instruction')).toHaveValue('Keep this command.');await expect(page.getByRole('button',{name:'Send'})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).microphone.stops)).toBe(1);
});

test('closing Assistant stops recording and cancels pending transcription',async({page})=>{
 await fakeMicrophone(page);let uploads=0;let aborted=false;
 page.on('requestfailed',request=>{if(request.url().endsWith('/api/transcribe'))aborted=true;});
 await page.route('**/api/transcribe',()=>{uploads++;});
 await page.goto('/');const launcher=page.getByRole('button',{name:'Settings',exact:true}).last();await launcher.click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByRole('button',{name:'Record voice'}).click();await page.getByRole('button',{name:'Close Assistant'}).click();
 await expect(page.getByRole('region',{name:'Assistant',exact:true})).toHaveCount(0);await expect(launcher).toBeFocused();expect(uploads).toBe(0);expect(await page.evaluate(()=>(window as any).microphone.stops)).toBe(1);
 await launcher.click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();await page.getByRole('button',{name:'Record voice'}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();
 await expect(page.getByRole('region',{name:'Assistant',exact:true}).getByRole('status')).toContainText('Transcribing');await expect.poll(()=>uploads).toBe(1);
 await page.getByRole('button',{name:'Close Assistant'}).click();await expect.poll(()=>aborted).toBe(true);expect(await page.evaluate(()=>(window as any).microphone.stops)).toBe(2);
 aborted=false;await launcher.click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();await page.getByRole('button',{name:'Record voice'}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();
 await expect.poll(()=>uploads).toBe(2);await page.goBack();await expect(page.getByRole('region',{name:'Assistant',exact:true})).toHaveCount(0);await expect.poll(()=>aborted).toBe(true);expect(await page.evaluate(()=>(window as any).microphone.stops)).toBe(3);
 await launcher.click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();await page.getByLabel('Your instruction').fill('A new command.');await expect(page.getByLabel('Your instruction')).toHaveValue('A new command.');
});

test('pending microphone permission blocks repeated recording requests',async({page})=>{
 await fakeMicrophone(page);await page.goto('/');await page.evaluate(()=>{(window as any).microphone.mode='delay';});
 await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();const record=page.getByRole('button',{name:'Record voice'});
 await record.click();await expect(record).toBeDisabled();await record.dispatchEvent('click');
 expect(await page.evaluate(()=>(window as any).microphone.calls)).toBe(1);
 await page.evaluate(()=>{(window as any).microphone.allow();});await expect(page.getByRole('button',{name:'Stop recording'})).toBeEnabled();
 await page.getByRole('button',{name:'Close Assistant'}).click();expect(await page.evaluate(()=>(window as any).microphone.stops)).toBe(1);
});

test('recording uploads every chunk, keeps playback after failure, and retries the exact audio',async({page})=>{
 await fakeMicrophone(page);
 const bodies:Buffer[]=[];
 await page.route('**/api/transcribe',route=>{
  const body=route.request().postDataBuffer()!;bodies.push(body);
  expect(body.toString()).toContain('RIFF');expect(body.toString()).toContain('name="capture"\r\n\r\npcm-worklet');
  return bodies.length===1?route.fulfill({status:502,json:{error:'Speech unavailable. Debug ID: synthetic.'}}):route.fulfill({json:{text:'Sleep from nine to twelve.',diagnostics:{diagnosticId:'synthetic',durationSeconds:3}}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByRole('button',{name:'Record voice'}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();
 await expect(page.getByRole('alert')).toContainText('synthetic');
 await expect(page.getByLabel('Play full recording')).toBeVisible();
 await page.getByRole('button',{name:'Retry transcription'}).click();
 await expect(page.getByLabel('Your instruction')).toHaveValue('Sleep from nine to twelve.');expect(bodies).toHaveLength(2);
 expect(await page.evaluate(()=>(window as any).microphone.stops)).toBe(1);
});

test('an HTML outage keeps the recording and typed input for an explicit retry',async({page})=>{
 await fakeMicrophone(page);const bodies:Buffer[]=[];let commands=0;
 await page.route('**/api/assistant',route=>{commands++;return route.fulfill({json:{message:'Which time?',proposal:null}});});
 await page.route('**/api/transcribe',route=>{
  bodies.push(route.request().postDataBuffer()!);
  return bodies.length===1?route.fulfill({status:502,contentType:'text/html',body:'<html>Bad gateway</html>'}):route.fulfill({json:{text:'Bath at six.'}});
 });
 await page.goto('/assistant');await page.getByLabel('Your instruction').fill('Keep this typed command.');
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Babylog is temporarily unavailable');
 await expect(page.getByLabel('Play full recording')).toBeVisible();await expect(page.getByLabel('Your instruction')).toHaveValue('Keep this typed command.');
 expect(bodies).toHaveLength(1);expect(commands).toBe(0);
 await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
 await expect(page.getByRole('region',{name:'Recorded transcript'})).toContainText('Bath at six.');
 await expect(page.getByLabel('Your instruction')).toHaveValue('Keep this typed command.');
 expect(bodies).toHaveLength(2);
 const audio=(body:Buffer)=>{const start=body.indexOf('RIFF'),size=body.readUInt32LE(start+4)+8;return body.subarray(start,start+size);};
 expect(audio(bodies[0]).subarray(8,12).toString()).toBe('WAVE');expect(audio(bodies[1])).toEqual(audio(bodies[0]));expect(commands).toBe(0);
 expect(await page.evaluate(()=>(window as any).microphone.calls)).toBe(1);
});

test('a real browser recorder keeps a complete playable recording',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
   const context=new AudioContext();await context.resume();const tone=context.createOscillator();const output=context.createMediaStreamDestination();tone.connect(output);tone.start();
   for(const track of output.stream.getTracks()){track.addEventListener('ended',()=>void context.close());}
   return output.stream;
  }}});
 });
 let bytes=0;
 await page.route('**/api/transcribe',route=>{bytes=route.request().postDataBuffer()!.length;return route.fulfill({json:{text:'Synthetic audio check.'}});});
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();await page.getByRole('button',{name:'Record voice'}).click();
 await page.waitForTimeout(2400);await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();
 await expect(page.getByLabel('Your instruction')).toHaveValue('Synthetic audio check.');expect(bytes).toBeGreaterThan(1000);
 const length=await page.getByLabel('Play full recording').evaluate(async(el:HTMLAudioElement)=>{
  const blob=await (await fetch(el.src)).arrayBuffer();const ctx=new AudioContext();try{return (await ctx.decodeAudioData(blob)).duration;}finally{await ctx.close();}
 });
 expect(length).toBeGreaterThan(2);expect(length).toBeLessThan(5);
});

test('retry removes an old proposal before a different transcript arrives',async({page})=>{
 await fakeMicrophone(page);let attempts=0;
 await page.route('**/api/transcribe',route=>route.fulfill({json:{text:++attempts===1?'Sleep from nine to twelve.':'Bath at six.'}}));
 const entry={activity:'sleep',startAt:'2026-11-03T08:00:00Z',endAt:'2026-11-03T11:00:00Z',status:'completed',pee:false,poo:false,temperature:null,notes:''};
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:'Add sleep.',proposal:{id:'old',operations:[{type:'create_entry',entry}],targets:[],summary:'Add sleep.'}}}));
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByRole('button',{name:'Record voice'}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).click();
 await expect(page.getByLabel('Your instruction')).toHaveValue('Sleep from nine to twelve.');
 await page.getByRole('button',{name:'Send'}).click();await expect(page.getByRole('button',{name:'Confirm changes'})).toBeVisible();
 await page.getByRole('button',{name:'Retry transcription'}).click();
 await expect(page.getByLabel('Your instruction')).toHaveValue('Bath at six.');
 await expect(page.getByRole('region',{name:'Recorded transcript'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Confirm changes'})).toHaveCount(0);
});

test('assistant questions have a reply field, keep failed replies, and preserve confirmation',async({page,request},info)=>{
 const created=await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-11-03T12:20:00Z',endAt:null,status:'completed',notes:'Keep this note.'}});const entry=await created.json();
 const original='The baby woke up 10min ago. Current sleep end time needed.';
 const question='Which sleep should I update?';let calls=0;
 const proposal={id:'reply-test',summary:'End the sleep.',operations:[{type:'update_entry',id:entry.id,version:entry.version,entry:{...entry,endAt:'2026-11-03T16:18:00Z'}}],targets:[entry]};
 await page.route('**/api/assistant',route=>{
  const body=route.request().postDataJSON();calls++;
  if(calls===1){expect(body.conversation).toEqual([]);return route.fulfill({json:{message:question,proposal:null,interpretedAt:'2026-11-03T16:00:00Z'}});}
  expect(body.command).toBe('Use the last sleep.');expect(body.conversation).toEqual([{command:original,reply:question,at:'2026-11-03T16:00:00Z'}]);
  if(calls===2)return route.fulfill({status:503,json:{error:'Try again.'}});
  return route.fulfill({json:{message:'End the sleep.',proposal}});
 });
 await page.route('**/api/proposals/reply-test/confirm',async route=>{await request.put('/api/entries/'+entry.id,{data:{...entry,endAt:'2026-11-03T16:18:00Z'}});return route.fulfill({json:{...proposal,status:'confirmed'}});});
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByLabel('Your instruction').fill(original);await page.getByRole('button',{name:'Send'}).click();
 await expect(page.getByLabel('Your reply')).toBeVisible();await expect(page.locator('.instruction-composer')).toHaveCount(1);await expect(page.getByLabel('Your instruction')).toHaveCount(0);await expect(page.getByRole('log',{name:'Conversation'})).toContainText(original);await expect(page.getByRole('button',{name:'Record reply'})).toBeVisible();await expect(page.getByRole('button',{name:'Send'})).toBeDisabled();
 await page.getByLabel('Your reply').fill('Use the last sleep.');await page.getByRole('button',{name:'Send'}).click();
 await expect(page.getByRole('alert')).toContainText('Try again.');await expect(page.getByLabel('Your reply')).toHaveValue('Use the last sleep.');await expect(page.getByText(question,{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('assistant-reply.png'),fullPage:true});
 await page.getByRole('button',{name:'Send'}).click();await expect(page.getByRole('button',{name:'Confirm changes'})).toBeVisible();
 expect((await (await request.get('/api/entries')).json())[0].endAt).toBe(null);
 await page.getByRole('button',{name:'Confirm changes'}).click();await expect(page.getByRole('region',{name:'Assistant',exact:true})).toHaveCount(0);
 expect((await (await request.get('/api/entries')).json())[0].endAt).toBe('2026-11-03T16:18:00.000Z');
});

test('a spoken reply keeps the question and reviews every action before one confirmation',async({page,request},info)=>{
 await fakeMicrophone(page);let calls=0;let confirms=0;
 const original='Add a bath at 2 pm and a nappy change with poo only.';
 const question='What time was the nappy change?';
 const entries=[{activity:'bath',startAt:'2026-11-03T13:00:00Z',endAt:null,status:'completed',pee:false,poo:false,temperature:null,notes:''},{activity:'nappy',startAt:'2026-11-03T13:20:00Z',endAt:null,status:'completed',pee:false,poo:true,temperature:null,notes:''}];
 const proposal={id:'batch-reply',summary:'Add bath and nappy change.',operations:entries.map(entry=>({type:'create_entry',entry})),targets:[]};
 await page.route('**/api/transcribe',route=>route.fulfill({json:{text:'The nappy change was at 2:15 pm.'}}));
 await page.route('**/api/assistant',route=>{
  const body=route.request().postDataJSON();calls++;
  if(calls===1)return route.fulfill({json:{message:question,proposal:null,interpretedAt:'2026-11-03T16:00:00Z'}});
  expect(body.command).toBe('The nappy change was at 2:20 pm.');expect(body.conversation[0].command).toBe(original);
  return route.fulfill({json:{message:proposal.summary,proposal}});
 });
 await page.route('**/api/proposals/batch-reply/confirm',async route=>{confirms++;for(const entry of entries)await request.post('/api/entries',{data:entry});return route.fulfill({json:{...proposal,status:'confirmed'}});});
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByLabel('Your instruction').fill(original);await page.getByRole('button',{name:'Send'}).click();
 await page.getByLabel('Your reply').fill('Keep this typed reply.');
 await page.getByRole('button',{name:'Record reply',exact:true}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording'}).last().click();
 await expect(page.getByRole('region',{name:'Recorded transcript'})).toBeVisible();await expect(page.getByRole('button',{name:'Send'})).toBeDisabled();
 await expect(page.getByRole('heading',{name:'Recorded transcript',exact:true})).toBeFocused();await page.getByRole('button',{name:'Keep typed reply'}).click();await expect(page.getByRole('button',{name:'Record reply',exact:true})).toBeFocused();await expect(page.getByLabel('Your reply')).toHaveValue('Keep this typed reply.');await expect(page.getByText(question,{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Retry transcription'}).click();await page.getByRole('button',{name:'Use transcript'}).click();
 await expect(page.getByRole('button',{name:'Record reply',exact:true})).toBeFocused();await expect(page.getByLabel('Your reply')).toBeEditable();await expect(page.getByLabel('Your reply')).toHaveValue('The nappy change was at 2:15 pm.');await page.getByLabel('Your reply').fill('The nappy change was at 2:20 pm.');await expect(page.getByText(question,{exact:true})).toBeVisible();
 await expect(page.getByRole('log',{name:'Conversation'})).toContainText(original);await expect(page.getByLabel('Your instruction')).toHaveCount(0);await page.getByRole('button',{name:'Send'}).click();
 await expect(page.locator('.proposal li')).toHaveCount(2);await expect(page.locator('.proposal')).toContainText('2 changes.');
 expect(await (await request.get('/api/entries')).json()).toHaveLength(0);
 await page.screenshot({path:info.outputPath('assistant-batch.png'),fullPage:true});
 await page.getByRole('button',{name:'Confirm changes'}).click();await expect(page.getByRole('region',{name:'Assistant',exact:true})).toHaveCount(0);
 expect(confirms).toBe(1);expect(await (await request.get('/api/entries')).json()).toHaveLength(2);
});

test('failed reply microphone access does not change the saved recording destination',async({page})=>{
 await fakeMicrophone(page);let transcriptions=0;
 await page.route('**/api/transcribe',route=>{transcriptions++;return route.fulfill({json:{text:'Add a bath.'}});});
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:'What time was the bath?',proposal:null}}));
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByLabel('Your instruction')).toHaveValue('Add a bath.');await page.getByRole('button',{name:'Send'}).click();
 await page.evaluate(()=>{(window as any).microphone.mode='deny';});await page.getByRole('button',{name:'Record reply',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Microphone unavailable');await page.getByRole('button',{name:'Retry transcription'}).click();
 await expect(page.getByRole('region',{name:'Recorded transcript'})).toHaveCount(0);
 await expect(page.getByLabel('Your instruction')).toHaveValue('Add a bath.');await expect(page.getByLabel('Your reply')).toHaveCount(0);expect(transcriptions).toBe(2);
});

test('Assistant has its own page, allows direct typing, and shows transcription progress',async({page},info)=>{
 await fakeMicrophone(page);let finish:()=>void=()=>{};
 const waiting=new Promise<void>(resolve=>{finish=resolve;});
 await page.route('**/api/transcribe',async route=>{await waiting;await route.fulfill({json:{text:'Add a bath at six.'}});});
 await page.goto('/assistant');await expect(page.getByRole('heading',{name:'Assistant',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeFocused();await expect(page.getByRole('button',{name:'Record voice',exact:true})).toHaveClass(/composer-icon/);expect(await page.evaluate(()=>(window as any).microphone.calls)).toBe(0);
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.log-panel')).toBeHidden();
 const instruction=page.getByLabel('Your instruction');await expect(instruction).toBeEditable();
 await expect(page.getByRole('button',{name:'Send'})).toBeDisabled();await page.screenshot({path:info.outputPath('assistant-composer.png'),fullPage:true});
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await expect(instruction).toBeDisabled();
 await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.locator('.working')).toContainText('Transcribing...');await expect(page.locator('.working>span')).toBeVisible();await expect(page.locator('.working')).toBeInViewport();
 await expect(instruction).toBeDisabled();await expect(page.getByRole('button',{name:'Type instruction'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Send'})).toBeDisabled();
 await page.screenshot({path:info.outputPath('assistant-transcribing.png'),fullPage:true});finish();
 await expect(instruction).toHaveValue('Add a bath at six.');await expect(instruction).toBeEditable();await expect(page.locator('.working')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Send'})).toBeEnabled();
 await page.getByRole('button',{name:'Close Assistant'}).click();await expect(page).toHaveURL(/\/$/);
 await page.goBack();await expect(page).toHaveURL(/\/assistant$/);await expect(instruction).toBeEditable();
 await expect(instruction).toBeEditable();await instruction.fill('Add a nappy change now.');
 await expect(page.getByRole('button',{name:'Send'})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a new instruction resets chat context and restores the editable composer',async({page})=>{
 await fakeMicrophone(page);let calls=0;
 await page.route('**/api/assistant',route=>{const input=route.request().postDataJSON();expect(input.conversation).toEqual([]);calls++;return route.fulfill({json:{message:'Which time?',proposal:null}});});
 await page.route('**/api/transcribe',route=>route.fulfill({json:{text:'Add a bath.',diagnostics:{diagnosticId:'synthetic-reset',durationSeconds:1}}}));
 await page.goto('/assistant');await page.getByRole('button',{name:'Record voice',exact:true}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(page.getByLabel('Your instruction')).toHaveValue('Add a bath.');await page.getByRole('button',{name:'Send'}).click();
 await expect(page.getByRole('log',{name:'Conversation'})).toContainText('Add a bath.');await expect(page.getByLabel('Your reply')).toBeVisible();await expect(page.getByRole('region',{name:'Recording playback'})).toBeVisible();
 await page.getByRole('button',{name:'New instruction',exact:true}).click();await expect(page.locator('.chat-messages')).toBeEmpty();await expect(page.getByRole('region',{name:'Recording playback'})).toHaveCount(0);await expect(page.getByText('Speech diagnostics',{exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Recorded transcript'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeFocused();await expect(page.getByLabel('Your instruction')).toHaveValue('');await expect(page.getByLabel('Your instruction')).toBeEditable();
 await page.getByLabel('Your instruction').fill('Add a nappy.');await page.getByRole('button',{name:'Send'}).click();await expect(page.getByLabel('Your reply')).toBeVisible();expect(calls).toBe(2);
});

test('cancelling a proposal keeps the chat and supports a revised instruction',async({page,request})=>{
 let calls=0;let rejected=0;
 const entry={activity:'bath',startAt:'2026-11-03T13:00:00Z',endAt:null,status:'completed',pee:false,poo:false,temperature:null,notes:''};
 const proposal=(id:string,startAt:string)=>({id,summary:'Add a bath.',operations:[{type:'create_entry',entry:{...entry,startAt}}],targets:[]});
 await page.route('**/api/assistant',route=>{const body=route.request().postDataJSON();calls++;if(calls===1)return route.fulfill({json:{message:'Add a bath.',proposal:proposal('first','2026-11-03T13:00:00Z')}});expect(body.command).toBe('Use 3 pm instead.');expect(body.conversation[0].command).toBe('Add a bath at 2 pm.');expect(body.conversation[0].reply).toContain('Add a bath.');expect(body.conversation[0].reply).toContain('Changes cancelled.');return route.fulfill({json:{message:'Add a bath.',proposal:proposal('revised','2026-11-03T14:00:00Z')}});});
 await page.route('**/api/proposals/first/reject',route=>{rejected++;return route.fulfill({json:{ok:true}});});
 await page.route('**/api/proposals/revised/confirm',async route=>{await request.post('/api/entries',{data:{...entry,startAt:'2026-11-03T14:00:00Z'}});return route.fulfill({json:{ok:true}});});
 await page.goto('/assistant');await page.getByLabel('Your instruction').fill('Add a bath at 2 pm.');await page.getByRole('button',{name:'Send'}).click();
 await page.getByRole('button',{name:'Cancel changes'}).click();await expect(page.getByRole('button',{name:'Record reply',exact:true})).toBeFocused();await expect(page.getByRole('log',{name:'Conversation'})).toContainText('Add a bath at 2 pm.');await expect(page.getByRole('log',{name:'Conversation'})).toContainText('Changes cancelled.');
 const restored=page.getByLabel('Your reply');
 await restored.fill(Array.from({length:8},(_,i)=>`Care action ${i+1}.`).join('\n'));
 expect((await restored.boundingBox())!.height).toBeGreaterThan(150);
 expect(await restored.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(2);
 expect(await (await request.get('/api/entries')).json()).toHaveLength(0);await page.getByLabel('Your reply').fill('Use 3 pm instead.');await page.getByRole('button',{name:'Send'}).click();
 await expect(page.locator('.proposal')).toContainText('15:00');expect(rejected).toBe(1);expect(await (await request.get('/api/entries')).json()).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm changes'}).click();await expect(page.getByRole('region',{name:'Assistant',exact:true})).toHaveCount(0);const saved=await (await request.get('/api/entries')).json();expect(saved).toHaveLength(1);expect(saved[0].startAt).toBe('2026-11-03T14:00:00.000Z');
});

test('conversation retains early corrections and stops at its limit without dropping messages',async({page})=>{
 let calls=0;
 await page.route('**/api/assistant',route=>{
  const body=route.request().postDataJSON();
  if(calls<24){
   expect(body.conversation).toHaveLength(calls);
   if(calls>0)expect(body.conversation[0].command).toBe('Log a bath at 7:45.');
   if(calls>1)expect(body.conversation[1].command).toBe('Yesterday.');
  }else expect(body.conversation).toEqual([]);
  calls++;return route.fulfill({json:{message:'Which detail?',proposal:null,interpretedAt:'2026-11-06T19:41:00Z'}});
 });
 await page.goto('/assistant');await page.getByLabel('Your instruction').fill('Log a bath at 7:45.');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 for(let i=1;i<24;i++){
  const field=page.getByLabel('Your reply');await expect(field).toBeEditable();await field.fill(i===1?'Yesterday.':`Keep detail ${i}.`);
  await page.getByRole('button',{name:'Send',exact:true}).click();await expect(field).toHaveValue('');
 }
 await page.getByLabel('Your reply').fill('PM');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Start a new instruction');expect(calls).toBe(24);
 await expect(page.getByLabel('Your reply')).toHaveValue('PM');await expect(page.getByRole('log',{name:'Conversation'})).toContainText('Yesterday.');
 await page.getByRole('button',{name:'New instruction',exact:true}).click();
 await page.getByLabel('Your instruction').fill('Log a bath now.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByLabel('Your reply')).toBeEditable();expect(calls).toBe(25);
});

test('Assistant keeps voice controls and removes Shortcut setup links and pages',async({page,request})=>{
 await page.goto('/assistant');
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Type instruction',exact:true})).toHaveCount(0);
 await page.getByText('Examples',{exact:true}).click();await expect(page.getByRole('link',{name:'Set up Siri'})).toHaveCount(0);
 const response=await request.get('/siri/setup');expect(response.status()).toBe(404);
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeVisible();
});

test('service worker activation removes cached Shortcut setup pages and old application code',async({page,context})=>{
 await page.goto('/assistant');await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.ready;await registration.unregister();
  const cache=await caches.open('babylog-shell-v1');
  await cache.put('/siri/setup',new Response('<h1>Set up Siri</h1>',{headers:{'Content-Type':'text/html'}}));
  await cache.put('/assets/retired-siri.js',new Response('old setup code'));
 });
 await page.reload();await page.evaluate(()=>navigator.serviceWorker.ready);
 await expect.poll(()=>page.evaluate(async()=>(await caches.keys()).includes('babylog-shell-v1'))).toBe(false);
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeVisible();
 await context.setOffline(true);await page.goto('/siri/setup');
 await expect(page.getByRole('heading',{name:'Set up Siri'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Babylog is offline'})).toBeVisible();await context.setOffline(false);
});

test('one editable composer supports direct typing, multiline text, failed send, and reply',async({page},info)=>{
 await fakeMicrophone(page);let attempts=0;
 const command='Add a bath at six.\nAdd a nappy change at seven.';
 await page.route('**/api/assistant',route=>{
  attempts++;expect(route.request().postDataJSON().command).toBe(command);
  return attempts===1?route.fulfill({status:503,json:{error:'Try again.'}}):route.fulfill({json:{message:'Was that today?',proposal:null}});
 });
 await page.goto('/assistant');
 const field=page.getByRole('textbox',{name:'Your instruction',exact:true}),send=page.getByRole('button',{name:'Send',exact:true}),mic=page.getByRole('button',{name:'Record voice',exact:true});
 await expect(field).toBeEditable();await expect(field).toHaveAttribute('placeholder','Give your logging instruction here');
 await expect(page.getByRole('button',{name:'Type instruction'})).toHaveCount(0);
 await expect(page.getByText('Wait for Recording before you speak.',{exact:true})).toHaveCount(0);
 await expect(send).toBeDisabled();await field.fill('  \n  ');await expect(send).toBeDisabled();
 await field.fill('Add a bath at six.');await field.press('Enter');await field.pressSequentially('Add a nappy change at seven.');
 await expect(field).toHaveValue(command);expect(attempts).toBe(0);
 await send.click();await expect(page.getByRole('alert')).toContainText('Try again.');await expect(field).toHaveValue(command);
 await send.click();const reply=page.getByRole('textbox',{name:'Your reply',exact:true});await expect(reply).toBeEditable();
 await expect(reply).toHaveAttribute('placeholder','Give your reply here');await expect(send).toBeDisabled();
 await reply.fill('Today.');await expect(send).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).microphone.calls)).toBe(0);
 await page.screenshot({path:info.outputPath('assistant-direct-reply.png'),fullPage:true});
});

test('long instructions and replies scroll inside the composer without losing text',async({page},info)=>{
 const text=Array.from({length:70},(_,i)=>`Care instruction ${i+1}: keep this text.`).join('\n');
 await page.route('**/api/assistant',route=>{
  expect(route.request().postDataJSON().command).toBe(text);
  return route.fulfill({json:{message:'Which event needs a time?',proposal:null}});
 });
 await page.goto('/assistant');
 for(const name of ['Your instruction','Your reply']){
  const field=page.getByRole('textbox',{name,exact:true});
  if(name==='Your reply')expect((await field.boundingBox())!.height).toBeLessThanOrEqual(90);
  await field.fill(text);
  const metrics=await field.evaluate(el=>{
   const area=el as HTMLTextAreaElement;area.scrollTop=0;const top=area.scrollTop;
   area.scrollTop=area.scrollHeight;
   return {top,bottom:area.scrollTop,height:area.clientHeight,content:area.scrollHeight,overflow:getComputedStyle(area).overflowY};
  });
  expect(metrics.overflow).toBe('auto');expect(metrics.content).toBeGreaterThan(metrics.height);
  expect(metrics.height).toBeGreaterThan(150);
  expect(metrics.bottom).toBeGreaterThan(metrics.top);await expect(field).toHaveValue(text);
  await field.press('ControlOrMeta+End');await field.pressSequentially(' End.');
  expect(await field.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThanOrEqual(2);
  await expect(field).toHaveValue(text+' End.');await field.fill(text);
  await page.getByRole('button',{name:'Send',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:name==='Your reply'?'Record reply':'Record voice',exact:true})).toBeInViewport();
  if(name==='Your instruction')await page.getByRole('button',{name:'Send',exact:true}).click();
 }
 await page.screenshot({path:info.outputPath('assistant-scroll.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('recorded instructions use the available space and shrink after editing',async({page},info)=>{
 await fakeMicrophone(page);
 const text=Array.from({length:8},(_,i)=>`Care action ${i+1}.`).join('\n');
 await page.route('**/api/transcribe',route=>route.fulfill({json:{text}}));
 await page.goto('/assistant');const field=page.getByLabel('Your instruction');
 const initial=(await field.boundingBox())!.height;
 await page.getByRole('button',{name:'Record voice',exact:true}).click();await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(field).toHaveValue(text);
 await expect(page.getByText('Review the transcript before continuing.',{exact:true})).toHaveCount(0);
 await expect(page.locator('.assistant-welcome')).toHaveCount(0);
 const box=(await field.boundingBox())!,heading=(await page.locator('.assistant-page .page-heading').boundingBox())!;
 expect(box.height).toBeGreaterThan(initial+60);expect(box.y-heading.y-heading.height).toBeLessThan(65);
 expect(await field.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(2);
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport();
 await page.screenshot({path:info.outputPath('assistant-expanded-instruction.png'),fullPage:true});
 await field.fill('Bath at six.');expect((await field.boundingBox())!.height).toBeLessThan(box.height);
 await field.fill('A longer instruction. '.repeat(100));
 await page.setViewportSize({width:568,height:390});
 expect((await field.boundingBox())!.height).toBeLessThanOrEqual(196);
 await page.getByRole('button',{name:'Record voice',exact:true}).scrollIntoViewIfNeeded();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport();
 await field.fill('');expect((await field.boundingBox())!.height).toBeLessThanOrEqual(initial+2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('composer icons keep touch targets and placement in a compact viewport',async({page},info)=>{
 await page.goto('/assistant');
 const composer=page.locator('.instruction-composer'),field=page.getByLabel('Your instruction');
 const mic=page.getByRole('button',{name:'Record voice',exact:true}),send=page.getByRole('button',{name:'Send',exact:true});
 for(const button of [mic,send]){
  const box=(await button.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  expect((await button.textContent())?.trim()).toBe('');
 }
 const micBox=(await mic.boundingBox())!,sendBox=(await send.boundingBox())!,fieldBox=(await field.boundingBox())!;
 expect(micBox.x).toBeGreaterThanOrEqual(sendBox.x+sendBox.width+7);
 expect(micBox.y).toBeGreaterThanOrEqual(fieldBox.y+fieldBox.height);
 await page.screenshot({path:info.outputPath('assistant-icons.png'),fullPage:true});
 await page.setViewportSize({width:info.project.name==='ipad'?507:568,height:390});
 await field.fill('A long instruction. '.repeat(120));await mic.scrollIntoViewIfNeeded();await expect(mic).toBeInViewport();
 await expect(send).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await mic.scrollIntoViewIfNeeded();await expect(mic).toBeVisible();
 expect(await composer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('recognized text stays editable and processing locks both input actions',async({page},info)=>{
 await fakeMicrophone(page);let sends=0,finish:()=>void=()=>{};
 const waiting=new Promise<void>(resolve=>{finish=resolve;});
 await page.route('**/api/transcribe',route=>route.fulfill({json:{text:'Bath at six.'}}));
 await page.route('**/api/assistant',async route=>{
  sends++;expect(route.request().postDataJSON().command).toBe('Bath at seven.');await waiting;
  await route.fulfill(sends===1?{status:503,json:{error:'Try again.'}}:{json:{message:'Which date?',proposal:null}});
 });
 await page.goto('/assistant');await page.getByRole('button',{name:'Record voice',exact:true}).click();
 const stop=page.getByRole('button',{name:'Stop recording',exact:true});await expect(stop).toHaveAttribute('aria-pressed','true');
 await expect(stop.locator('svg rect')).toBeVisible();await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
 await page.screenshot({path:info.outputPath('assistant-recording.png'),fullPage:true});
 await expect(page.locator('.recording-time')).toContainText('Microphone signal detected');await page.waitForTimeout(350);await stop.click();const field=page.getByLabel('Your instruction');await expect(field).toHaveValue('Bath at six.');
 await field.fill('Bath at seven.');expect(sends).toBe(0);await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('.working')).toContainText('Preparing changes...');await expect(field).toBeDisabled();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeDisabled();
 await page.locator('.instruction-composer').evaluate(form=>(form as HTMLFormElement).requestSubmit());expect(sends).toBe(1);finish();await expect(page.getByRole('alert')).toContainText('Try again.');await expect(field).toBeEditable();await expect(field).toHaveValue('Bath at seven.');await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeFocused();await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByLabel('Your reply')).toBeEditable();expect(sends).toBe(2);
 await expect(page.getByRole('button',{name:'Record reply',exact:true})).toBeFocused();
});
