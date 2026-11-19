import {expectEntryTime} from './entry-time-helpers.ts';
import {expectEndTime} from './entry-time-helpers.ts';
import {typeEntryTime,showEndTime} from './entry-time-helpers.ts';
import {test,expect,saveEntry} from './test.ts';
test.use({serviceWorkers:'block'});

const quickEndName='Set end time 15 minutes after start';

test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date('2026-11-07T14:00:00Z'));
 await page.goto('/');
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-07');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('button',{name:'Sleep',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-07T13:10');await showEndTime(page);
});

test('15min replaces the end from the current start for new and edited events',async({page,request})=>{
 const quick=page.getByRole('button',{name:quickEndName});
 await typeEntryTime(page,'end','2026-11-07T14:00');await quick.click();await expectEndTime(page,'2026-11-07T13:25');
 await quick.click();await expectEndTime(page,'2026-11-07T13:25');
 await typeEntryTime(page,'start','2026-11-07T13:20');
 await quick.click();await expectEndTime(page,'2026-11-07T13:35');
 expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText('13:20 - 13:35');
 await page.getByRole('button',{name:'Edit Sleep at 13:20',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-07T13:40');
 await quick.click();await expectEndTime(page,'2026-11-07T13:55');
 await saveEntry(page,'Save changes');
 const [entry]=await (await request.get('/api/entries')).json();
 expect(entry.startAt).toBe('2026-11-07T12:40:00.000Z');expect(entry.endAt).toBe('2026-11-07T12:55:00.000Z');
});

test('overnight 15min drafts survive failure, collapse, and navigation',async({page,request})=>{
 await typeEntryTime(page,'start','2026-11-07T23:55');
 await page.getByRole('button',{name:quickEndName}).click();
 await expectEndTime(page,'2026-11-08T00:10');
 await page.getByLabel('Notes').fill('Keep this overnight draft.');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByRole('button',{name:'Time log',exact:true}).click();
 await expectEndTime(page,'2026-11-08T00:10');
 await expect(page.getByLabel('Notes')).toHaveValue('Keep this overnight draft.');
 await page.unroute('**/api/entry-saves/*');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText('23:55 - 00:10 (2026-11-08)');
 const [entry]=await (await request.get('/api/entries')).json();expect(Date.parse(entry.endAt)-Date.parse(entry.startAt)).toBe(15*60_000);
});

test('invalid starts disable 15min while Now, manual ends, and active timers keep their behavior',async({page,request})=>{
 const quick=page.getByRole('button',{name:quickEndName});
 await typeEntryTime(page,'start','2026-03-29T02:30');await expect(quick).toBeDisabled();
 await page.getByRole('button',{name:'Set start time to now',exact:true}).click();await expectEntryTime(page,'start','2026-11-07T15:00');
 await typeEntryTime(page,'start','2026-11-07T13:10');await quick.click();
 await page.getByRole('button',{name:'Set end time to now',exact:true}).click();await expectEndTime(page,'2026-11-07T15:00');
 await page.getByLabel('Still in progress').check();await expect(quick).toBeHidden();
 await page.getByLabel('Still in progress').uncheck();await expectEndTime(page,'2026-11-07T13:10');
 await quick.click();await typeEntryTime(page,'end','2026-11-07T13:40');
 await saveEntry(page);
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.endAt).toBe('2026-11-07T12:40:00.000Z');
 await page.getByRole('button',{name:'Edit Sleep at 13:10',exact:true}).click();
 await quick.click();await typeEntryTime(page,'end','');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 const [cleared]=await (await request.get('/api/entries')).json();expect(cleared.endAt).toBeNull();
});

test('15min preserves the exact autumn occurrence and seconds through draft restoration and save retry',async({page,request})=>{
 const created=await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-10-25T00:55:17.123Z',status:'completed',notes:'Keep the original start.'}});expect(created.status()).toBe(201);
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-10-25');
 await page.getByRole('button',{name:'Edit Sleep at 02:55',exact:true}).click();await showEndTime(page);
 await page.getByRole('button',{name:quickEndName}).click();await expectEndTime(page,'2026-10-25T02:10');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();
 await page.getByRole('button',{name:'Show entry form',exact:true}).click();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Time log',exact:true}).click();
 await page.unroute('**/api/entry-saves/*');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-10-25T00:55:17.123Z');expect(entry.endAt).toBe('2026-10-25T01:10:17.123Z');expect(entry.notes).toBe('Keep the original start.');
});

test('disclosure and time shortcuts keep aligned targets and full-width rollers',async({page},info)=>{
 const form=page.locator('#entry-form'),toggle=page.locator('#entry-toggle');
 for(const width of [info.project.use.viewport!.width,320]){
  await page.setViewportSize({width,height:1000});
  await form.scrollIntoViewIfNeeded();
  const fields=await form.locator('.time-field').evaluateAll(elements=>elements.map(field=>{
   const input=field.querySelector('.time-wheels,.empty-entry-time')!.getBoundingClientRect(),buttons=[...field.querySelectorAll('.time-shortcuts button')].filter(button=>button.getClientRects().length).map(button=>button.getBoundingClientRect());
   return {field:field.querySelector('.entry-time-section')!.getBoundingClientRect().width,input:input.width,bottom:input.top,buttons:buttons.map(box=>({width:box.width,height:box.height,top:box.top}))};
  }));
  for(const field of fields){expect(field.input).toBeCloseTo(field.field,0);for(const button of field.buttons){expect(button.width).toBeGreaterThanOrEqual(44);expect(button.height).toBeGreaterThanOrEqual(44);expect(button.top+button.height).toBeLessThanOrEqual(field.bottom-7);}}
  const openChevron=(await toggle.locator('.entry-chevron').boundingBox())!;
  await expect(toggle).toHaveAttribute('aria-controls','manual-entry');await expect(toggle).toHaveAttribute('aria-expanded','true');
  await toggle.click();await expect(form.locator('form')).toBeHidden();
  const closedChevron=(await toggle.locator('.entry-chevron').boundingBox())!;expect(Math.abs(openChevron.x-closedChevron.x)).toBeLessThanOrEqual(1);
  await expect(toggle).not.toContainText('Show');await expect(toggle).not.toContainText('Hide');
  await toggle.focus();await page.keyboard.press('Enter');await expect(form.locator('form')).toBeVisible();
  await expectEntryTime(page,'start','2026-11-07T13:10');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize(info.project.use.viewport!);await form.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('entry-time-open.png'),fullPage:true});
 await toggle.click();await page.screenshot({path:info.outputPath('entry-time-closed.png'),fullPage:true});
});
