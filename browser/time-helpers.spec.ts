import {expectEntryTime,readEntryTime} from './entry-time-helpers.ts';
import {expectEndTime} from './entry-time-helpers.ts';
import {typeEntryTime,setWheel,showEndTime} from './entry-time-helpers.ts';
import {test,expect,saveEntry} from './test.ts';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date('2026-11-09T14:30:17.123Z'));
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Sleep',exact:true}).click();await showEndTime(page);
});

test('ago uses today on an older diary day and preserves exact generated start timestamps',async({page,request})=>{
 await page.getByLabel('Still in progress').check();
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-01');
 await page.getByRole('button',{name:'Set start time 15 minutes ago',exact:true}).click();
 await expectEntryTime(page,'start','2026-11-09T15:15');
 await expectEndTime(page,'');
 await page.getByLabel('Still in progress').check();await saveEntry(page);
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-11-09T14:15:17.123Z');expect(entry.status).toBe('active');expect(entry.endAt).toBeNull();
});

test('custom ago amounts change only their target and Set never saves the entry',async({page,request})=>{
 await typeEntryTime(page,'start','2026-11-09T12:00');
 await page.getByRole('button',{name:'End relative time',exact:true}).click();const panel=page.locator('#end-helper');
 await panel.getByRole('button',{name:'Ago',exact:true}).click();
 await setWheel(page,'End relative minutes',70,120);
 await expect(panel.locator('time')).toHaveAttribute('datetime','2026-11-09T13:20:17.123Z');
 await page.getByRole('button',{name:'Set end',exact:true}).click();
 await expectEndTime(page,'2026-11-09T14:20');await expect(panel).toBeHidden();
 await expect(page.getByRole('button',{name:'End relative time',exact:true})).toBeFocused();
 await expectEntryTime(page,'start','2026-11-09T12:00');expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await page.getByRole('button',{name:'End relative time',exact:true}).click();await expect(page.getByRole('listbox',{name:'End relative minutes',exact:true})).toHaveAttribute('aria-activedescendant','End-relative-minutes-70');
});

test('duration helpers set either endpoint across midnight and stay separate from saving',async({page,request})=>{
 await typeEntryTime(page,'start','2026-11-09T23:30');
 await page.getByRole('button',{name:'End relative time',exact:true}).click();const end=page.locator('#end-helper');
 await expect(end.getByRole('button',{name:'After start',exact:true})).toHaveAttribute('aria-pressed','true');
 await end.getByRole('button',{name:'60 minutes',exact:true}).click();await page.getByRole('button',{name:'Set end',exact:true}).click();
 await expectEndTime(page,'2026-11-10T00:30');
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();const start=page.locator('#start-helper');
 await start.getByRole('button',{name:'Before end',exact:true}).click();await start.getByRole('button',{name:'30 minutes',exact:true}).click();await page.getByRole('button',{name:'Set start',exact:true}).click();
 await expectEntryTime(page,'start','2026-11-10T00:00');await expectEndTime(page,'2026-11-10T00:30');
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await saveEntry(page);const [entry]=await (await request.get('/api/entries')).json();expect(Date.parse(entry.endAt)-Date.parse(entry.startAt)).toBe(30*60000);
});

test('missing and invalid anchors cannot apply the helper',async({page,request})=>{
 await page.getByLabel('Still in progress').check();
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();const panel=page.locator('#start-helper');
 await panel.getByRole('button',{name:'Before end',exact:true}).click();await expect(panel).toContainText('Enter a valid end time first.');await expect(page.getByRole('button',{name:'Set start',exact:true})).toBeDisabled();
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await panel.getByRole('button',{name:'Ago',exact:true}).click();await expect(page.getByRole('button',{name:'Set start',exact:true})).toBeEnabled();
 await typeEntryTime(page,'end','2026-03-29T02:30');await page.getByRole('button',{name:'Start relative time',exact:true}).click();await panel.getByRole('button',{name:'Before end',exact:true}).click();await expect(page.getByRole('button',{name:'Set start',exact:true})).toBeDisabled();
});

test('manual time changes close either helper without changing the other time or saving',async({page,request},info)=>{
 await typeEntryTime(page,'end','2026-11-09T17:00');
 for(const field of ['start','end'] as const)for(const open of ['start','end']){
  const other=field==='start'?'end':'start',previous=await readEntryTime(page,other);
  const toggle=page.getByRole('button',{name:`${open==='start'?'Start':'End'} relative time`,exact:true}),panel=page.locator(`#${open}-helper`);
  await toggle.click();await expect(panel).toBeVisible();
  const input=page.getByRole('listbox',{name:(field==='start'?'Start':'End')+' minute',exact:true});
  await input.focus();await expect(panel).toBeVisible();
  const value=`2026-11-09T${field==='start'?'14':'18'}:${open==='start'?'20':'25'}`;
  await typeEntryTime(page,field,value);expect(await readEntryTime(page,field)).toBe(value);
  await expect(panel).toBeHidden();await expect(toggle).toHaveAttribute('aria-expanded','false');expect(await readEntryTime(page,other)).toBe(previous);
  expect(await (await request.get('/api/entries')).json()).toEqual([]);
 }
 await page.screenshot({path:info.outputPath('manual-time-collapsed.png')});
 await saveEntry(page);const [saved]=await (await request.get('/api/entries')).json();
 expect(saved.startAt).toBe('2026-11-09T13:25:00.000Z');expect(saved.endAt).toBe('2026-11-09T17:25:00.000Z');
});

test('clearing End closes helpers and reopening retains their custom amount',async({page,request})=>{
 await page.getByRole('button',{name:'Set start time 15 minutes ago',exact:true}).click();await page.getByRole('button',{name:'Set end time to now',exact:true}).click();
 for(const field of ['end'] as const){
  const panel=page.locator(`#${field}-helper`),toggle=page.getByRole('button',{name:'End relative time',exact:true});
  await toggle.click();await setWheel(page,'End relative minutes',25,120);await expect(panel).toBeVisible();
  await typeEntryTime(page,field,'');await expect(panel).toBeHidden();await showEndTime(page);
  await toggle.click();await expect(page.getByRole('listbox',{name:'End relative minutes',exact:true})).toHaveAttribute('aria-activedescendant','End-relative-minutes-25');await toggle.click();
 }
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
});

test('exact autumn start and end survive a failed save, collapse, and navigation',async({page,request})=>{
 await page.clock.setFixedTime(new Date('2026-10-25T01:10:17.123Z'));
 await page.getByRole('button',{name:'Set end time to now',exact:true}).click();
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();const panel=page.locator('#start-helper');
 await panel.getByRole('button',{name:'Before end',exact:true}).click();await page.getByRole('button',{name:'Set start',exact:true}).click();
 await expectEntryTime(page,'start','2026-10-25T02:55');await expectEndTime(page,'2026-10-25T02:10');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Time log',exact:true}).click();
 await page.unroute('**/api/entry-saves/*');await saveEntry(page);
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-10-25T00:55:17.123Z');expect(entry.endAt).toBe('2026-10-25T01:10:17.123Z');
});

test('the ago preview refreshes and Set uses the exact tap time',async({page,request})=>{
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();const panel=page.locator('#start-helper');
 await expect(panel.locator('time')).toContainText('15:15');
 await page.clock.setFixedTime(new Date('2026-11-09T14:35:42.456Z'));await expect(panel.locator('time')).toContainText('15:20');
 await page.clock.setFixedTime(new Date('2026-11-09T14:35:50.789Z'));
 await page.getByRole('button',{name:'Set start',exact:true}).click();await expectEntryTime(page,'start','2026-11-09T15:20');
 await saveEntry(page);const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-11-09T14:20:50.789Z');
});

test('helpers stay disabled during saving and retain wheel values after failure',async({page})=>{
 await page.getByRole('button',{name:'End relative time',exact:true}).click();const panel=page.locator('#end-helper');
 await setWheel(page,'End relative minutes',25,120);
 let finish:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{finish=resolve;});
 await page.route('**/api/entry-saves/*',async route=>{if(route.request().method()==='POST'){await waiting;await route.fulfill({status:503,json:{error:'Try again.'}});}else await route.continue();});
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('button',{name:'Saving...',exact:true})).toBeDisabled();
 const wheel=page.getByRole('listbox',{name:'End relative minutes',exact:true});await expect(wheel).toHaveAttribute('aria-disabled','true');await expect(wheel).toHaveCSS('overflow-y','hidden');
 for(const control of await page.locator('.time-shortcuts button,.time-helper-toggle,#end-helper button,#end-helper input').all())await expect(control).toBeDisabled();
 finish();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');await expect(page.getByRole('listbox',{name:'End relative minutes',exact:true})).toHaveAttribute('aria-activedescendant','End-relative-minutes-25');await expect(page.getByRole('button',{name:'Set end',exact:true})).toBeEnabled();
});

test('an edited start uses the original exact autumn end without changing that end',async({page,request})=>{
 const original={activity:'sleep',startAt:'2026-10-25T00:00:00.000Z',endAt:'2026-10-25T01:10:17.123Z',notes:'Keep the exact end.'};
 expect((await request.post('/api/entries',{data:original})).status()).toBe(201);
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-10-25');await page.getByRole('button',{name:'Edit Sleep at 02:00',exact:true}).click();await page.getByRole('button',{name:'Change start time',exact:true}).click();
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();const panel=page.locator('#start-helper');await panel.getByRole('button',{name:'Before end',exact:true}).click();
 await page.getByRole('button',{name:'Set start',exact:true}).click();await saveEntry(page,'Save changes');
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-10-25T00:55:17.123Z');expect(entry.endAt).toBe(original.endAt);expect(entry.notes).toBe(original.notes);
});

test('helper panels keep one disclosure, separate targets, and no phone overflow',async({page},info)=>{
 for(const width of [info.project.use.viewport!.width,320]){
  await page.setViewportSize({width,height:1000});
  await page.getByRole('button',{name:'Start relative time',exact:true}).click();await expect(page.locator('#start-helper')).toBeVisible();
  await page.getByRole('button',{name:'End relative time',exact:true}).click();await expect(page.locator('#start-helper')).toBeHidden();
  const panel=page.locator('#end-helper');await expect(panel).toBeVisible();
  for(const group of await page.locator('.time-shortcuts,.time-helper-modes:visible,.time-helper-presets:visible,.time-helper-amount:visible').all()){
   const boxes=await group.locator('button,input').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().toJSON()));
   for(const [i,a] of boxes.entries()){
    expect(a.width).toBeGreaterThanOrEqual(44);expect(a.height).toBeGreaterThanOrEqual(44);expect(a.left).toBeGreaterThanOrEqual(0);expect(a.right).toBeLessThanOrEqual(width);
    for(const b of boxes.slice(i+1))expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBe(true);
   }
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'End relative time',exact:true}).click();
 }
 await page.setViewportSize(info.project.use.viewport!);await page.getByRole('button',{name:'End relative time',exact:true}).click();await page.locator('#end-helper').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('time-helpers.png'),fullPage:true});
});


test('relative controls form one bounded group apart from the clock and Save',async({page,request},info)=>{
 for(const width of [info.project.use.viewport!.width,320]){
  await page.setViewportSize({width,height:1000});
  await page.getByRole('button',{name:'Set end time to now',exact:true}).click();
  for(const field of ['start','end'] as const){
   const name=field==='start'?'Start':'End',toggle=page.getByRole('button',{name:name+' relative time',exact:true});
   const group=toggle.locator('..'),panel=page.locator('#'+field+'-helper');
   await expect(toggle).toHaveText('Relative time');await expect(toggle).toHaveAttribute('aria-expanded','false');
   const before=await readEntryTime(page,field);
   await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
   await expect(group.getByRole('button',{name:'Set '+field,exact:true})).toBeVisible();
   await expect(page.locator('.entry-save-footer').getByRole('button',{name:/^Set /})).toHaveCount(0);
   const bounds=await group.boundingBox(),button=await toggle.boundingBox();
   const shortcuts=await group.locator('..').locator('.time-shortcuts').boundingBox();
   expect(bounds!.y-shortcuts!.y-shortcuts!.height).toBeGreaterThanOrEqual(8);
   expect(bounds!.width-button!.width).toBeLessThanOrEqual(2);expect(button!.height).toBeGreaterThanOrEqual(44);
   const parts=await group.locator('.time-helper-modes,.time-helper-presets,.time-helper-amount,.time-helper-preview,.time-helper-apply').all();
   for(const part of parts){const box=(await part.boundingBox())!;expect(box.x).toBeGreaterThan(bounds!.x);expect(box.x+box.width).toBeLessThan(bounds!.x+bounds!.width);expect(box.y+box.height).toBeLessThan(bounds!.y+bounds!.height);}
   const dates=(await group.locator('..').locator('.entry-date-choices').boundingBox())!;
   expect(dates.y-bounds!.y-bounds!.height).toBeGreaterThanOrEqual(12);
   if(width===info.project.use.viewport!.width){await group.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(field+'-relative-group.png')});}
   await panel.getByRole('button',{name:'30 minutes',exact:true}).click();
   await toggle.focus();await toggle.press('Enter');await expect(panel).toBeHidden();
   expect(await readEntryTime(page,field)).toBe(before);
   await toggle.press('Enter');await expect(page.getByRole('listbox',{name:name+' relative minutes',exact:true})).toHaveAttribute('aria-activedescendant',name+'-relative-minutes-30');
   await toggle.press('Enter');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
});

test('short total shortcuts use the current start across midnight without saving',async({page,request})=>{
 await typeEntryTime(page,'start','2026-11-09T23:55');
 for(const minutes of [5,10,15]){
  await page.getByRole('button',{name:`Set end time ${minutes} minutes after start`,exact:true}).click();
  await expectEndTime(page,`2026-11-10T00:${String(minutes-5).padStart(2,'0')}`);
  await expectEntryTime(page,'start','2026-11-09T23:55');
 }
 await typeEntryTime(page,'start','2026-11-09T12:00');
 await page.getByRole('button',{name:'Set end time 5 minutes after start',exact:true}).click();
 await expectEndTime(page,'2026-11-09T12:05');
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await saveEntry(page);
 const [entry]=await (await request.get('/api/entries')).json();
 expect(Date.parse(entry.endAt)-Date.parse(entry.startAt)).toBe(5*60000);
});

test('short total shortcuts preserve an edited exact start and reject invalid start times',async({page,request})=>{
 const startAt='2026-10-25T01:55:17.123Z';
 expect((await request.post('/api/entries',{data:{activity:'sleep',startAt,status:'active'}})).status()).toBe(201);
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-10-25');
 await page.getByRole('button',{name:'Edit Sleep at 02:55',exact:true}).click();await showEndTime(page);
 await page.getByRole('button',{name:'Set end time 10 minutes after start',exact:true}).click();
 await expectEndTime(page,'2026-10-25T03:05');
 await saveEntry(page,'Save changes');
 const [entry]=await (await request.get('/api/entries')).json();
 expect(entry.startAt).toBe(startAt);expect(entry.endAt).toBe('2026-10-25T02:05:17.123Z');
 await page.getByRole('button',{name:'Edit Sleep at 02:55',exact:true}).click();await showEndTime(page);
 await typeEntryTime(page,'start','2026-03-29T02:30');
 for(const minutes of [5,10,15])await expect(page.getByRole('button',{name:`Set end time ${minutes} minutes after start`,exact:true})).toBeDisabled();
});

test('compact shortcuts fit standard phones and retain large touch targets with enlarged text',async({page},info)=>{
 for(const width of [390,430,320]){
  await page.setViewportSize({width,height:1000});
  const groups=page.locator('.time-shortcuts');
  for(const group of await groups.all()){
   const buttons=group.locator('button');
   const boxes=await buttons.evaluateAll(elements=>elements.map(element=>{
    const target=element.getBoundingClientRect(),label=element.querySelector('span')!.getBoundingClientRect();
    return {x:target.x,y:target.y,width:target.width,height:target.height,labelHeight:label.height};
   }));
   for(const box of boxes){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.labelHeight).toBeLessThanOrEqual(28);}
   if(width>=390)expect(new Set(boxes.map(box=>box.y)).size).toBe(1);
  }
  await page.screenshot({path:info.outputPath('compact-shortcuts-'+width+'.png'),fullPage:true});
 }
 await page.locator('.time-shortcuts button').evaluateAll(elements=>elements.forEach(element=>(element as HTMLElement).style.fontSize='20px'));
 for(const group of await page.locator('.time-shortcuts').all()){
  const boxes=await group.locator('button').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().toJSON()));
  for(const [index,box] of boxes.entries()){
   expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);
   for(const other of boxes.slice(index+1))expect(box.right<=other.left||other.right<=box.left||box.bottom<=other.top||other.bottom<=box.top).toBe(true);
  }
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
