import {expectEntryTime,readEntryTime} from './entry-time-helpers.ts';
import {test,expect} from './test.ts';
import {typeEntryTime,showEndTime} from './entry-time-helpers.ts';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date('2026-11-13T12:30:17.123Z'));
});

test('chat sends one copy and restores failed instructions and replies',async({page},info)=>{
 let release:()=>void=()=>{},attempt=0;
 await page.route('**/api/assistant',async route=>{
  attempt++;await new Promise<void>(resolve=>{release=resolve;});
  await route.fulfill(attempt===1||attempt===3?{status:503,json:{error:'Try again.'}}:{json:{message:'Which day?',proposal:null}});
 });
 await page.goto('/assistant');
 const instruction='She slept until 11:40. Then she fed for 15 minutes.\nAdd a nappy change with pee and poo. '+('Keep this care instruction in the conversation. '.repeat(35));
 await page.getByRole('textbox',{name:'Your instruction',exact:true}).fill(instruction);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('.chat-message.from-user')).toHaveText(instruction);
 await expect(page.getByRole('textbox',{name:'Your instruction',exact:true})).toHaveValue('');
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
 await expect(page.locator('.working')).toBeInViewport();
 await page.screenshot({path:info.outputPath('assistant-pending.png'),fullPage:true});
 await expect.poll(()=>attempt).toBe(1);release();await expect(page.getByRole('alert')).toContainText('Try again.');
 await expect(page.getByRole('textbox',{name:'Your instruction',exact:true})).toHaveValue(instruction);await expect(page.locator('.chat-message.from-user')).toHaveCount(0);
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('textbox',{name:'Your instruction',exact:true})).toHaveValue('');await expect.poll(()=>attempt).toBe(2);release();
 const reply=page.getByRole('textbox',{name:'Your reply',exact:true});await expect(reply).toHaveValue('');
 await reply.fill('Today.');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(reply).toHaveValue('');
 await expect(page.locator('.chat-message.from-user')).toHaveCount(2);await expect.poll(()=>attempt).toBe(3);release();
 await expect(page.getByRole('alert')).toContainText('Try again.');await expect(reply).toHaveValue('Today.');await expect(page.getByRole('alert')).toBeInViewport();
 await expect(page.locator('.chat-message.from-user')).toHaveCount(1);
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(reply).toHaveValue('');await expect.poll(()=>attempt).toBe(4);release();
 await expect(page.locator('.chat-message.from-user')).toHaveCount(2);await expect(page.locator('.chat-message.from-assistant')).toHaveCount(2);await expect(page.locator('.chat-message.from-assistant').last()).toBeInViewport();
});

test('proposal cancellation opens an empty reply without repeating the original instruction',async({page})=>{
 const proposal={id:'review',operations:[{type:'create_entry',entry:{activity:'bath',feedingType:null,breastSide:null,startAt:'2026-11-13T10:00:00Z',endAt:null,status:'completed',pee:false,poo:false,temperature:null,notes:''}}],targets:[]};
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:'Review the bath.',proposal}}));
 await page.route('**/api/proposals/review/reject',route=>route.fulfill({json:{}}));
 await page.goto('/assistant');await page.getByRole('textbox',{name:'Your instruction',exact:true}).fill('Add a bath at eleven.');
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm changes',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox')).toHaveCount(0);await expect(page.locator('.chat-message.from-user')).toHaveCount(1);
 await page.getByRole('button',{name:'Cancel changes',exact:true}).click();await expect(page.getByRole('textbox',{name:'Your reply',exact:true})).toHaveValue('');
 await expect(page.locator('.chat-message.from-user')).toHaveCount(1);
});

test('empty ends derive timers and remain available for completion and activity changes',async({page,request})=>{
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 for(const activity of ['Feeding','Sleep']){
  await page.getByRole('button',{name:activity,exact:true}).click();
  if(activity==='Feeding')await page.getByLabel('Breast side',{exact:true}).selectOption('left');
  await expect(page.getByLabel('Still in progress')).toBeChecked();
  await expect(page.getByRole('region',{name:'End time',exact:true})).toBeHidden();
  await showEndTime(page);await expect(page.getByLabel('Still in progress')).not.toBeChecked();
  await page.getByRole('button',{name:'Clear end time',exact:true}).click();await expect(page.getByLabel('Still in progress')).toBeChecked();
  await page.getByRole('button',{name:'Save entry',exact:true}).click();
  await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
  const records=await (await request.get('/api/entries')).json();expect(records.find((e:any)=>e.activity===activity.toLowerCase()).status).toBe('active');
  await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 }
 await page.getByRole('button',{name:'Bath',exact:true}).click();await expect(page.getByLabel('Still in progress')).toHaveCount(0);
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 expect((await (await request.get('/api/entries')).json()).find((e:any)=>e.activity==='bath').status).toBe('completed');
});

test('Last end uses shared history and keeps exact autumn time through failure and navigation',async({page,request})=>{
 const original='2026-10-25T01:10:17.123Z';
 const source=await (await request.post('/api/entries',{data:{activity:'bath',startAt:'2026-10-24T22:50:00Z',endAt:original}})).json();
 await request.post('/api/entries',{data:{activity:'nappy',startAt:'2026-11-13T12:00:00Z'}});
 await request.post('/api/entries',{data:{activity:'bath',startAt:'2027-01-01T00:00:00Z',endAt:'2027-01-01T00:10:00Z'}});
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Sleep',exact:true}).click();
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();
 await page.getByRole('button',{name:'Use last activity end',exact:true}).click();await expect(page.locator('#start-helper')).toBeHidden();
 await expectEntryTime(page,'start','2026-10-25T02:10');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Time log',exact:true}).click();
 await page.unroute('**/api/entry-saves/*');await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 const created=(await (await request.get('/api/entries')).json()).find((e:any)=>e.activity==='sleep');expect(created.startAt).toBe(original);expect(created.status).toBe('active');
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-10-25');await page.getByRole('button',{name:'Edit Bath at 00:50',exact:true}).click();await page.getByRole('button',{name:'Change start time',exact:true}).click();
 await expect(page.getByRole('button',{name:'Use last activity end',exact:true})).toBeDisabled();
 expect((await (await request.get('/api/entries')).json()).find((e:any)=>e.id===source.id).endAt).toBe(original);
});

test('Last end stays disabled for an empty diary and point events',async({page,request})=>{
 await request.post('/api/entries',{data:{activity:'nappy',startAt:'2026-11-13T12:00:00Z'}});
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await expect(page.getByRole('button',{name:'Use last activity end',exact:true})).toBeDisabled();
});

test('desktop mouse drag moves both ways and Save freezes the visible wheel',async({page,request},info)=>{
 test.skip(info.project.name!=='desktop','Mouse interaction uses the desktop project.');
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Sleep',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-13T10:30');
 const wheel=page.getByRole('listbox',{name:'Start minute',exact:true});await wheel.scrollIntoViewIfNeeded();const box=(await wheel.boundingBox())!;
 for(const direction of [-1,1]){
  const before=await readEntryTime(page,'start');
  await page.mouse.move(box.x+box.width/2,box.y+(direction===-1?70:18));await page.mouse.down();
  await page.mouse.move(box.x+box.width/2,box.y+(direction===-1?27:61),{steps:12});await page.waitForTimeout(200);await page.mouse.move(box.x+box.width/2,box.y+(direction===-1?26:62));await page.mouse.up();
  await expect.poll(()=>readEntryTime(page,'start')).not.toBe(before);
  await page.waitForTimeout(700);
  await expectEntryTime(page,'start',direction===-1?'2026-11-13T10:31':'2026-11-13T10:30');
  await wheel.click({position:{x:box.width/2,y:44}});await page.waitForTimeout(500);
  await expectEntryTime(page,'start',direction===-1?'2026-11-13T10:31':'2026-11-13T10:30');
 }
 await page.mouse.move(box.x+box.width/2,box.y+70);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+18,{steps:8});await page.mouse.up();
 const visible=await wheel.evaluate(element=>{
  const moving=element.querySelector<HTMLElement>('[data-rwp-highlight-list]')!;
  const minute=Math.round(-Number(moving.style.transform.match(/translateY\(([-\d.]+)px\)/)![1])/44)%60;
  (document.querySelector('#manual-entry') as HTMLFormElement).requestSubmit();return minute;
 });
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 const [saved]=await (await request.get('/api/entries')).json();expect(new Date(saved.startAt).getUTCMinutes()).toBe(visible);
 await page.waitForTimeout(700);expect((await (await request.get('/api/entries')).json())[0].startAt).toBe(saved.startAt);
 await page.screenshot({path:info.outputPath('wheel-after-save.png')});
});

test('active records complete and restart when their end changes',async({page,request})=>{
 for(const activity of ['sleep','feeding']){
  const created=await (await request.post('/api/entries',{data:{activity,feedingType:activity==='feeding'?'Bottle':null,startAt:'2026-11-13T10:00:00Z'}})).json();
  await page.goto('/');await page.getByRole('button',{name:activity==='sleep'?'Edit Sleep at 11:00':'Edit Feeding (Bottle) at 11:00',exact:true}).click();
  await showEndTime(page);await page.getByRole('button',{name:'Set end time 15 minutes after start',exact:true}).click();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
  let saved=(await (await request.get('/api/entries')).json()).find((e:any)=>e.id===created.id);expect(saved.status).toBe('completed');expect(saved.endAt).toBe('2026-11-13T10:15:00.000Z');
  await page.getByRole('button',{name:activity==='sleep'?'Edit Sleep at 11:00':'Edit Feeding (Bottle) at 11:00',exact:true}).click();
  await page.getByRole('button',{name:'Clear end time',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
  saved=(await (await request.get('/api/entries')).json()).find((e:any)=>e.id===created.id);expect(saved.status).toBe('active');expect(saved.endAt).toBeNull();
 }
});

test('wheel scrolling and touch dragging keep date and hour unchanged',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Sleep',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-13T10:30');
 const wheel=page.getByRole('listbox',{name:'Start minute',exact:true});await wheel.scrollIntoViewIfNeeded();const box=(await wheel.boundingBox())!;
 if(info.project.name==='desktop'){
  await page.mouse.move(box.x+box.width/2,box.y+44);await page.mouse.wheel(0,100);
 }else{
  const point=(y:number)=>({identifier:1,clientX:box.x+box.width/2,clientY:box.y+y});
  await wheel.locator('[data-rwp]').dispatchEvent('touchstart',{touches:[point(70)],changedTouches:[point(70)]});
  await wheel.locator('[data-rwp]').dispatchEvent('touchmove',{touches:[point(18)],changedTouches:[point(18)]});
  await wheel.locator('[data-rwp]').dispatchEvent('touchend',{touches:[],changedTouches:[point(18)]});
 }
 await expect.poll(()=>readEntryTime(page,'start')).not.toBe('2026-11-13T10:30');
 expect((await readEntryTime(page,'start')).slice(0,14)).toBe('2026-11-13T10:');
 await page.waitForTimeout(700);
 await wheel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('wheel-viewport.png')});
 await page.screenshot({path:info.outputPath('wheel-interaction.png'),fullPage:true});
});
