import {test,expect} from './test.ts';

test.beforeEach(async({request})=>{
 for(const task of await (await request.get('/api/care-tasks')).json())if(task.active&&task.key.startsWith('task_'))await request.delete('/api/care-tasks/'+task.key,{data:{version:task.version}});
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 for(const day of ['2026-11-03','2026-11-04']){
  const checks=await (await request.get('/api/care/'+day)).json();
  for(const key of ['vitamin_d','tummy_time','face_wash'])expect((await request.put('/api/care/'+day,{data:{key,done:false,version:checks[key].version}})).status()).toBe(200);
 }
 await request.post('/api/entries',{data:{activity:'nappy',startAt:'2026-11-03T09:00:00Z',pee:true,notes:'Daily checks layout sample.'}});
});

test('three daily checks use large targets and retain independent values by date',async({page,request},info)=>{
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');
 const group=page.getByRole('group',{name:'Daily checks for 2026-11-03',exact:true});await expect(group.getByRole('checkbox')).toHaveCount(3);
 for(const label of await group.locator('label').all()){const box=await label.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);}
 await expect(page.getByLabel('Face wash',{exact:true})).toBeEnabled();
 await group.getByText('Tummy time',{exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Tummy time marked done (2026-11-03).'})).toBeVisible();
 await expect(page.getByLabel('Face wash',{exact:true})).toBeEnabled();await group.getByText('Face wash',{exact:true}).click();
 await expect(page.getByLabel('Face wash',{exact:true})).toBeChecked();await expect(page.getByLabel('Vitamin D given')).not.toBeChecked();
 await page.reload();await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');await expect(page.getByLabel('Face wash',{exact:true})).toBeChecked();await expect(page.getByLabel('Tummy time',{exact:true})).toBeChecked();
 await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(page.getByLabel('Face wash',{exact:true})).not.toBeChecked();
 await page.getByRole('button',{name:'Previous day',exact:true}).click();await expect(page.getByLabel('Face wash',{exact:true})).toBeChecked();
 await page.getByLabel('Tummy time',{exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Tummy time cleared (2026-11-03).'})).toBeVisible();
 expect((await (await request.get('/api/care/2026-11-03')).json()).face_wash.done).toBe(true);
 await page.getByRole('button',{name:'Dismiss confirmation'}).click();await page.screenshot({path:info.outputPath('daily-checks.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('failed and stale check saves keep confirmed values and show a local recovery message',async({page,request})=>{
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');
 await expect(page.getByLabel('Face wash',{exact:true})).toBeEnabled();
 await page.route('**/api/care/2026-11-03',route=>route.request().method()==='PUT'?route.fulfill({status:503,json:{error:'Save failed. Try again.'}}):route.continue());
 await page.getByLabel('Face wash',{exact:true}).click();await expect(page.locator('.daily-check-error')).toContainText('Save failed');await expect(page.getByLabel('Face wash',{exact:true})).not.toBeChecked();
 await page.unroute('**/api/care/2026-11-03');
 const before=await (await request.get('/api/care/2026-11-03')).json();await request.put('/api/care/2026-11-03',{data:{key:'tummy_time',done:true,version:before.tummy_time.version}});
 await page.getByLabel('Tummy time',{exact:true}).click();await expect(page.locator('.daily-check-error')).toContainText('changed on another device');await expect(page.getByLabel('Tummy time',{exact:true})).toBeChecked();
 await page.getByLabel('Face wash',{exact:true}).click();await expect(page.locator('.daily-check-error')).toHaveCount(0);await expect(page.getByLabel('Face wash',{exact:true})).toBeChecked();
});

test('loading and delayed saves never apply previous-day checks to the selected day',async({page,request})=>{
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');await expect(page.getByLabel('Face wash',{exact:true})).toBeEnabled();
 let releaseSave!:()=>void;const pendingSave=new Promise<void>(resolve=>{releaseSave=resolve;});
 await page.route('**/api/care/2026-11-03',async route=>{if(route.request().method()==='PUT'){await pendingSave;await route.continue();}else await route.continue();});
 await page.getByLabel('Face wash',{exact:true}).click();await expect(page.getByLabel('Tummy time',{exact:true})).toBeDisabled();await expect(page.locator('.daily-check-status')).toContainText('Saving daily check for 2026-11-03');
 let releaseDay!:()=>void;const pendingDay=new Promise<void>(resolve=>{releaseDay=resolve;});
 await page.route('**/api/care/2026-11-04',async route=>{await pendingDay;await route.continue();});
 await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(page.getByLabel('Face wash',{exact:true})).toBeDisabled();await expect(page.getByLabel('Face wash',{exact:true})).not.toBeChecked();
 releaseSave();await expect(page.getByRole('status').filter({hasText:'Face wash marked done (2026-11-03).'})).toBeVisible();await expect(page.getByLabel('Face wash',{exact:true})).toBeDisabled();
 releaseDay();await expect(page.getByLabel('Face wash',{exact:true})).toBeEnabled();await expect(page.getByLabel('Face wash',{exact:true})).not.toBeChecked();
 expect((await (await request.get('/api/care/2026-11-03')).json()).face_wash.done).toBe(true);expect((await (await request.get('/api/care/2026-11-04')).json()).face_wash.done).toBe(false);
 await page.unroute('**/api/care/2026-11-04');await page.getByRole('button',{name:'Previous day',exact:true}).click();await expect(page.getByLabel('Face wash',{exact:true})).toBeChecked();
});

test('shared polling and navigation away and back keep the latest confirmed daily values',async({page,request})=>{
 await page.clock.install();await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');await expect(page.getByLabel('Tummy time',{exact:true})).toBeEnabled();
 const before=await (await request.get('/api/care/2026-11-03')).json();await request.put('/api/care/2026-11-03',{data:{key:'face_wash',done:true,version:before.face_wash.version}});
 await page.clock.fastForward(10000);await expect(page.getByLabel('Face wash',{exact:true})).toBeChecked();await expect(page.getByLabel('Tummy time',{exact:true})).not.toBeChecked();
 let releaseSave!:()=>void,releaseRead!:()=>void,readHeld!:()=>void;
 const saving=new Promise<void>(resolve=>{releaseSave=resolve;}),reading=new Promise<void>(resolve=>{releaseRead=resolve;}),held=new Promise<void>(resolve=>{readHeld=resolve;});
 let holdRead=false;
 await page.route('**/api/care/2026-11-03',async route=>{
  if(route.request().method()==='PUT'){await saving;await route.continue();}
  else if(holdRead){holdRead=false;const response=await route.fetch();readHeld();await reading;await route.fulfill({response});}
  else await route.continue();
 });
 await page.getByLabel('Tummy time',{exact:true}).click();await expect(page.getByLabel('Tummy time',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(page.getByLabel('Face wash',{exact:true})).not.toBeChecked();
 holdRead=true;await page.getByRole('button',{name:'Previous day',exact:true}).click();await held;
 await expect(page.getByLabel('Tummy time',{exact:true})).toBeDisabled();releaseSave();
 await expect(page.getByRole('status').filter({hasText:'Tummy time marked done (2026-11-03).'})).toBeVisible();
 await expect(page.getByLabel('Tummy time',{exact:true})).toBeEnabled();await expect(page.getByLabel('Tummy time',{exact:true})).toBeChecked();
 releaseRead();await expect(page.getByLabel('Tummy time',{exact:true})).toBeChecked();await expect(page.getByLabel('Face wash',{exact:true})).toBeChecked();
});
