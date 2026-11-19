import {test,expect} from './test.ts';

test.beforeEach(async({request})=>{
 for(const e of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+e.id,{data:{version:e.version}});
 const add=async(activity:string,startAt:string,endAt:string|null,extra:object={})=>{
  const response=await request.post('/api/entries',{data:{activity,startAt,endAt,...extra}});expect(response.status()).toBe(201);
 };
 for(let day=2;day<=6;day++){
  const date='2026-11-0'+day;
  await add('sleep',date+'T00:00:00Z',date+'T05:00:00Z');
  await add('sleep',date+'T11:00:00Z',date+'T12:30:00Z');
  await add('breastfeeding',date+'T07:00:00Z',date+'T07:20:00Z');
  await add('breastfeeding',date+'T17:00:00Z',date+'T17:15:00Z');
  await add('breastfeeding',date+'T17:35:00Z',date+'T17:50:00Z',{notes:'Evening feed.'});
  await add('breastfeeding',date+'T18:10:00Z',date+'T18:30:00Z');
  await add('nappy',date+'T08:00:00Z',null,{pee:true,poo:true});
  await add('nappy',date+'T14:00:00Z',null,{pee:true});
 }
});

test('week patterns show totals and drill into exact source records',async({page},info)=>{
 await page.goto('/dashboard?view=week&date=2026-11-03');
 await expect(page.getByRole('heading',{name:'Care patterns'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Week',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByLabel('Range totals')).toContainText('5 / 7 days logged.');
 await expect(page.getByRole('heading',{name:'Day by day',exact:true})).toHaveCount(0);
 expect((await page.getByRole('heading',{level:2}).allTextContents()).filter(text=>['Daily rhythm','When activities start','Continuous timeline'].includes(text))).toEqual(['Daily rhythm','When activities start','Continuous timeline']);
 await expect(page.getByLabel('Range totals')).toContainText('32h 30m');
 await expect(page.getByLabel('Range totals').locator('dl > div').filter({hasText:'Feeds'}).locator('dd')).toHaveText('20');
 await expect(page.getByRole('region',{name:'Care timeline'}).getByRole('button')).toHaveCount(7);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:info.outputPath('dashboard-week.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:/^2026-11-03: 8 entries/}).click();
 await expect(page.getByRole('button',{name:'Day',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('region',{name:'Day entries'})).toContainText('Pee: 2');
 await expect(page.getByRole('region',{name:'Day entries'})).toContainText('Poo: 1');
 await page.getByRole('button',{name:/^Sleep 01:00/}).click();
 await expect(page.getByRole('article',{name:'Entry details'})).toContainText('Duration: 5h 0m');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:info.outputPath('dashboard-day.png'),fullPage:true});
 await page.getByRole('button',{name:/^Feeding \(Breast\) 18:35/}).click();
 await expect(page.getByRole('article',{name:'Entry details'})).toContainText('Evening feed.');
 await expect(page.getByRole('article',{name:'Entry details'})).toContainText('Duration: 15m');
 await page.getByRole('button',{name:'Edit in time log',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Edit entry',exact:true})).toBeVisible();
 await expect(page.getByLabel('Notes')).toHaveValue('Evening feed.');
 await page.getByLabel('Breast side',{exact:true}).selectOption('left');
 await page.getByLabel('Notes').fill('Edited from dashboard.');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText(['Edited from dashboard.']);
 await page.getByRole('button',{name:'Edit Feeding (Breast) / Left at 18:35'}).click();
 await page.getByRole('button',{name:'Other',exact:true}).click();
 await page.getByLabel('Activity name').fill('Walk');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByLabel('Dashboard date').fill('2026-11-03');
 await expect(page.getByLabel('Range totals').locator('dl > div').filter({hasText:'Feeds'}).locator('dd')).toHaveText('19');
});

test('month and custom ranges preserve timing and validate dates',async({page},info)=>{
 await page.goto('/dashboard?view=month&date=2026-11-03');
 const timeline=page.getByRole('region',{name:'Care timeline'});
 await expect(timeline.getByRole('button')).toHaveCount(30);
 await expect(timeline.locator('.pattern-track.feeding .pattern-mark').first()).toBeAttached();
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:info.outputPath('dashboard-month.png'),fullPage:true});
 await page.getByRole('button',{name:'Next range'}).click();
 await expect(timeline.getByRole('button')).toHaveCount(31);
 await page.getByRole('button',{name:'Previous range'}).click();
 await expect(timeline.getByRole('button')).toHaveCount(30);
 await page.getByRole('button',{name:'Custom',exact:true}).click();
 await page.getByLabel('Range start').fill('2026-11-03');
 await page.getByLabel('Range end').fill('2026-11-04');
 await expect(timeline.getByRole('button')).toHaveCount(2);
 await expect(page.getByLabel('Range totals')).toContainText('13h 0m');
 await page.getByLabel('Dashboard activity').selectOption('feeding');
 await expect(timeline.locator('.pattern-track.sleep')).toHaveCount(0);
 await expect(timeline.locator('.pattern-track.feeding')).toHaveCount(2);
 await expect(page.getByLabel('Range totals')).toContainText('13h 0m');
 await page.getByLabel('Range end').fill('2026-11-02');
 await expect(page.getByRole('alert')).toContainText('end date');
 await expect(page.getByRole('button',{name:'Next range'})).toBeDisabled();
 await page.getByLabel('Range end').fill('2026-11-05');
 await expect(timeline.getByRole('button')).toHaveCount(3);
 await page.getByRole('button',{name:/^2026-11-03:/}).click();
 await page.getByRole('button',{name:'Back to range',exact:true}).click();
 await expect(page.getByLabel('Range start')).toHaveValue('2026-11-03');
 await expect(page.getByLabel('Range end')).toHaveValue('2026-11-05');
 await expect(timeline.getByRole('button')).toHaveCount(3);
});

test('empty ranges and return navigation keep an unsaved manual form',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByLabel('Notes').fill('Keep this draft.');
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByLabel('Dashboard date').fill('2020-01-01');
 await expect(page.getByRole('heading',{name:'No entries in this range'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Care timeline'}).getByRole('button')).toHaveCount(7);
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await expect(page.getByLabel('Notes')).toHaveValue('Keep this draft.');
 await page.goBack();
 await expect(page.getByRole('heading',{name:'Care patterns'})).toBeVisible();
});

test('initial dashboard failure has a retry and recovers',async({page})=>{
 await page.route('**/api/entries**',route=>route.fulfill({status:503,json:{error:'The shared diary is unavailable.'}}));
 await page.goto('/dashboard');
 await expect(page.getByRole('alert')).toContainText('The shared diary is unavailable');
 await expect(page.getByText('Loading the shared diary...')).toBeHidden();
 await page.unroute('**/api/entries**');
 await page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(page.getByRole('region',{name:'Care timeline'})).toBeVisible();
});

test('running records show provisional duration in their details',async({page,request})=>{
 const now=new Date();
 await page.clock.setFixedTime(now);
 const start=new Date(+now-15*60_000).toISOString();
 const response=await request.post('/api/entries',{data:{activity:'breastfeeding',startAt:start,endAt:null,status:'active',notes:'Running dashboard check.'}});
 expect(response.status()).toBe(201);
 const current=await response.json();
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(start));
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 const day=`${part('year')}-${part('month')}-${part('day')}`;
 await page.goto('/dashboard?view=day&date='+day);
 await page.getByRole('button',{name:/Feeding \(Breast\) .*running/}).click();
 await expect(page.getByRole('article',{name:'Entry details'})).toContainText('Duration: 15m so far (running)');
 await expect(page.getByRole('article',{name:'Entry details'})).toContainText(current.notes);
});

test('activity previews work with hover, tap, and keyboard',async({page,request},info)=>{
 await page.goto('/dashboard?view=week&date=2026-11-03');
 const mark=page.locator('.pattern-track.feeding .pattern-mark').first();
 if(info.project.name==='desktop')await mark.hover();else await mark.tap();
 const preview=page.getByRole('region',{name:'Activity preview'});
 await expect(preview).toContainText('Feeding (Breast)');await expect(preview).toContainText('20m');
 await page.screenshot({path:info.outputPath('dashboard-activity-preview.png'),fullPage:true});
 await page.getByRole('button',{name:'Close activity preview'}).click();await expect(preview).toBeHidden();
 await expect(page.getByRole('button',{name:'Week',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:/^2026-11-03:/}).click();
 const row=page.getByRole('button',{name:/^Feeding \(Breast\) 18:35/});await row.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
 await expect(preview).toContainText('Evening feed.');await page.keyboard.press('Escape');await expect(preview).toBeHidden();
 await row.click();await expect(page.getByRole('article',{name:'Entry details'})).toContainText('Evening feed.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('date presets, zoom, navigator, density, and day navigation stay connected',async({page},info)=>{
 await page.goto('/dashboard?view=week&date=2026-11-03');
 await page.getByText('More date options',{exact:true}).click();await page.getByRole('button',{name:'All recorded days'}).click();
 await expect(page.getByLabel('Range start')).toHaveValue('2026-11-02');await expect(page.getByLabel('Range end')).toHaveValue('2026-11-06');
 await expect(page.getByRole('img',{name:'Date overview.',exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await expect(page.getByLabel('Range start')).toHaveValue('2026-11-03');await expect(page.getByLabel('Range end')).toHaveValue('2026-11-05');
 await page.getByRole('button',{name:'Zoom out',exact:true}).click();
 await expect(page.getByLabel('Range start')).toHaveValue('2026-11-01');await expect(page.getByLabel('Range end')).toHaveValue('2026-11-06');
 const density=page.getByRole('region',{name:'Time of day density'});await expect(density).toContainText('Feeding: 20 starts');
 await page.getByLabel('Density smoothing').selectOption('30');
 await page.getByLabel('Dashboard activity').selectOption('bath');await expect(density).toContainText('No starts match');
 await page.getByLabel('Dashboard activity').selectOption('all');
 await page.getByRole('button',{name:/^2026-11-03: 8 entries/}).click();
 await expect(page.getByRole('button',{name:'Day',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Back to range'}).click();
 await expect(page.getByLabel('Range start')).toHaveValue('2026-11-01');
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath('dashboard-charts-custom.png'),fullPage:true});
 if(info.project.name==='desktop'){
  await page.setViewportSize({width:1920,height:1050});
  const chart=page.getByRole('region',{name:'Time of day density'}).locator('.care-chart');
  const width=Math.round((await chart.boundingBox())!.width);
  await expect.poll(async()=>Number(await chart.locator('svg').getAttribute('width'))).toBe(width);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:info.outputPath('dashboard-user-1920.png'),fullPage:true,animations:'disabled'});
 }
});

test('dragging the date overview updates the range, URL, timeline, and density',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
 await page.goto('/dashboard?view=custom&from=2026-11-02&to=2026-11-06');
 await page.getByText('More date options',{exact:true}).click();
 const chart=page.locator('.range-navigator .care-chart');await expect(chart.locator('svg')).toBeVisible();
 const box=(await chart.boundingBox())!;
 if(test.info().project.use.hasTouch){
  const client=await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width-17,y:box.y+43}]});
  for(let i=1;i<=12;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-17-(box.width/2-17)*i/12,y:box.y+43}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();
 }else{
  await page.mouse.move(box.x+box.width-17,box.y+43);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2,box.y+43,{steps:12});await page.mouse.up();
 }
 await expect(page.getByLabel('Range end')).toHaveValue('2026-11-04');
 await expect(page).toHaveURL(/to=2026-11-04/);
 await expect(page.getByRole('region',{name:'Care timeline'}).getByRole('button')).toHaveCount(3);
 await expect(page.getByRole('region',{name:'Time of day density'})).toContainText('Feeding: 12 starts');
});

test('polling updates and removes a preview without parsing note markup',async({page,request})=>{
 await page.clock.install();await page.goto('/dashboard?view=week&date=2026-11-03');
 await page.locator('.pattern-track.feeding .pattern-mark').first().click();
 const preview=page.getByRole('region',{name:'Activity preview'});await expect(preview).toContainText('Feeding (Breast)');
 const records=await (await request.get('/api/entries')).json();
 const record=records.find((e:any)=>e.activity==='feeding'&&e.feedingType==='Breast'&&e.startAt==='2026-11-02T18:10:00.000Z');
 const notes='<img src=x onerror="window.badNote=true"> Changed by another caregiver.';
 expect((await request.put('/api/entries/'+record.id,{data:{...record,activity:'bath',feedingType:null,notes}})).status()).toBe(200);
 await page.clock.fastForward(10000);await expect(preview).toContainText('Bath');await expect(preview).toContainText(notes);
 await expect(preview.locator('img')).toHaveCount(0);await expect(page.getByRole('region',{name:'Time of day density'})).toContainText('Bath: 1 start');
 expect((await request.delete('/api/entries/'+record.id,{data:{version:record.version+1}})).status()).toBe(200);
 await page.clock.fastForward(10000);await expect(preview).toBeHidden();
 await expect(page.getByRole('region',{name:'Time of day density'})).not.toContainText('Bath: 1 start');
});

test('all recorded days includes overnight endings but excludes a midnight boundary',async({page,request})=>{
 const response=await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-11-06T22:00:00Z',endAt:'2026-11-07T01:00:00Z'}});
 const entry=await response.json();expect(response.status()).toBe(201);
 await page.goto('/dashboard');await page.getByText('More date options',{exact:true}).click();await page.getByRole('button',{name:'All recorded days'}).click();
 await expect(page.getByLabel('Range end')).toHaveValue('2026-11-07');
 expect((await request.put('/api/entries/'+entry.id,{data:{...entry,endAt:'2026-11-06T23:00:00Z'}})).status()).toBe(200);
 await page.reload();await page.getByText('More date options',{exact:true}).click();await page.getByRole('button',{name:'All recorded days'}).click();
 await expect(page.getByLabel('Range end')).toHaveValue('2026-11-06');
});

test('density legend and smoothing choices survive a shared diary refresh',async({page,request})=>{
 await page.clock.install();await page.goto('/dashboard?view=week&date=2026-11-03');
 const chart=page.getByRole('region',{name:'Time of day density'}).locator('.care-chart');
 await page.getByLabel('Density smoothing').selectOption('30');
 const legend=chart.locator('svg text').filter({hasText:/^Feeding \(20\)$/});await legend.click();
 const fill=await legend.getAttribute('fill');
 expect((await request.post('/api/entries',{data:{activity:'bath',startAt:'2026-11-03T12:00:00Z',notes:'Shared refresh.'}})).status()).toBe(201);
 await page.clock.fastForward(10000);await expect(page.getByRole('region',{name:'Time of day density'})).toContainText('Bath: 1 start');
 await expect(legend).toHaveAttribute('fill',fill!);await expect(page.getByLabel('Density smoothing')).toHaveValue('30');
});

test('continuous history scrolls across days without replacing the range or losing the scroll on refresh',async({page,request},info)=>{
 await page.goto('/dashboard?view=week&date=2026-11-03');
 await page.emulateMedia({reducedMotion:'reduce'});
 const scroll=page.getByRole('region',{name:'Scrollable care history'});
 const totals=await page.getByLabel('Range totals').innerText();
 const initial=await scroll.evaluate(el=>el.scrollLeft);expect(initial).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Scroll to earlier times'}).click();
 await expect.poll(()=>scroll.evaluate(el=>el.scrollLeft)).toBeLessThan(initial-100);
 const moved=await scroll.evaluate(el=>el.scrollLeft);
 expect(await page.getByLabel('Range totals').innerText()).toBe(totals);
 await request.post('/api/entries',{data:{activity:'bath',startAt:'2026-11-03T09:00:00Z'}});
 await page.waitForTimeout(10500);
 expect(await scroll.evaluate(el=>el.scrollLeft)).toBeCloseTo(moved,0);
 await scroll.evaluate(el=>{el.scrollLeft+=300;});
 expect(await scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(moved);
 await page.screenshot({path:info.outputPath('continuous-history.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Day history crosses midnight and opens filtered source details',async({page})=>{
 await page.goto('/dashboard?view=day&date=2026-11-03');
 const history=page.getByRole('region',{name:'Scrollable care history'});
 const initial=await history.evaluate(el=>el.scrollLeft);
 await history.evaluate(el=>{el.scrollLeft-=640;});
 expect(await history.evaluate(el=>el.scrollLeft)).toBe(initial-640);
 await history.getByRole('button',{name:'2026-11-02 00:00 / 06:00 / 12:00 / 18:00',exact:true}).click();
 await expect(page.getByLabel('Dashboard date')).toHaveValue('2026-11-02');
 await page.getByLabel('Dashboard activity').selectOption('sleep');
 await expect(history.locator('.sliding-label')).toHaveText(['Date','Sleep']);
 await history.getByRole('button',{name:'Sleep on 2026-11-02. Open details.'}).first().click();
 await expect(page.getByRole('region',{name:'Activity preview'})).toContainText('2026-11-02 12:00');
});

test('Feeding includes syringe and breast feeds in timelines, counts, density, and details',async({page,request},info)=>{
 const response=await request.post('/api/entries',{data:{activity:'syringe feeding',startAt:'2026-11-03T15:00:00Z',endAt:'2026-11-03T15:15:00Z',notes:'Ready-to-feed formula, 20 ml.'}});const syringe=await response.json();
 await request.post('/api/entries',{data:{activity:'walk',startAt:'2026-11-03T16:00:00Z'}});
 await page.goto('/dashboard?view=week&date=2026-11-03');
 await expect(page.getByLabel('Range totals').locator('dl > div').filter({hasText:'Feeds'}).locator('dd')).toHaveText('21');
 await page.getByLabel('Dashboard activity').selectOption('feeding');
 await expect(page.getByRole('region',{name:'Time of day density'})).toContainText('Feeding: 21 starts');
 await expect(page.locator('.sliding-day.feeding .sliding-mark')).toHaveCount(21);await expect(page.locator('.sliding-day.other')).toHaveCount(0);
 await page.getByRole('button',{name:'Day',exact:true}).click();const entries=page.getByRole('region',{name:'Day entries'});
 await expect(entries.locator('.dashboard-entry')).toHaveCount(5);await expect(entries).toContainText('Feeding (Breast)');await expect(entries).toContainText('Feeding (Syringe)');
 await entries.getByRole('button',{name:/^Feeding \(Syringe\) 16:00/}).click();await expect(page.getByRole('article',{name:'Entry details'})).toContainText('Ready-to-feed formula, 20 ml.');
 await page.screenshot({path:info.outputPath('dashboard-feeding.png'),fullPage:true});
 await page.getByLabel('Dashboard activity').selectOption('other');await expect(entries.locator('.dashboard-entry')).toHaveCount(1);await expect(entries).toContainText('walk');await expect(entries).not.toContainText('Feeding (Syringe)');
 const saved=await (await request.get('/api/entries')).json();expect(saved.find((entry:any)=>entry.id===syringe.id)).toEqual(syringe);
});

test('date arrows stay separate from native date inputs at narrow widths and large text',async({page})=>{
 await page.setViewportSize({width:320,height:844});
 for(const view of ['day','week','month','custom']){
  const date=view==='month'?'2026-11-01':view==='week'?'2026-11-02':'2026-11-07';
  await page.goto('/dashboard?view='+view+'&date='+date+'&from=2026-11-02&to=2026-11-08');
  await page.locator('.range-dates').evaluate(element=>{
   element.querySelectorAll('input,button,label').forEach(child=>(child as HTMLElement).style.fontSize='24px');
  });
  const previous=page.getByRole('button',{name:'Previous range',exact:true}),next=page.getByRole('button',{name:'Next range',exact:true});
  for(const button of [previous,next]){
   await expect(button).toBeVisible();await expect(button.locator('svg')).toHaveCount(1);await expect(button).toHaveText('');
   const box=(await button.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const controls=await page.locator('.range-dates input,.range-dates button').evaluateAll(elements=>elements.map(element=>{
   const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
  }));
  for(const [i,a] of controls.entries()){
   expect(a.left).toBeGreaterThanOrEqual(0);expect(a.right).toBeLessThanOrEqual(320);
   for(const b of controls.slice(i+1))expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBe(true);
  }
  const input=page.getByLabel(view==='custom'?'Range start':'Dashboard date');const initial=await input.inputValue();
  await previous.click();await expect(input).not.toHaveValue(initial);await next.click();await expect(input).toHaveValue(initial);
 }
});
