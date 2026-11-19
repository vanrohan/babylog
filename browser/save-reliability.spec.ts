import {test,expect,saveEntry,type Page,type Locator} from './test.ts';

test.use({serviceWorkers:'block'});

const savedTime='2026-11-19T12:23:17.123Z';
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};};
async function openDraft(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('button',{name:'Nappy change',exact:true}).click();await page.getByLabel('Notes').fill('Keep this exact draft.');
}
async function expectBusy(button:Locator){
 await expect(button).toBeDisabled();await expect(button).toHaveAttribute('aria-busy','true');
 await expect(button.locator('.button-spinner')).toBeVisible();await expect(button.locator('.button-spinner')).toHaveAttribute('aria-hidden','true');
}

test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date(savedTime));
});

test('a lost save response retries once without duplicate records and keeps one spinner',async({page,request},info)=>{
 await openDraft(page);const waiting=gate(),keys:string[]=[],bodies:string[]=[];
 await page.route('**/api/entry-saves/*',async route=>{
  keys.push(route.request().url());bodies.push(route.request().postData()!);
  if(keys.length===1){await route.fetch();await route.abort();return;}
  await waiting.promise;await route.continue();
 });
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect.poll(()=>keys.length).toBe(2);const save=page.getByRole('button',{name:'Saving...',exact:true});
 await expectBusy(save);await expect(page.getByLabel('Notes')).toHaveValue('Keep this exact draft.');
 await expect(page.getByLabel('Notes')).toBeDisabled();await expect(page.locator('#manual-entry .button-spinner')).toHaveCount(1);
 expect(keys[0]).toBe(keys[1]);expect(bodies[0]).toBe(bodies[1]);
 expect(await (await request.get('/api/entries')).json()).toHaveLength(1);
 await save.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('pending-save.png'),fullPage:true});
 waiting.release();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 await expect(page.getByRole('alert')).toHaveCount(0);expect(await (await request.get('/api/entries')).json()).toHaveLength(1);
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('button',{name:'Nappy change',exact:true}).click();
 await saveEntry(page);expect(keys[2]).not.toBe(keys[0]);expect(await (await request.get('/api/entries')).json()).toHaveLength(2);
});

test('an exhausted save retains its key through closing, navigation, and manual retry',async({page})=>{
 await openDraft(page);const keys:string[]=[];
 await page.route('**/api/entry-saves/*',async route=>{keys.push(route.request().url());if(keys.length<=2)await route.abort();else await route.continue();});
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 const save=page.getByRole('button',{name:'Save entry',exact:true});await expect(save).toBeEnabled();await expect(save).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Time log',exact:true}).click();
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();await expect(page.getByLabel('Notes')).toHaveValue('Keep this exact draft.');
 await saveEntry(page);expect(keys).toHaveLength(3);expect(new Set(keys).size).toBe(1);
});

test('editing an unconfirmed committed draft cannot create a duplicate',async({page,request})=>{
 await openDraft(page);let attempts=0;const keys:string[]=[];
 await page.route('**/api/entry-saves/*',async route=>{
  attempts++;keys.push(route.request().url());if(attempts===1){await route.fetch();await route.abort();}
  else if(attempts===2)await route.abort();else await route.continue();
 });
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await page.getByLabel('Notes').fill('Changed after the lost response.');await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('already completed with different values');
 await expect(page.getByLabel('Notes')).toHaveValue('Changed after the lost response.');
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.notes).toBe('Keep this exact draft.');
 expect(await (await request.get('/api/entries')).json()).toHaveLength(1);expect(attempts).toBe(3);expect(new Set(keys).size).toBe(1);
});

test('only Undo, Delete, or End shows a spinner during its request and recovers after failure',async({page,request})=>{
 const original=await (await request.post('/api/entries',{data:{activity:'nappy',startAt:savedTime,notes:'Before edit.'}})).json();
 await request.put('/api/entries/'+original.id,{data:{...original,notes:'After edit.'}});
 await page.goto('/');await page.locator('.timeline-entry').getByRole('button').click();
 await page.getByRole('button',{name:'Other',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Enter an activity name.');
 await page.getByText('Undo last edit',{exact:true}).click();
 const undoGate=gate();await page.route('**/api/entries/*/undo',async route=>{if(route.request().method()==='POST'){await undoGate.promise;await route.fulfill({status:503,json:{error:'Restore failed.'}});}else await route.continue();});
 const undo=page.getByRole('button',{name:'Restore previous entry',exact:true});await undo.click();await expectBusy(undo);
 await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();await expect(page.locator('#manual-entry .button-spinner')).toHaveCount(1);
 undoGate.release();await expect(page.getByRole('alert')).toContainText('Restore failed.');await expect(undo).toBeEnabled();
 await page.unroute('**/api/entries/*/undo');await undo.click();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 await page.locator('.timeline-entry').getByRole('button').click();
 await page.getByRole('button',{name:'Other',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Enter an activity name.');
 await page.getByRole('button',{name:'Delete entry',exact:true}).click();
 const deleteGate=gate();await page.route('**/api/entries/*',async route=>{if(route.request().method()==='DELETE'){await deleteGate.promise;await route.fulfill({status:503,json:{error:'Delete failed.'}});}else await route.continue();});
 const remove=page.getByRole('button',{name:'Delete entry',exact:true});await remove.click();await expectBusy(remove);
 await expect(page.locator('#manual-entry .button-spinner')).toHaveCount(1);deleteGate.release();
 await expect(page.getByRole('alert')).toContainText('Delete failed.');await expect(remove).toBeEnabled();
 await page.unroute('**/api/entries/*');await remove.click();await expect(page.locator('.timeline-entry')).toHaveCount(0);
 await request.post('/api/entries',{data:{activity:'sleep',startAt:savedTime}});await page.reload();
 const endGate=gate(),keys:string[]=[],bodies:string[]=[];
 await page.route('**/api/entry-saves/*',async route=>{
  keys.push(route.request().url());bodies.push(route.request().postData()!);
  if(keys.length===1){await endGate.promise;await route.fetch();await route.abort();}
  else if(keys.length===2)await route.abort();else await route.continue();
 });
 const end=page.getByRole('button',{name:'End now',exact:true});await end.click();await expectBusy(end);
 endGate.release();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');await expect(end).toBeEnabled();
 const [completed]=await (await request.get('/api/entries')).json();expect(completed.version).toBe(2);
 const undoReceipt=await (await request.get('/api/entries/'+completed.id+'/undo')).json();
 await page.clock.setFixedTime(new Date('2026-11-19T12:24:17.123Z'));await end.click();await expect(end).toHaveCount(0);
 expect(keys).toHaveLength(3);expect(new Set(keys).size).toBe(1);expect(new Set(bodies).size).toBe(1);
 const [replayed]=await (await request.get('/api/entries')).json();expect(replayed).toEqual(completed);
 expect(await (await request.get('/api/entries/'+completed.id+'/undo')).json()).toEqual(undoReceipt);
});

test('settings and account buttons show their own pending state and recover after failures',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog');
 for(const action of ['add','rename','remove','export','logout']){
  const waiting=gate();let button:Locator;
  const path=action==='add'?'**/api/care-tasks':action==='rename'||action==='remove'?'**/api/care-tasks/*':action==='export'?'**/api/export':'**/api/auth/logout';
  await page.route(path,async route=>{await waiting.promise;await route.fulfill({status:503,json:{error:'Test action failed.'}});});
  if(action==='add'){await dialog.getByLabel('New daily task',{exact:true}).fill('Test task');button=dialog.getByRole('button',{name:'Add daily task',exact:true});}
  else if(action==='rename'){await dialog.getByLabel('Task name: Vitamin D given',{exact:true}).fill('Vitamin D draft');button=dialog.getByRole('button',{name:'Save task Vitamin D given',exact:true});}
  else if(action==='remove'){await dialog.getByRole('button',{name:'Remove task Vitamin D given',exact:true}).click();button=dialog.getByRole('button',{name:'Remove from checklist',exact:true});}
  else if(action==='export')button=dialog.getByRole('button',{name:'Download diary JSON',exact:true});
  else button=dialog.getByRole('button',{name:'Sign out',exact:true});
  await button.click();const pending=action==='export'?dialog.getByRole('button',{name:'Preparing diary JSON...',exact:true}):button;
  await expectBusy(pending);await expect(dialog.locator('.button-spinner')).toHaveCount(1);
  waiting.release();await expect(dialog.getByRole('alert').filter({hasText:'Test action failed.'})).toHaveCount(action==='add'?1:action==='rename'||action==='remove'?2:action==='export'?3:4);
  await expect(pending.locator('.button-spinner')).toHaveCount(0);await page.unroute(path);
  if(action==='remove')await dialog.getByRole('button',{name:'Keep task',exact:true}).click();
 }
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 await page.getByLabel('Username',{exact:true}).fill('browser-owner');await page.getByLabel('Password',{exact:true}).fill('Synthetic browser password 123');
 const loginGate=gate();await page.route('**/api/auth/login',async route=>{await loginGate.promise;await route.fulfill({status:503,json:{error:'Sign in failed.'}});});
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await expectBusy(page.getByRole('button',{name:'Signing in...',exact:true}));
 loginGate.release();await expect(page.getByRole('alert')).toContainText('Sign in failed.');await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
});

test('Assistant buttons show a spinner only on the active action',async({page})=>{
 const proposal={id:'spinner-test',operations:[{type:'create_entry',entry:{activity:'bath',feedingType:null,breastSide:null,startAt:savedTime,endAt:null,status:'completed',pee:false,poo:false,temperature:null,notes:''}}],targets:[]};
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();
 const sendGate=gate();await page.route('**/api/assistant',async route=>{await sendGate.promise;await route.fulfill({json:{message:'Review this bath.',proposal}});});
 await page.getByLabel('Your instruction').fill('Add a bath.');const send=page.getByRole('button',{name:'Send',exact:true});await send.click();await expectBusy(send);
 sendGate.release();const confirm=page.getByRole('button',{name:'Confirm changes',exact:true});await expect(confirm).toBeVisible();
 const confirmGate=gate();await page.route('**/api/proposals/*/confirm',async route=>{await confirmGate.promise;await route.fulfill({status:503,json:{error:'Confirm failed.'}});});
 await confirm.click();await expectBusy(confirm);await expect(page.locator('.assistant-actions .button-spinner')).toHaveCount(1);
 confirmGate.release();await expect(page.getByRole('alert')).toContainText('Confirm failed.');await expect(confirm).toBeEnabled();
 const cancelGate=gate();await page.route('**/api/proposals/*/reject',async route=>{await cancelGate.promise;await route.fulfill({json:{ok:true}});});
 const cancel=page.getByRole('button',{name:'Cancel changes',exact:true});await cancel.click();await expectBusy(cancel);
 cancelGate.release();await expect(cancel).toHaveCount(0);await expect(send).toBeVisible();
});

test('reduced motion keeps a static pending indicator',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await openDraft(page);const waiting=gate();
 await page.route('**/api/entry-saves/*',async route=>{await waiting.promise;await route.continue();});
 await page.getByRole('button',{name:'Save entry',exact:true}).click();const save=page.getByRole('button',{name:'Saving...',exact:true});
 await expectBusy(save);await expect(save.locator('.button-spinner')).toHaveCSS('animation-name','none');
 waiting.release();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
});

test('a pending save locks other entry selections and date changes',async({page,request})=>{
 await request.post('/api/entries',{data:{activity:'bath',startAt:savedTime}});await openDraft(page);
 const waiting=gate();await page.route('**/api/entry-saves/*',async route=>{await waiting.promise;await route.continue();});
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expectBusy(page.getByRole('button',{name:'Saving...',exact:true}));
 await expect(page.locator('.timeline-entry').getByRole('button')).toBeDisabled();
 await expect(page.getByRole('button',{name:'Next day',exact:true})).toBeDisabled();await expect(page.getByRole('textbox',{name:'Diary date',exact:true})).toBeDisabled();
 waiting.release();await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 await expect(page.locator('.timeline-entry')).toHaveCount(2);
 await expect(page.locator('.timeline-entry').getByRole('button').first()).toBeEnabled();
 await expect(page.getByRole('button',{name:'Next day',exact:true})).toBeEnabled();
});
