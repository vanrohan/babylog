import {test,expect,saveEntry} from './test.ts';

test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();
});

test('missing side shows persistent feedback from Save and keeps the draft',async({page,request},info)=>{
 let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/entry-saves/'))writes++;});
 const side=page.getByLabel('Breast side',{exact:true}),save=page.getByRole('button',{name:'Save entry',exact:true});
 await page.getByLabel('Notes').fill('Keep this feeding draft.');
 await save.scrollIntoViewIfNeeded();await save.click();
 await expect(page.getByRole('alert')).toHaveText('Choose Left, Right, or Both before saving.');
 await expect(side).toBeFocused();await expect(side).toHaveAttribute('aria-invalid','true');
 await expect(side).toHaveAccessibleDescription('Choose Left, Right, or Both before saving.');
 await expect(page.locator('#breast-side-error')).toBeInViewport();
 const field=await side.boundingBox(),footer=await page.locator('.entry-save-footer').boundingBox();
 expect(field).not.toBeNull();expect(footer).not.toBeNull();expect(field!.y+field!.height).toBeLessThanOrEqual(footer!.y);
 await expect(page.getByLabel('Notes')).toHaveValue('Keep this feeding draft.');
 await expect(page.getByLabel('Still in progress')).toBeChecked();expect(writes).toBe(0);
 expect(await (await request.get('/api/entries')).json()).toHaveLength(0);
 await page.screenshot({path:info.outputPath('missing-side.png'),fullPage:true});
 await save.click();await expect(side).toBeFocused();expect(writes).toBe(0);
 await side.selectOption('left');await expect(side).toHaveAttribute('aria-invalid','false');
 await expect(page.getByRole('alert')).toHaveCount(0);await saveEntry(page);
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.breastSide).toBe('left');expect(entry.notes).toBe('Keep this feeding draft.');
 await page.locator('.timeline-entry').getByRole('button').first().click();await side.selectOption('');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(side).toBeFocused();await expect(page.getByRole('alert')).toHaveText('Choose Left, Right, or Both before saving.');
 expect((await (await request.get('/api/entries')).json())[0].breastSide).toBe('left');
 await side.selectOption('right');await saveEntry(page,'Save changes');
});

test('changing subtype or activity clears missing-side feedback',async({page})=>{
 const save=page.getByRole('button',{name:'Save entry',exact:true});
 await save.click();await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'Feeding',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Choose Left, Right, or Both before saving.');
 await page.getByLabel('Feeding subtype').selectOption('Bottle');await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByLabel('Feeding subtype').selectOption('Breast');await save.click();
 await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Nappy change',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveCount(0);await saveEntry(page);
});

test('empty and whitespace custom names show field feedback and permit correction',async({page})=>{
 let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/entry-saves/'))writes++;});
 await page.getByLabel('Notes').fill('Keep the custom draft.');
 for(const kind of ['activity','subtype']){
  if(kind==='activity')await page.getByRole('button',{name:'Other',exact:true}).click();
  else{await page.getByRole('button',{name:'Feeding',exact:true}).click();await page.getByLabel('Feeding subtype').selectOption('custom');}
  const field=page.getByLabel(kind==='activity'?'Activity name':'Subtype name',{exact:true});
  const message=kind==='activity'?'Enter an activity name.':'Enter a subtype name.';
  for(const value of ['', '   ']){
   await field.fill(value);await page.getByRole('button',{name:'Save entry',exact:true}).click();
   await expect(page.getByRole('alert')).toHaveText(message);await expect(field).toBeFocused();
   await expect(field).toHaveAttribute('aria-invalid','true');await expect(field).toHaveAccessibleDescription(message);
   await expect(page.getByLabel('Notes')).toHaveValue('Keep the custom draft.');expect(writes).toBe(0);
  }
  await field.fill(kind==='activity'?'Walk':'Supplement');await expect(page.getByRole('alert')).toHaveCount(0);
 }
 await saveEntry(page);expect(writes).toBe(1);
 await expect(page.locator('.timeline-entry')).toContainText('Supplement');
});

test('missing side precedes invalid temperature and both require correction',async({page})=>{
 let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/entry-saves/'))writes++;});
 const side=page.getByLabel('Breast side',{exact:true}),temperature=page.getByLabel('Temperature',{exact:true});
 const save=page.getByRole('button',{name:'Save entry',exact:true});
 await temperature.fill('36,');await save.click();
 await expect(side).toBeFocused();await expect(page.getByRole('alert')).toContainText('Choose Left, Right, or Both');
 expect(writes).toBe(0);await expect(temperature).toHaveValue('36,');
 await side.selectOption('both');await save.click();await expect(temperature).toBeFocused();
 await expect(page.getByRole('alert')).toContainText('Enter a temperature');expect(writes).toBe(0);
 await expect(side).toHaveValue('both');await temperature.fill('36,7');await saveEntry(page);expect(writes).toBe(1);
});
