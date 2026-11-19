import {expectEntryTime,readEntryTime} from './entry-time-helpers.ts';
import {expectEndTime} from './entry-time-helpers.ts';
import {test,expect,saveEntry} from './test.ts';
import {typeEntryTime,showEndTime} from './entry-time-helpers.ts';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date('2026-11-11T12:30:17.123Z'));
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Sleep',exact:true}).click();
});

test('rollers update hours and minutes directly with yesterday and no calendar or confirmation',async({page,request})=>{
 const hour=page.getByRole('listbox',{name:'Start hour',exact:true}),minute=page.getByRole('listbox',{name:'Start minute',exact:true});
 await expect(hour).toHaveAttribute('aria-activedescendant','Start-hour-13');await expect(minute).toHaveAttribute('aria-activedescendant','Start-minute-30');
 await hour.focus();await page.keyboard.press('ArrowUp');await minute.focus();await page.keyboard.press('ArrowDown');
 await page.getByRole('group',{name:'Start day choices',exact:true}).getByRole('button',{name:'Yesterday',exact:true}).click();
 await expectEntryTime(page,'start','2026-11-10T12:31');expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await saveEntry(page);const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-11-10T11:31:00.000Z');expect(entry.endAt).toBeNull();
});

test('tapping and scrolling select the centered value and manual changes close relative helpers',async({page})=>{
 const minute=page.getByRole('listbox',{name:'Start minute',exact:true});
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();
 const box=(await minute.boundingBox())!;await minute.click({position:{x:box.width/2,y:77}});await expect(page.locator('#start-helper')).toBeHidden();
 await expectEntryTime(page,'start','2026-11-11T13:31');
 await minute.focus();for(let i=0;i<4;i++)await page.keyboard.press('ArrowDown');
 await expect(minute).toHaveAttribute('aria-activedescendant','Start-minute-35');await expectEntryTime(page,'start','2026-11-11T13:35');
});

test('date shortcuts use the tap date after midnight without waiting for a timer',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-11T23:01:00Z'));
 const dates=page.getByRole('group',{name:'Start day choices',exact:true});
 await dates.getByRole('button',{name:'Yesterday',exact:true}).click();await expectEntryTime(page,'start','2026-11-11T13:30');
 await dates.getByRole('button',{name:'Today',exact:true}).click();await expectEntryTime(page,'start','2026-11-12T13:30');
});

test('save preserves visible hour and minute selections for both endpoints',async({page,request})=>{
 await showEndTime(page);
 for(const [name,target] of [['Start hour',10],['Start minute',42],['End hour',12],['End minute',55]] as const){
  const wheel=page.getByRole('listbox',{name,exact:true});await wheel.focus();await page.keyboard.press('Home');for(let i=0;i<target;i++)await page.keyboard.press('ArrowDown');
 }
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-11-11T09:42:00.000Z');expect(entry.endAt).toBe('2026-11-11T11:55:00.000Z');
});

test('optional end copies Start and old exact timestamps survive untouched wheels',async({page,request})=>{
 await page.getByRole('button',{name:'Set start time 15 minutes ago',exact:true}).click();
 await showEndTime(page);
 await expectEndTime(page,'2026-11-11T13:15');
 await page.getByRole('button',{name:'Clear end time',exact:true}).click();await expect(page.getByRole('listbox',{name:'End minute',exact:true})).toHaveCount(0);
 await page.getByLabel('Still in progress').check();await expect(page.getByRole('region',{name:'End time',exact:true})).toBeHidden();
 await saveEntry(page);const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-11-11T12:15:17.123Z');
 await page.getByRole('button',{name:'Edit Sleep at 13:15',exact:true}).click();await page.getByLabel('Notes').fill('Keep the exact start.');await saveEntry(page,'Save changes');
 const [edited]=await (await request.get('/api/entries')).json();expect(edited.startAt).toBe(entry.startAt);
});

test('other dates and nonexistent spring times remain explicit and keep a failed draft',async({page})=>{
 await page.getByLabel('Start date',{exact:true}).fill('2026-03-29');
 await page.getByRole('listbox',{name:'Start hour',exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('does not exist');
 await expectEntryTime(page,'start','2026-03-29T02:30');await expect(page.locator('.entry-other-date')).toContainText('29 Mar 2026');
 await page.getByRole('listbox',{name:'Start hour',exact:true}).focus();await page.keyboard.press('ArrowDown');await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
});

test('wheel mounting, hidden draft restoration, and helper alignment do not change an autumn occurrence',async({page,request})=>{
 const original={activity:'sleep',startAt:'2026-10-25T00:55:17.123Z',endAt:'2026-10-25T01:10:17.123Z'};
 await request.post('/api/entries',{data:original});await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-10-25');await page.getByRole('button',{name:'Edit Sleep at 02:55',exact:true}).click();
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Show entry form',exact:true}).click();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Time log',exact:true}).click();
 await saveEntry(page,'Save changes');const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe(original.startAt);expect(entry.endAt).toBe(original.endAt);
});

test('tapping an unchanged wheel or date preserves generated seconds and the first autumn occurrence',async({page,request})=>{
 await page.clock.setFixedTime(new Date('2026-10-25T00:55:17.123Z'));await page.getByRole('button',{name:'Set start time to now',exact:true}).click();
 await page.getByRole('listbox',{name:'Start hour',exact:true}).click({position:{x:40,y:44}});
 await page.getByRole('listbox',{name:'Start minute',exact:true}).click({position:{x:40,y:44}});
 await page.getByRole('group',{name:'Start day choices',exact:true}).getByRole('button',{name:'Today',exact:true}).click();
 await saveEntry(page);const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-10-25T00:55:17.123Z');
});

test('sticky save stays inside the form, survives errors, and leaves the screen when the form closes',async({page},info)=>{
 await page.setViewportSize({width:Math.min(390,info.project.use.viewport!.width),height:700});
 await page.locator('.entry-time-heading').first().scrollIntoViewIfNeeded();
 const footer=page.locator('.entry-save-footer');const check=async()=>{
  const boxes=await page.locator('#manual-entry,.entry-save-footer').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().toJSON()));
  expect(boxes[1].left).toBeGreaterThanOrEqual(boxes[0].left);expect(boxes[1].right).toBeLessThanOrEqual(boxes[0].right);expect(boxes[1].bottom).toBeLessThanOrEqual(700);expect(boxes[1].top).toBeGreaterThanOrEqual(0);
  expect(await footer.getByRole('button').evaluate(element=>{const b=element.getBoundingClientRect();return element.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
 };
 await check();await page.getByLabel('Notes').fill('Keep this draft.');await check();
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(footer.getByRole('alert')).toContainText('save is unconfirmed');await check();
 await page.screenshot({path:info.outputPath('sticky-save.png')});
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await expect(footer).toBeHidden();
});

test('rollers and save fit 320px with separate 44px targets',async({page},info)=>{
 await page.setViewportSize({width:320,height:900});await showEndTime(page);
 for(const wheel of await page.getByRole('listbox').all()){
  const box=(await wheel.boundingBox())!;expect(box.height).toBe(88);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);
  expect(await wheel.locator('[data-rwp-option]').first().evaluate(e=>parseFloat(getComputedStyle(e).height))).toBe(44);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.time-field').first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('entry-rollers.png')});
 await page.setViewportSize(info.project.use.viewport!);
 await page.locator('.time-field').first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('actual-entry-rollers.png'),fullPage:true});
});

test('the save footer follows a reduced visual viewport and resets its keyboard inset',async({page})=>{
 await page.setViewportSize({width:390,height:800});
 await page.evaluate(()=>{
  const viewport=Object.assign(new EventTarget(),{height:800,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});(window as any).keyboardViewport=viewport;
 });
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByLabel('Notes').focus();
 await page.evaluate(()=>{const viewport=(window as any).keyboardViewport;viewport.height=440;viewport.offsetTop=60;viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));});
 await expect(page.locator('#entry-form')).toHaveCSS('--entry-keyboard','300px');
 await expect.poll(()=>page.getByLabel('Notes').evaluate(element=>{const rect=element.getBoundingClientRect();return document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===element;})).toBe(true);
 const box=(await page.locator('.entry-save-footer').boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(60);expect(box.y+box.height).toBeLessThanOrEqual(500);
 await page.evaluate(()=>{const viewport=(window as any).keyboardViewport;viewport.height=800;viewport.offsetTop=0;viewport.dispatchEvent(new Event('resize'));});
 await expect(page.locator('#entry-form')).toHaveCSS('--entry-keyboard','0px');
 const reset=(await page.locator('.entry-save-footer').boundingBox())!;expect(reset.y+reset.height).toBeLessThanOrEqual(800);
});

test('compact clock wheels wrap in both directions without changing the date or the other unit',async({page})=>{
 for(const [name,max,other] of [['Start hour',23,'30'],['Start minute',59,'00']] as const){
  const wheel=page.getByRole('listbox',{name,exact:true});
  await wheel.focus();await page.keyboard.press('End');await page.keyboard.press('ArrowDown');
  await expect(wheel).toHaveAttribute('aria-activedescendant',name.replaceAll(' ','-')+'-0');
  await page.keyboard.press('ArrowUp');await expect(wheel).toHaveAttribute('aria-activedescendant',name.replaceAll(' ','-')+'-'+max);
  await wheel.press('ArrowDown');
  await expect(wheel).toHaveAttribute('aria-activedescendant',name.replaceAll(' ','-')+'-0');
  await wheel.press('ArrowUp');await expect(wheel).toHaveAttribute('aria-activedescendant',name.replaceAll(' ','-')+'-'+max);
  const value=await readEntryTime(page,'start');expect(value.slice(0,10)).toBe('2026-11-11');
  expect(name==='Start hour'?value.slice(14):value.slice(11,13)).toBe(other==='00'?'23':other);
 }
});

test('relative minutes include both limits and Set applies their selection inside the relative group',async({page,request},info)=>{
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();
 const wheel=page.getByRole('listbox',{name:'Start relative minutes',exact:true});
 await expect(page.locator('#start-helper').getByLabel('Hours',{exact:true})).toHaveCount(0);
 await wheel.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowUp');
 await expect(wheel).toHaveAttribute('aria-activedescendant','Start-relative-minutes-0');
 await expect(page.getByRole('button',{name:'Set start',exact:true})).toBeEnabled();
 await page.keyboard.press('End');await page.keyboard.press('ArrowDown');await expect(wheel).toHaveAttribute('aria-activedescendant','Start-relative-minutes-120');
 const panel=page.locator('#start-helper');await expect(panel.getByRole('button',{name:'Set start',exact:true})).toBeVisible();
 await page.getByLabel('Notes').focus();
 await page.screenshot({path:info.outputPath('sticky-set.png')});
 await wheel.press('Home');for(let i=0;i<70;i++)await wheel.press('ArrowDown');await page.getByRole('button',{name:'Set start',exact:true}).click();
 await expectEntryTime(page,'start','2026-11-11T12:20');
 await expect(panel).toBeHidden();
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
});

test('zero Ago and 120 minutes Duration apply exact times without saving',async({page,request})=>{
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();
 const start=page.getByRole('listbox',{name:'Start relative minutes',exact:true});await start.focus();await page.keyboard.press('Home');
 await page.getByRole('button',{name:'Set start',exact:true}).click();await expectEntryTime(page,'start','2026-11-11T13:30');
 await showEndTime(page);await page.getByRole('button',{name:'End relative time',exact:true}).click();
 const end=page.getByRole('listbox',{name:'End relative minutes',exact:true});await end.focus();await page.keyboard.press('End');
 await page.getByRole('button',{name:'Set end',exact:true}).click();await expectEndTime(page,'2026-11-11T15:30');
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await saveEntry(page);const [entry]=await (await request.get('/api/entries')).json();
 expect(entry.startAt).toBe('2026-11-11T12:30:17.123Z');expect(entry.endAt).toBe('2026-11-11T14:30:17.123Z');
});

test('the inline Set remains reachable while Save keeps keyboard clearance',async({page},info)=>{
 await page.setViewportSize({width:390,height:800});await page.evaluate(()=>{
  const viewport=Object.assign(new EventTarget(),{height:800,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});(window as any).keyboardViewport=viewport;
 });
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await showEndTime(page);await page.getByRole('button',{name:'End relative time',exact:true}).click();await page.getByRole('button',{name:'Start relative time',exact:true}).click();
 await expect(page.getByRole('button',{name:'Set end',exact:true})).toHaveCount(0);
 await page.getByLabel('Notes').focus();
 await page.evaluate(()=>{const viewport=(window as any).keyboardViewport;viewport.height=440;viewport.offsetTop=60;viewport.dispatchEvent(new Event('resize'));});
 await expect(page.locator('#entry-form')).toHaveCSS('--entry-keyboard','300px');
 for(const name of ['Set start','Save entry']){
  const button=page.getByRole('button',{name,exact:true});
  await button.scrollIntoViewIfNeeded();
  await expect.poll(()=>button.evaluate(element=>{const b=element.getBoundingClientRect();return b.top>=60&&b.bottom<=500&&element.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
 }
 await page.screenshot({path:info.outputPath('keyboard-sticky-set.png')});
});
