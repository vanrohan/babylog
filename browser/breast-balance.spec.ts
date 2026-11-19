import {typeEntryTime} from './entry-time-helpers.ts';
import {test,expect,saveEntry} from './test.ts';

test.beforeEach(async({request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
});

test('breast side is required and survives failed saves, closing, editing, and subtype changes',async({page,request})=>{
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 const side=page.getByLabel('Breast side',{exact:true});
 await expect(side).toHaveValue('');await expect(side).toHaveAttribute('required','');
 await typeEntryTime(page,'start','2026-11-03T10:00');await typeEntryTime(page,'end','2026-11-03T10:20');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();expect(await (await request.get('/api/entries')).json()).toHaveLength(0);
 await side.selectOption('both');await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Add an entry',exact:true}).click();await expect(side).toHaveValue('both');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');await expect(side).toHaveValue('both');
 await page.unroute('**/api/entry-saves/*');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await page.getByRole('button',{name:'Edit Feeding (Breast) / Both at 10:00',exact:true}).click();await expect(side).toHaveValue('both');
 await side.selectOption('right');await saveEntry(page,'Save changes');
 const [right]=await (await request.get('/api/entries')).json();expect(right.breastSide).toBe('right');
 await page.getByRole('button',{name:'Edit Feeding (Breast) / Right at 10:00',exact:true}).click();await page.getByLabel('Feeding subtype').selectOption('Bottle');await expect(side).toHaveCount(0);
 await saveEntry(page,'Save changes');expect((await (await request.get('/api/entries')).json())[0].breastSide).toBe(null);
});

test('balance shows equal Both time, unknown data, date ranges, filters, and shared updates',async({page,request},info)=>{
 const add=async(extra:object)=>{const response=await request.post('/api/entries',{data:{activity:'feeding',feedingType:'Breast',startAt:'2026-11-03T09:00:00Z',endAt:'2026-11-03T09:20:00Z',...extra}});expect(response.status()).toBe(201);return response.json();};
 const left=await add({notes:'Left breast.'});await add({breastSide:'right',endAt:'2026-11-03T09:10:00Z'});await add({breastSide:'both'});await add({notes:'Unknown side.'});const legacy=await add({breastSide:'left',endAt:null});await add({feedingType:'Bottle',notes:'Left breast.'});
 // Older records can contain completed feeds without an end.
 await page.route('**/api/entries',async route=>{const response=await route.fetch();const entries=await response.json();return route.fulfill({response,json:entries.map((entry:any)=>entry.id===legacy.id?{...entry,status:'completed'}:entry)});});
 await page.clock.install();await page.goto('/dashboard?view=day&date=2026-11-03');
 const balance=page.getByRole('region',{name:'Breastfeeding balance'}),totals=balance.locator('dl');
 await expect(totals).toContainText('Left30m 60%');await expect(totals).toContainText('Right20m 40%');
 await expect(balance).toContainText('Side not recorded: 20m');await expect(balance).toContainText('End time not recorded: 1 feed');
 await expect(balance.getByRole('img',{name:'Daily breastfeeding minutes on the left and right breast',exact:true})).toBeVisible();await expect(balance.locator('svg')).toBeVisible();
 await balance.getByText('Daily breast times',{exact:true}).click();
 const row=balance.getByRole('row',{name:'2026-11-03 30 20',exact:true});await expect(row).toBeVisible();
 await balance.getByText('Daily breast times',{exact:true}).click();
 await balance.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('breast-balance.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('Dashboard activity').selectOption('sleep');await expect(balance).toHaveCount(0);await page.getByLabel('Dashboard activity').selectOption('feeding');await expect(balance).toBeVisible();
 expect((await request.put('/api/entries/'+left.id,{data:{...left,breastSide:'right'}})).status()).toBe(200);await page.clock.fastForward(10000);
 await expect(totals).toContainText('Left10m 20%');await expect(totals).toContainText('Right40m 80%');
 await page.getByLabel('Dashboard date').fill('2026-11-04');await expect(balance).toContainText('No timed breast feeds with a recorded side.');await expect(balance.getByRole('img',{name:'Daily breastfeeding minutes on the left and right breast',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Week',exact:true}).click();await expect(totals).toContainText('Right40m 80%');
});
