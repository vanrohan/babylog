import {typeEntryTime} from './entry-time-helpers.ts';
import {test,expect} from './test.ts';

test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.goto('/');
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-06');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('button',{name:'Nappy change',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-06T15:40');
});

test('decimal comma survives typing, failed save, edit, and clearing',async({page,request},info)=>{
 const field=page.getByLabel('Temperature',{exact:true});
 await expect(field).toHaveAttribute('type','text');
 await expect(field).toHaveAttribute('inputmode','decimal');
 await field.pressSequentially('36,7');
 await expect(field).toHaveValue('36,7');
 await page.getByLabel('Notes').fill('Keep the full draft.');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await expect(field).toHaveValue('36,7');
 await expect(page.getByLabel('Notes')).toHaveValue('Keep the full draft.');
 await page.unroute('**/api/entry-saves/*');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText('36.7 C');
 await page.locator('.timeline-entry').getByRole('button').click();
 await field.fill('36.75');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText('36.75 C');
 await page.locator('.timeline-entry').getByRole('button').click();
 await expect(field).toHaveValue('36.75');
 await field.clear();
 await expect(field).toHaveValue('');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('.timeline-entry')).not.toContainText(' C');
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.temperature).toBeNull();
 await page.screenshot({path:info.outputPath('input-diary.png'),fullPage:true});
});

test('invalid temperature preserves the draft and sends no write',async({page,request},info)=>{
 let writes=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/entry-saves/'))writes++;});
 const field=page.getByLabel('Temperature',{exact:true});
 for(const value of ['36,','36,7.2','19.9','50.1','3e1']){
  await field.fill(value);await page.getByRole('button',{name:'Save entry',exact:true}).click();
  await expect(field).toHaveValue(value);await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid','true');
  await expect(page.getByRole('alert')).toContainText('Enter a temperature');
 }
 expect(writes).toBe(0);expect(await (await request.get('/api/entries')).json()).toEqual([]);
 await page.screenshot({path:info.outputPath('temperature-error.png'),fullPage:true});
 await field.fill('36,8');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText('36.8 C');
});

test('custom names reject spaces and permit correction without losing the draft',async({page})=>{
 let writes=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/entry-saves/'))writes++;});
 await page.getByRole('button',{name:'Other',exact:true}).click();
 await page.getByLabel('Activity name').fill('   ');
 await page.getByLabel('Notes').fill('Keep this draft.');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Enter an activity name.');
 await expect(page.getByLabel('Activity name')).toHaveValue('   ');
 await expect(page.getByLabel('Notes')).toHaveValue('Keep this draft.');expect(writes).toBe(0);
 await page.getByLabel('Activity name').fill('Walk');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText('Walk');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByLabel('Feeding subtype').selectOption('custom');await page.getByLabel('Subtype name').fill('   ');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Enter a subtype name.');
 await expect(page.getByLabel('Subtype name')).toHaveValue('   ');expect(writes).toBe(1);
 await page.getByLabel('Subtype name').fill('Supplement');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry').filter({hasText:'Supplement'})).toHaveCount(1);expect(writes).toBe(2);
});
