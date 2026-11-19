import {readFile} from 'node:fs/promises';
import {test,expect,type Page} from './test.ts';
import type {Entry} from '../src/shared.ts';

test.use({serviceWorkers:'block'});

const entry=(id:string,activity:string,startAt:string,endAt:string|null=null,status:Entry['status']='completed'):Entry=>({
 id,activity,startAt,endAt,status,feedingType:activity==='feeding'?'Syringe':null,breastSide:null,
 pee:activity==='nappy',poo:false,temperature:null,notes:id,version:1,createdAt:startAt,updatedAt:startAt
});
const feeding=entry('latest-feed','feeding','2026-11-18T17:30:00Z');
const tasks=[{key:'vitamin_d',label:'Vitamin D given',active:true,version:1}];
const checks=(done=false)=>({vitamin_d:{done,version:1}});
async function fixture(page:Page,entries:Entry[]=[feeding]){
 await page.clock.install({time:new Date('2026-11-18T17:44:00Z')});
 await page.route('**/api/entries**',route=>route.fulfill({json:entries}));
 await page.route('**/api/care-tasks',route=>route.fulfill({json:tasks}));
 await page.route('**/api/care/*',route=>route.fulfill({json:checks()}));
}

test('date navigation reuses entries and keeps Latest Care ready during slow daily checks',async({page},info)=>{
 await fixture(page);
 const requests:string[]=[];
 page.on('request',request=>{if(/\/api\/(entries|care-tasks|care\/)/.test(request.url()))requests.push(new URL(request.url()).pathname+new URL(request.url()).search);});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/care/2026-11-17',async route=>{await gate;await route.fulfill({json:checks(true)});});
 await page.goto('/');const latest=page.getByRole('region',{name:'Latest Care',exact:true});
 await expect(latest).toContainText('0h 14m ago');await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeEnabled();
 const before=requests.length;
 await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await expect(page.locator('.date-selector')).toContainText('Yesterday');
 await expect(latest).toContainText('0h 14m ago');await expect(latest).not.toContainText('Loading');
 await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeDisabled();
 await expect(page.locator('.log-panel')).toContainText('No entries yet');
 expect(requests.slice(before)).toEqual(['/api/care/2026-11-17']);
 release();await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeChecked();
 await page.getByRole('button',{name:'Go to today',exact:true}).click();
 await expect(page.locator('.date-selector')).toContainText('Today');
 await expect(page.getByLabel('Vitamin D given',{exact:true})).not.toBeChecked();
 expect(requests.filter(path=>path.startsWith('/api/entries'))).toEqual(['/api/entries']);
 expect(requests.filter(path=>path==='/api/care-tasks')).toHaveLength(1);
 await page.screenshot({path:info.outputPath('latest-care-date.png'),fullPage:true});
 let refreshed!:()=>void;const revalidation=new Promise<void>(resolve=>{refreshed=resolve;});
 await page.route('**/api/care/2026-11-17',async route=>{await revalidation;await route.fulfill({json:checks(false)});});
 await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeDisabled();
 refreshed();await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeEnabled();
 await expect(page.getByLabel('Vitamin D given',{exact:true})).not.toBeChecked();
});

test('daily check failures and late date responses cannot replace Latest Care or another date checks',async({page})=>{
 await fixture(page);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/care/2026-11-17',async route=>{await gate;await route.fulfill({json:checks(true)});});
 await page.route('**/api/care/2026-11-16',route=>route.fulfill({json:checks(false)}));
 await page.goto('/');await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeEnabled();
 const late=page.waitForResponse(response=>response.url().endsWith('/api/care/2026-11-17'));
 release();await (await late).finished();await expect(page.getByLabel('Vitamin D given',{exact:true})).not.toBeChecked();
 await page.route('**/api/care/2026-11-15',route=>route.fulfill({status:503,json:{error:'Daily checks are unavailable.'}}));
 await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Daily checks are unavailable.');
 await expect(page.getByRole('region',{name:'Latest Care',exact:true})).toContainText('0h 14m ago');
 await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Go to today',exact:true}).click();
 await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeEnabled();
});

test('initial task failure does not delay entries and later polling recovers',async({page})=>{
 await fixture(page);let fail=true;
 await page.route('**/api/care-tasks',route=>fail?route.fulfill({status:503,json:{error:'Daily tasks are unavailable.'}}):route.fulfill({json:tasks}));
 await page.goto('/');await expect(page.getByRole('region',{name:'Latest Care',exact:true})).toContainText('0h 14m ago');
 await expect(page.locator('.log-panel')).toContainText('latest-feed');
 await expect(page.getByRole('alert')).toContainText('Daily tasks are unavailable.');
 fail=false;await page.clock.fastForward(10000);await expect(page.getByLabel('Vitamin D given',{exact:true})).toBeEnabled();
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('initial entry failure stops loading and retries without a page reload',async({page})=>{
 await fixture(page);let fail=true;
 await page.route('**/api/entries',route=>fail?route.fulfill({status:503,json:{error:'Entries are unavailable.'}}):route.fulfill({json:[feeding]}));
 await page.goto('/');const latest=page.getByRole('region',{name:'Latest Care',exact:true});
 await expect(latest).toContainText('Unavailable');await expect(latest).not.toContainText('Loading');
 fail=false;await page.locator('.log-panel').getByRole('button',{name:'Try again',exact:true}).click();
 await expect(latest).toContainText('0h 14m ago');await expect(page.getByRole('alert')).toHaveCount(0);
});

test('polling pauses while hidden and resumes once without overlapping entry requests',async({page})=>{
 await fixture(page);let count=0,inflight=0,maximum=0;
 let release:(()=>void)|undefined;
 await page.route('**/api/entries',async route=>{
  count++;inflight++;maximum=Math.max(maximum,inflight);
  if(count===2)await new Promise<void>(resolve=>{release=resolve;});
  inflight--;await route.fulfill({json:count===1?[feeding]:[]});
 });
 await page.goto('/');await expect(page.getByRole('region',{name:'Latest Care',exact:true})).toContainText('0h 14m ago');
 await page.clock.fastForward(10000);await expect.poll(()=>count).toBe(2);
 await page.clock.fastForward(30000);expect(count).toBe(2);expect(maximum).toBe(1);
 release!();await expect(page.getByRole('region',{name:'Latest Care',exact:true})).toContainText('No record');
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 const hidden=count;await page.clock.fastForward(60000);expect(count).toBe(hidden);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});
 await expect.poll(()=>count).toBe(hidden+1);expect(maximum).toBe(1);
});

test('local date filtering preserves overnight records and updates relative labels after midnight',async({page})=>{
 await fixture(page,[entry('overnight','sleep','2026-11-17T22:00:00Z','2026-11-18T00:00:00Z'),entry('running','feeding','2026-11-18T22:30:00Z',null,'active')]);
 await page.clock.setSystemTime(new Date('2026-11-18T22:59:50Z'));
 await page.goto('/');await expect(page.locator('.timeline')).toContainText('overnight');await expect(page.locator('.timeline')).toContainText('running');
 await expect(page.locator('.date-selector')).toContainText('Today');
 await page.clock.fastForward(30000);await expect(page.locator('.date-selector')).toContainText('Yesterday');
 await page.getByRole('button',{name:'Go to today',exact:true}).click();
 await expect(page.locator('.timeline')).toContainText('running');await expect(page.locator('.timeline')).not.toContainText('overnight');
});

for(const signOut of [false,true])test(signOut?'sign-out cancels the refresh queued behind a slow poll':'a save during a slow poll refreshes again after the old entry response finishes',async({page})=>{
 await fixture(page);let count=0,saved=false;
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const added=entry('saved-feed','feeding','2026-11-18T17:44:00Z');
 await page.route('**/api/entry-saves/*',async route=>{saved=true;await route.fulfill({json:added});});
 await page.route('**/api/entries',async route=>{
  count++;const snapshot=saved?[added,feeding]:[feeding];
  if(count===2)await gate;
  await route.fulfill({json:snapshot});
 });
 await page.goto('/');await expect(page.getByRole('region',{name:'Latest Care',exact:true})).toContainText('0h 14m ago');
 await page.clock.fastForward(10000);await expect.poll(()=>count).toBe(2);
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('button',{name:'Feeding',exact:true}).click();
 await page.getByRole('combobox',{name:'Feeding subtype',exact:true}).selectOption('Syringe');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 if(signOut){
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  const completed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/entries');
  release();await (await completed).finished();
  await page.waitForTimeout(100);expect(count).toBe(2);
  return;
 }
 release();await expect.poll(()=>count).toBe(3);
 await expect(page.locator('.timeline')).toContainText('saved-feed');
 await expect(page.getByRole('region',{name:'Latest Care',exact:true})).toContainText('0h 0m ago');
});

test('JSON export keeps the diary and draft open through cancellation, failure, and repeat download',async({page},info)=>{
 await fixture(page);await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByPlaceholder('Optional notes',{exact:true}).fill('Unsaved phone draft');
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:/export/i})).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog');
 let fail=false;
 await page.route('**/api/export',route=>fail?route.fulfill({status:503,json:{error:'Export is unavailable.'}}):route.fulfill({json:{entries:[feeding],care:[],careTasks:tasks},headers:{'Content-Disposition':'attachment; filename="babylog-export.json"'}}));
 const url=page.url();
 for(let attempt=0;attempt<2;attempt++){
  const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download diary JSON',exact:true}).click();
  const download=await downloaded;expect(download.suggestedFilename()).toBe('babylog-export.json');if(attempt===0)await download.cancel();else expect(JSON.parse(await readFile((await download.path())!,'utf8'))).toEqual({entries:[feeding],care:[],careTasks:tasks});
  await expect(dialog.getByRole('button',{name:'Download diary JSON',exact:true})).toBeEnabled();expect(page.url()).toBe(url);
 }
 fail=true;await dialog.getByRole('button',{name:'Download diary JSON',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Export is unavailable.');expect(page.url()).toBe(url);
 await page.screenshot({path:info.outputPath('settings-export.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 await expect(page.getByPlaceholder('Optional notes',{exact:true})).toHaveValue('Unsaved phone draft');
});
