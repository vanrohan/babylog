import {test,expect,type Locator} from './test.ts';

async function separateControls(controls:Locator,width:number){
 const boxes=await controls.evaluateAll(elements=>elements.map(element=>{
  const box=element.getBoundingClientRect();
  const center=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
  return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height,
   hit:!!center&&(element===center||element.contains(center)),visible:getComputedStyle(element).opacity!=='0',scroll:element.scrollWidth,client:element.clientWidth};
 }));
 for(const [index,box] of boxes.entries()){
  expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width);
  expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.hit).toBe(true);
  if(box.visible)expect(box.scroll).toBeLessThanOrEqual(box.client+1);
  for(const other of boxes.slice(index+1)){
   expect(box.right<=other.left||other.right<=box.left||box.bottom<=other.top||other.bottom<=box.top).toBe(true);
  }
 }
}

for(const locale of ['en-GB','de-DE'])test.describe(locale,()=>{
 test.use({locale});
 for(const view of ['day','week','month','custom'])test(`${view} date controls keep separate mobile targets`,async({page},info)=>{
  await page.goto(`/dashboard?view=${view}&date=${view==='month'?'2026-11-01':'2026-11-16'}&from=2026-11-16&to=2026-11-22`);
  const dates=page.locator('.range-dates'),input=page.getByLabel(view==='custom'?'Range start':'Dashboard date');
  await expect(input).toBeVisible();
  await dates.scrollIntoViewIfNeeded();await separateControls(dates.locator('input,button'),info.project.use.viewport!.width);
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:1000});
   for(const size of [16,24]){
    await dates.evaluate((element,size)=>{
     element.querySelectorAll('input,button,label').forEach(child=>(child as HTMLElement).style.fontSize=size+'px');
    },size);
    await dates.scrollIntoViewIfNeeded();
    await separateControls(dates.locator('input,button'),width);
   }
  }
  const original=await input.inputValue();
  await page.getByRole('button',{name:'Previous range',exact:true}).click();await expect(input).not.toHaveValue(original);
  await page.getByRole('button',{name:'Next range',exact:true}).click();await expect(input).toHaveValue(original);
  if(view==='custom'){
   await page.getByLabel('Range end').fill('2026-11-23');await expect(page.getByLabel('Range end')).toHaveValue('2026-11-23');
  }
  await page.screenshot({path:info.outputPath('date-controls.png')});
  await page.clock.install({time:new Date('2026-11-09T12:00:00Z')});
  await dates.getByRole('button',{name:'Today',exact:true}).click();await expect(input).toHaveValue(view==='custom'?'2026-11-03':'2026-11-09');
 });

 test('diary dates, time fields, timeline actions, and Settings fit narrow screens',async({page},info)=>{
  await page.goto('/');
  await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-16');
  await page.locator('.date-controls').scrollIntoViewIfNeeded();
  await separateControls(page.locator('.date-controls').locator('button,input'),info.project.use.viewport!.width);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:1000});
   const dates=page.locator('.date-controls');await dates.scrollIntoViewIfNeeded();
   await separateControls(dates.locator('button,input'),width);
   const bounds=await dates.locator('.date-selector').evaluate(label=>{
    const a=label.getBoundingClientRect(),b=label.querySelector('input')!.getBoundingClientRect();
    return b.left>=a.left&&b.right<=a.right&&b.top>=a.top&&b.bottom<=a.bottom;
   });expect(bounds).toBe(true);
   const input=page.getByRole('textbox',{name:'Diary date',exact:true});
   await page.getByRole('button',{name:'Previous day',exact:true}).click();await expect(input).toHaveValue('2026-11-15');
   await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(input).toHaveValue('2026-11-16');
  }
  await page.locator('.date-controls').getByRole('button',{name:'Go to today',exact:true}).click();
  await page.locator('.date-controls').evaluate(element=>element.querySelectorAll('strong,span,button').forEach(child=>(child as HTMLElement).style.fontSize='24px'));
  await page.setViewportSize({width:320,height:1000});
  await page.locator('.date-controls').scrollIntoViewIfNeeded();
  await separateControls(page.locator('.date-controls').locator('button,input'),320);
  await page.getByRole('button',{name:'Add an entry',exact:true}).click();
  await expect(page.locator('.time-field')).toHaveCount(2);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:1000});
   for(const field of await page.locator('.time-field').all()){
    await field.evaluate(element=>element.scrollIntoView({block:'center'}));await separateControls(field.locator('input:not([type=checkbox]):visible,button:visible,.check-field:visible'),width);
   }
  }
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await page.setViewportSize({width:320,height:1000});
  for(const row of await dialog.locator('.task-editor form,.add-task').all()){
   await row.scrollIntoViewIfNeeded();await separateControls(row.locator('input,button'),320);
  }
  await page.screenshot({path:info.outputPath('settings-controls.png')});
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.goto('/dashboard?date=2026-11-16');
  const heading=page.locator('.sliding-heading');await expect(heading).toBeVisible();
  await heading.evaluate(element=>element.querySelectorAll('h2,button').forEach(child=>(child as HTMLElement).style.fontSize='24px'));
  await heading.scrollIntoViewIfNeeded();await separateControls(heading.locator('button'),320);
  const boxes=await heading.locator('h2,div').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().toJSON()));
  expect(boxes[0].bottom<=boxes[1].top||boxes[0].right<=boxes[1].left).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('timeline-controls.png')});
 });
});

test('the diary shows one date title for today and another selected day',async({page},info)=>{
 await page.clock.setFixedTime(new Date('2026-11-17T12:00:00Z'));
 await page.goto('/');
 const section=page.locator('.day-bar'),input=page.getByRole('textbox',{name:'Diary date',exact:true});
 for(const [day,title] of [['2026-11-17','Tuesday 17 November'],['2026-11-15','Sunday 15 November']]){
  await input.fill(day);
  await expect(section.getByText(title,{exact:true})).toHaveCount(1);
  await expect(section.locator('.date-selector strong')).toHaveText(title);
  await expect(section.locator('.daily-checks legend')).toHaveText('Daily checks');
  await expect(page.getByRole('group',{name:'Daily checks for '+day,exact:true})).toBeVisible();
  await expect(input).toHaveValue(day);
 }
 await section.getByRole('button',{name:'Go to today',exact:true}).click();
 await expect(input).toHaveValue('2026-11-17');
 await expect(section.getByText('Tuesday 17 November',{exact:true})).toHaveCount(1);
 await section.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('single-date-title.png'),fullPage:true});
});
