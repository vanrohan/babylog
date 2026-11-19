import {test,expect,saveEntry} from './test.ts';
import {typeEntryTime,expectEndTime} from './entry-time-helpers.ts';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date('2026-11-17T12:00:17.123Z'));
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();
});
for(const activity of ['Feeding','Sleep'])test(`${activity} progress controls end-time visibility and saves active records`,async({page,request},info)=>{
 await page.getByRole('button',{name:activity,exact:true}).click();if(activity==='Feeding')await page.getByLabel('Breast side',{exact:true}).selectOption('left');
 const progress=page.getByLabel('Still in progress',{exact:true}),end=page.getByRole('region',{name:'End time',exact:true});
 await expect(progress).toBeChecked();await expect(end).toBeHidden();
 expect(await progress.evaluate(element=>element.closest('.entry-time-section'))).toBeNull();
 expect((await progress.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await progress.locator('..').screenshot({path:info.outputPath('in-progress.png')});
 await expect(page.locator('#end-time-editor')).toBeHidden();
 const row=(await progress.locator('..').boundingBox())!,notes=(await page.getByLabel('Notes').boundingBox())!,box=(await progress.boundingBox())!,text=(await progress.locator('..').locator('span').boundingBox())!;
 expect(Math.abs(row.x-notes.x)).toBeLessThanOrEqual(1);expect(row.height).toBeLessThanOrEqual(48);
 expect(Math.abs(box.y+box.height/2-text.y-text.height/2)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('progress-alignment.png'),fullPage:true});
 await progress.uncheck();await expect(end).toBeVisible();await expect(page.getByRole('listbox',{name:'End hour',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Set end time 15 minutes after start',exact:true}).click();
 await saveEntry(page);
 const [completed]=await (await request.get('/api/entries')).json();expect(completed.status).toBe('completed');expect(Date.parse(completed.endAt)-Date.parse(completed.startAt)).toBe(15*60000);
 await page.getByRole('button',{name:new RegExp('^Edit '+activity+' .*13:00$')}).click();await expect(progress).not.toBeChecked();await expect(end).toBeVisible();
 await page.locator('.time-field').last().screenshot({path:info.outputPath('completed.png')});
 await page.getByRole('button',{name:'Clear end time',exact:true}).click();await expect(progress).toBeChecked();await expect(progress).toBeFocused();await expect(end).toBeHidden();
 await saveEntry(page,'Save changes');
 const [active]=await (await request.get('/api/entries')).json();expect(active.endAt).toBeNull();expect(active.status).toBe('active');expect(active.startAt).toBe(completed.startAt);
 await page.getByRole('button',{name:new RegExp('^Edit active '+activity)}).click();await expect(progress).toBeChecked();await expect(end).toBeHidden();
});

test('progress choice and completed end survive failure, closing, and navigation',async({page})=>{
 await page.getByRole('button',{name:'Sleep',exact:true}).click();await page.getByLabel('Notes').fill('Keep the draft.');
 await typeEntryTime(page,'end','2026-11-17T13:30');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Time log',exact:true}).click();
 await expect(page.getByLabel('Still in progress')).not.toBeChecked();await expectEndTime(page,'2026-11-17T13:30');await expect(page.getByLabel('Notes')).toHaveValue('Keep the draft.');
 await page.getByLabel('Still in progress').check();await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Add an entry',exact:true}).click();await expect(page.getByLabel('Still in progress')).toBeChecked();await expect(page.getByRole('region',{name:'End time',exact:true})).toBeHidden();
});

test('non-timer activities keep optional ends without a progress checkbox',async({page,request})=>{
 await page.getByRole('button',{name:'Bath',exact:true}).click();await expect(page.getByLabel('Still in progress')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'End time',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Add end time',exact:true})).toBeVisible();
 await saveEntry(page);const [entry]=await (await request.get('/api/entries')).json();expect(entry.status).toBe('completed');expect(entry.endAt).toBeNull();
});
