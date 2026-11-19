import {typeEntryTime} from './entry-time-helpers.ts';
import {test,expect} from './test.ts';

test.beforeEach(async({request,page})=>{
 await page.clock.install();
 for(const entry of await (await request.get('/api/entries')).json()){
  await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 }
 const care=await (await request.get('/api/care/2026-11-03')).json();
 for(const key of ['vitamin_d','tummy_time','face_wash'])await request.put('/api/care/2026-11-03',{data:{key,done:false,version:care[key].version}});
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Our daily diary'})).toBeVisible();
 await expect(page.getByText('Loading the shared diary...')).toHaveCount(0);
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByLabel('Breast side',{exact:true}).selectOption('left');
});

test('manual entry, rename, date navigation, checks, and deletion',async({page},info)=>{
 await page.getByRole('button',{name:'Other',exact:true}).click();
 await page.getByLabel('Activity name').fill('Walk');
 await typeEntryTime(page,'start','2026-11-03T10:15');
 await page.getByLabel('Notes').fill('Settled after feeding.');
 await page.getByLabel('Pee',{exact:true}).check();
 await page.getByLabel('Poo',{exact:true}).check();
 await page.getByLabel('Temperature',{exact:true}).fill('36.7');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 const record=page.locator('.timeline-entry');
 await expect(record).toHaveCount(1);
 await expect(record).toContainText('Walk');
 await record.getByRole('button',{name:'Edit Walk at 10:15'}).click();
 await expect(page.getByLabel('Pee',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Poo',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Temperature',{exact:true})).toHaveValue('36.7');
 await page.getByLabel('Activity name').fill('Bath');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(record).toContainText('Bath');
 await expect(page.getByLabel('Vitamin D given')).not.toBeChecked();
 await page.getByLabel('Vitamin D given').click();
 await expect(page.getByLabel('Vitamin D given')).toBeChecked();
 await page.reload();
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-03');
 await expect(page.getByLabel('Vitamin D given')).toBeChecked();
 await page.getByRole('button',{name:'Next day',exact:true}).click();
 await expect(record).toHaveCount(0);
 await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await expect(record).toContainText('Bath');
 await page.screenshot({path:info.outputPath('diary.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await record.getByRole('button',{name:'Edit Bath at 10:15'}).click();
 await page.getByRole('button',{name:'Delete entry',exact:true}).click();
 await page.getByRole('button',{name:'Keep entry',exact:true}).click();
 await expect(record).toHaveCount(1);
 await page.getByRole('button',{name:'Delete entry',exact:true}).click();
 await page.getByRole('button',{name:'Delete entry',exact:true}).click();
 await expect(record).toHaveCount(0);
});

test('running sleep spans midnight and ends on the next day',async({page})=>{
 await page.clock.setSystemTime(new Date('2026-11-02T22:50:00Z'));
 await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-02');
 await page.getByRole('button',{name:'Sleep',exact:true}).click();
 await typeEntryTime(page,'start','2026-11-02T23:50');
 await page.getByLabel('Still in progress').check();
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByLabel('Active timers')).toContainText('Sleep in progress');
 await page.clock.fastForward(20*60_000);
 await page.getByRole('button',{name:'Next day',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toHaveCount(1);
 await page.getByRole('button',{name:'End now',exact:true}).click();
 await expect(page.getByLabel('Active timers')).toHaveCount(0);
 await expect(page.locator('.timeline-entry')).toContainText('23:50 - 00:10 (2026-11-03)');
});

test('failed save keeps the form and permits a retry',async({page})=>{
 await page.getByLabel('Notes').fill('Keep this unsaved note.');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'The server is unavailable. Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await expect(page.getByLabel('Notes')).toHaveValue('Keep this unsaved note.');
 await page.unroute('**/api/entry-saves/*');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('.timeline-entry')).toContainText('Keep this unsaved note.');
});

test('proposal shows an older target and needs explicit confirmation',async({page},info)=>{
 const old={id:'00000000-0000-4000-8000-000000000001',activity:'nappy',startAt:'2026-10-01T08:00:00.000Z',endAt:null,status:'completed',pee:true,poo:false,temperature:36.7,notes:'Original record.',version:1,createdAt:'2026-10-01T08:00:00.000Z',updatedAt:'2026-10-01T08:00:00.000Z'};
 const proposal={id:'check',summary:'Change the older nappy note.',operations:[{type:'update_entry',id:old.id,version:1,entry:{...old,notes:'Changed note.'}}],targets:[old],status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString()};
 let confirmed=0;
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:proposal.summary,proposal}}));
 await page.route('**/api/proposals/check/confirm',route=>{confirmed++;return route.fulfill({json:{...proposal,status:'confirmed'}});});
 await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByLabel('Your instruction').fill('Change the older nappy note.');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('.proposal')).toContainText('2026-10-01 at 10:00');
 await expect(page.locator('.proposal')).toContainText('Original record.');
 await expect(page.locator('.proposal')).toContainText('Changed note.');
 expect(confirmed).toBe(0);
 await page.screenshot({path:info.outputPath('proposal.png'),fullPage:true});
 await page.getByRole('button',{name:'Confirm changes',exact:true}).click();
 await expect(page.getByText('Nappy change updated (2026-10-01 10:00).')).toBeVisible();
 expect(confirmed).toBe(1);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('offline PWA shell protects the diary and does not cache the API',async({page,context})=>{
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload();
 await expect(page.getByRole('heading',{name:'Our daily diary'})).toBeVisible();
 await context.setOffline(true);
 await page.reload();
 await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('Babylog is temporarily unavailable');
 await expect(page.locator('.app-shell')).toHaveCount(0);
 expect(await page.evaluate(async()=>{
  const names=await caches.keys();
  const requests=(await Promise.all(names.map(async name=>(await caches.open(name)).keys()))).flat();
  return requests.some(r=>new URL(r.url).pathname.startsWith('/api/'));
 })).toBe(false);
 await context.setOffline(false);await page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Our daily diary'})).toBeVisible();
});

test('stale edit preserves the form and the newer server record',async({page,request})=>{
 await typeEntryTime(page,'start','2026-11-03T10:15');
 await page.getByLabel('Notes').fill('Initial note.');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await page.locator('.timeline-entry').getByRole('button').click();
 await page.getByLabel('Notes').fill('Unsaved phone edit.');
 const [entry]=await (await request.get('/api/entries')).json();
 await request.put('/api/entries/'+entry.id,{data:{...entry,notes:'Newer iPad edit.'}});
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('changed on another device');
 await expect(page.getByLabel('Notes')).toHaveValue('Unsaved phone edit.');
 const [current]=await (await request.get('/api/entries')).json();
 expect(current.notes).toBe('Newer iPad edit.');
});

test('delete proposal shows old findings and cancellation keeps the diary',async({page})=>{
 const old={id:'00000000-0000-4000-8000-000000000002',activity:'nappy',startAt:'2026-10-01T08:00:00.000Z',endAt:null,status:'completed',pee:true,poo:true,temperature:36.7,notes:'Original nappy.',version:1,createdAt:'2026-10-01T08:00:00.000Z',updatedAt:'2026-10-01T08:00:00.000Z'};
 let rejected=0,confirmed=0;
 const proposal={id:'delete-check',summary:'Delete the older nappy.',operations:[{type:'delete_entry',id:old.id,version:1}],targets:[old],status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString()};
 await page.route('**/api/assistant',route=>route.fulfill({json:{message:proposal.summary,proposal}}));
 await page.route('**/api/proposals/delete-check/reject',route=>{rejected++;return route.fulfill({json:{ok:true}});});
 await page.route('**/api/proposals/delete-check/confirm',route=>{confirmed++;return route.fulfill({json:{ok:true}});});
 await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByLabel('Your instruction').fill('Delete the older nappy.');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('.proposal')).toContainText('2026-10-01 at 10:00');
 await expect(page.locator('.proposal')).toContainText('Pee. Poo. 36.7 C. Original nappy.');
 await page.getByRole('button',{name:'Cancel changes',exact:true}).click();
 await expect(page.getByText('Changes cancelled.')).toBeVisible();
 expect(rejected).toBe(1);expect(confirmed).toBe(0);
});

test('assistant replies stay visible without speech controls or speech requests',async({page})=>{
 const message='Which activity and time should I use?';let requests=0;
 await page.route('**/api/assistant',route=>route.fulfill({json:{message,proposal:null}}));
 await page.route('**/api/speech',route=>{requests++;return route.abort();});
 await page.getByRole('button',{name:'Settings',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 await page.getByLabel('Your instruction').fill('Add a record.');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByText(message,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Read aloud'})).toHaveCount(0);await expect(page.getByLabel('Read responses aloud')).toHaveCount(0);
 expect(requests).toBe(0);
});
