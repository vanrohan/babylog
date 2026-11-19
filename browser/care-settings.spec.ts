import {test,expect} from './test.ts';

test.beforeEach(async({request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 for(const task of await (await request.get('/api/care-tasks')).json())if(task.active&&task.key.startsWith('task_'))await request.delete('/api/care-tasks/'+task.key,{data:{version:task.version}});
});

test('current care timers cross midnight and ignore the selected diary date and future starts',async({page,request},info)=>{
 await page.clock.install({time:new Date('2026-11-08T08:30:00Z')});
 await request.post('/api/entries',{data:{activity:'feeding',feedingType:'Syringe',startAt:'2026-11-08T06:00:00Z',status:'active'}});
 const nappy=await (await request.post('/api/entries',{data:{activity:'nappy',startAt:'2026-11-07T22:00:00Z'}})).json();
 await request.post('/api/entries',{data:{activity:'feeding',startAt:'2026-11-08T10:00:00Z'}});
 await page.goto('/');const current=page.getByRole('region',{name:'Latest Care',exact:true});
 await expect(current).toContainText('2h 30m ago');await expect(current).toContainText('10h 30m ago');
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');await expect(current).toContainText('2h 30m ago');
 await page.clock.fastForward(60000);await expect(current).toContainText('2h 31m ago');
 await expect(current.getByText('Started 2026-11-07 at 23:00',{exact:true})).toBeHidden();
 await current.locator('.care-now-item').nth(1).locator('summary').click();
 await expect(current.getByText('Started 2026-11-07 at 23:00',{exact:true})).toBeVisible();
 await current.locator('.care-now-item').nth(1).locator('summary').click();
 await request.put('/api/entries/'+nappy.id,{data:{...nappy,startAt:'2026-11-08T08:00:00Z'}});
 await page.clock.fastForward(10000);await expect(current).toContainText('0h 31m ago');
 await page.screenshot({path:info.outputPath('care-now.png'),fullPage:true});
 const changed=await (await request.get('/api/entries')).json();const updated=changed.find((e:any)=>e.id===nappy.id);
 await request.delete('/api/entries/'+nappy.id,{data:{version:updated.version}});
 await page.clock.fastForward(10000);await expect(current).toContainText('No record');
 await page.route('**/api/entries**',route=>route.abort());await page.clock.fastForward(10000);
 await expect(current.getByRole('status')).toHaveText('Offline');
});

test('custom tasks support rename, daily checks, removal, and retained history',async({page,request},info)=>{
 await page.goto('/');await expect(page.getByLabel('Umbilical cord care',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('New daily task',{exact:true}).fill('Go for a stroll');await dialog.getByRole('button',{name:'Add daily task',exact:true}).click();
 const field=dialog.getByLabel('Task name: Go for a stroll',{exact:true});await expect(field).toBeVisible();
 await field.fill('Air out apartment');await dialog.getByRole('button',{name:'Save task Go for a stroll',exact:true}).click();
 await expect(dialog.getByLabel('Task name: Air out apartment',{exact:true})).toHaveValue('Air out apartment');
 await dialog.getByLabel('New daily task',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('daily-task-settings.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');await expect(page.getByLabel('Air out apartment',{exact:true})).toBeEnabled();
 await page.getByLabel('Air out apartment',{exact:true}).check();await expect(page.getByLabel('Air out apartment',{exact:true})).toBeEnabled();
 await page.reload();await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');await expect(page.getByLabel('Air out apartment',{exact:true})).toBeChecked();
 await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(page.getByLabel('Air out apartment',{exact:true})).not.toBeChecked();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await dialog.getByRole('button',{name:'Remove task Air out apartment',exact:true}).click();
 await expect(dialog.getByText('Remove Air out apartment? History stays.',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Remove from checklist',exact:true}).click();
 await expect(dialog.getByLabel('Task name: Air out apartment',{exact:true})).toHaveCount(0);
 const exported=await (await request.get('/api/export')).json();const task=exported.careTasks.find((t:any)=>t.label==='Air out apartment');expect(task.active).toBe(false);expect(exported.care.find((c:any)=>c.key===task.key&&c.day==='2026-11-03').done).toBe(1);
});

test('another parent rename cannot be overwritten by a draft after settings refresh',async({page,request})=>{
 const task=await (await request.post('/api/care-tasks',{data:{label:'Original task'}})).json();
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Task name: Original task',{exact:true}).fill('My draft');
 await request.put('/api/care-tasks/'+task.key,{data:{label:'Other parent name',version:task.version}});
 await dialog.getByLabel('New daily task',{exact:true}).fill('Refresh trigger');await dialog.getByRole('button',{name:'Add daily task',exact:true}).click();
 await expect(dialog.getByLabel('Task name: Other parent name',{exact:true})).toHaveValue('My draft');
 await dialog.getByRole('button',{name:'Save task Other parent name',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('changed');
 const tasks=await (await request.get('/api/care-tasks')).json();expect(tasks.find((t:any)=>t.key===task.key).label).toBe('Other parent name');
});

test('care summary wraps long gaps on a narrow phone',async({page,request})=>{
 await page.clock.install({time:new Date('2026-11-08T08:30:00Z')});await page.setViewportSize({width:320,height:568});
 await request.post('/api/entries',{data:{activity:'feeding',startAt:'2026-11-01T00:00:00Z'}});
 await request.post('/api/entries',{data:{activity:'nappy',startAt:'2026-11-01T00:00:00Z'}});
 await page.goto('/');const current=page.getByRole('region',{name:'Latest Care',exact:true});await expect(current).toContainText('176h 30m ago');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await current.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('settings keep daily tasks without reminder controls or device permission changes',async({page},info)=>{
 const requests:string[]=[];
 page.on('request',request=>{if(/\/api\/(reminders|push)(\/|$)/.test(new URL(request.url()).pathname))requests.push(request.url());});
 await page.addInitScript(()=>{
  (window as any).deviceChanges=[];
  if(typeof Notification!=='undefined')Object.defineProperty(Notification,'requestPermission',{value:()=>{(window as any).deviceChanges.push('permission');return Promise.resolve('denied');}});
  const subscription={unsubscribe:async()=>{(window as any).deviceChanges.push('unsubscribe');return true;}};
  const registration={pushManager:{getSubscription:async()=>{(window as any).deviceChanges.push('subscription');return subscription;}}};
  Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,getRegistration:async()=>registration,ready:Promise.resolve(registration)}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Daily tasks',exact:true})).toBeVisible();
 await expect(dialog.getByRole('heading',{name:/reminder/i})).toHaveCount(0);
 await expect(dialog.getByRole('region',{name:'Notifications on this device',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('switch')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:/reminder|notification/i})).toHaveCount(0);
 for(const name of ['Add daily task','Remove task Vitamin D given']){
  const button=dialog.getByRole('button',{name,exact:true}),box=(await button.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
 }
 await page.screenshot({path:info.outputPath('settings-without-reminders.png'),fullPage:true});
 await page.setViewportSize({width:320,height:568});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 const current=page.getByRole('region',{name:'Latest Care',exact:true});
 await expect(current.getByRole('button',{name:/reminder/i})).toHaveCount(0);await expect(current.getByText('Due',{exact:true})).toHaveCount(0);
 expect(requests).toEqual([]);expect(await page.evaluate(()=>(window as any).deviceChanges)).toEqual([]);
});

test('daily task loading errors stop loading and recover when settings reopen',async({page})=>{
 await page.goto('/');
 await page.route('**/api/care-tasks',route=>route.fulfill({status:503,json:{error:'Daily tasks are unavailable.'}}));
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('alert')).toHaveText('Daily tasks are unavailable.');
 await expect(dialog.getByRole('status')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.unroute('**/api/care-tasks');await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Daily tasks',exact:true})).toBeVisible();
 await expect(dialog.getByLabel('Task name: Vitamin D given',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('alert')).toHaveCount(0);
});
