import {test,expect} from './test.ts';
import {typeEntryTime} from './entry-time-helpers.ts';
test.use({serviceWorkers:'block'});

test('daily checks and log times stay grouped across screen sizes',async({page,request},info)=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
 await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-11-14T09:00:00Z',endAt:'2026-11-14T10:00:00Z',notes:'Layout sample.'}});
 await request.post('/api/entries',{data:{activity:'walk',startAt:'2026-11-14T10:15:00Z'}});
 await page.goto('/');await expect(page.locator('.timeline-entry')).toHaveCount(2);
 const row=page.locator('.timeline-entry').filter({hasText:'Sleep'});
 const title=(await row.locator('strong').boundingBox())!,time=(await row.locator('.event-time').boundingBox())!;
 expect(Math.abs(time.x-title.x)).toBeLessThan(2);expect(time.y-title.y).toBeLessThan(35);
 const checks=(await page.locator('.daily-checks').boundingBox())!,date=(await page.locator('.date-controls').boundingBox())!;
 if(info.project.name==='desktop'){expect(checks.x).toBeGreaterThan(date.x+date.width);expect(checks.y).toBeLessThan(date.y+date.height);}
 for(const label of await page.locator('.daily-check-grid label').all())expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 const task=await (await request.post('/api/care-tasks',{data:{label:'A long daily care task name that must wrap safely across narrow screens'}})).json();
 await page.reload();await expect(page.getByText(task.label,{exact:true})).toBeVisible();
 for(const width of [320,820]){
  await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await page.getByText(task.label,{exact:true}).locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44);
 }
 await request.delete('/api/care-tasks/'+task.key,{data:{version:task.version}});
 await page.setViewportSize(info.project.use.viewport!);
 await page.screenshot({path:info.outputPath('dense-diary.png'),fullPage:true});
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await expect(page.locator('input[type=\"datetime-local\"]')).toHaveCount(0);await expect(page.getByText(/^Type (start|end|minutes)/)).toHaveCount(0);
 for(const field of await page.locator('.time-field:has(.entry-time-heading:visible)').all()){
  const heading=(await field.locator('.entry-time-heading').boundingBox())!,shortcuts=(await field.locator('.time-shortcuts').boundingBox())!;
  expect(shortcuts.y).toBeGreaterThanOrEqual(heading.y+heading.height);expect(shortcuts.y-heading.y-heading.height).toBeLessThanOrEqual(12);
 }
 await page.getByRole('button',{name:'Start relative time',exact:true}).click();
 await expect(page.getByText('Type minutes',{exact:true})).toHaveCount(0);await expect(page.locator('#start-helper input')).toHaveCount(0);
 await expect(page.getByRole('listbox',{name:'Start relative minutes',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('dense-entry-form.png'),fullPage:true});
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 const density=page.getByRole('region',{name:'Time of day density'});await expect(density.locator('.density-samples')).toContainText('Sleep: 1 start');
 await expect(density).not.toContainText('Other');
 await expect(page.getByRole('region',{name:'Continuous timeline'})).toContainText('Other');
 await page.getByLabel('Dashboard activity',{exact:true}).selectOption('other');
 await expect(density.getByRole('img')).toHaveCount(0);await expect(density).toContainText('No starts match');
 for(let day=10;day<14;day++)await request.post('/api/entries',{data:{activity:'sleep',startAt:`2026-11-${day}T09:00:00Z`,endAt:`2026-11-${day}T10:00:00Z`}});
 await page.reload();await page.getByLabel('Dashboard activity',{exact:true}).selectOption('all');
 await expect(density.locator('.density-samples')).toContainText('Sleep: 5 starts');await expect(density).not.toContainText('fewer than 5');
});

test('Assistant previews exact sleep changes and cancellation keeps records',async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 const sleep=await (await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-11-14T00:00:00Z',endAt:'2026-11-14T05:00:00Z'}})).json();
 const care={...sleep,activity:'bath',startAt:'2026-11-14T01:00:00Z',endAt:'2026-11-14T02:00:00Z'};
 const proposal={id:'sleep-preview',summary:'Add a bath.',operations:[{type:'create_entry',entry:care}],targets:[],sleepTargets:[sleep],sleepChanges:[{type:'update_entry',id:sleep.id,version:sleep.version,entry:{...sleep,endAt:care.startAt}},{type:'create_entry',entry:{...sleep,startAt:care.endAt}}]};
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:proposal.summary,proposal}}));
 await page.route('**/api/proposals/sleep-preview/reject',route=>route.fulfill({json:{}}));
 await page.goto('/assistant');await page.getByLabel('Your instruction').fill('Add a bath from two to three.');await page.getByRole('button',{name:'Send',exact:true}).click();
 const review=page.locator('.proposal');await expect(review).toContainText('3 changes');await expect(review).toContainText('Sleep changes');await expect(review).toContainText('Update Sleep');await expect(review).toContainText('Add Sleep');
 await expect(review).toContainText('2026-11-14 at 01:00 to 2026-11-14 at 02:00');await expect(review).toContainText('2026-11-14 at 03:00 to 2026-11-14 at 06:00');
 expect(await (await request.get('/api/entries')).json()).toEqual([sleep]);
 await page.getByRole('button',{name:'Cancel changes',exact:true}).click();await expect(review).toBeHidden();expect(await (await request.get('/api/entries')).json()).toEqual([sleep]);
});


test('saving a timed bath splits sleep and refreshes the time log',async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-11-14T00:00:00Z',endAt:'2026-11-14T05:00:00Z'}});
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-14');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Bath',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-14T02:00');await typeEntryTime(page,'end','2026-11-14T03:00');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.locator('.timeline-entry')).toHaveCount(3);
 await expect(page.locator('.timeline-entry').filter({hasText:'Sleep'})).toContainText(['03:00 - 06:00','01:00 - 02:00']);
 const entries=await (await request.get('/api/entries')).json();expect(entries.filter((entry:any)=>entry.activity==='sleep').map((entry:any)=>[entry.startAt,entry.endAt])).toEqual([['2026-11-14T02:00:00.000Z','2026-11-14T05:00:00.000Z'],['2026-11-14T00:00:00.000Z','2026-11-14T01:00:00.000Z']]);
});


test('a bath without End stops sleep and adding End resumes it',async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-11-14T00:00:00Z',endAt:'2026-11-14T05:00:00Z'}});
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-14');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Bath',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-14T02:00');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toHaveCount(2);await expect(page.locator('.timeline-entry').filter({hasText:'Sleep'})).toContainText('01:00 - 02:00');
 await page.getByRole('button',{name:'Edit Bath at 02:00',exact:true}).click();await typeEntryTime(page,'end','2026-11-14T03:00');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.timeline-entry')).toHaveCount(3);
 await expect(page.locator('.timeline-entry').filter({hasText:'Sleep'})).toContainText(['03:00 - 06:00','01:00 - 02:00']);
 await page.getByRole('button',{name:'Edit Bath at 02:00',exact:true}).click();await page.getByRole('button',{name:'Clear end time',exact:true}).click();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.timeline-entry')).toHaveCount(2);
});
