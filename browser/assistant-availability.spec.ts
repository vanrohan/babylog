import {test,expect} from './test.ts';
test.use({serviceWorkers:'block'});

for(const mode of ['disabled','loading','failure'] as const){
 test(`Assistant stays hidden with ${mode} configuration`,async({page},info)=>{
  let release:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/config',async route=>{
   if(mode==='failure')return route.abort();
   if(mode==='loading')await pending;
   return route.fulfill({json:{assistantAvailable:false,transcriptionAvailable:false}});
  });
  await page.goto('/assistant');
  await expect(page.getByRole('heading',{name:'Our daily diary',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Assistant',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Settings',exact:true}).last().click();
  await expect(page.getByRole('button',{name:'Assistant',exact:true})).toHaveCount(0);
  if(mode==='loading'){release();await expect(page.getByRole('heading',{name:'Daily tasks',exact:true})).toBeVisible();}
  await page.screenshot({path:info.outputPath(`settings-${mode}.png`),fullPage:true});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add an entry',exact:true})).toBeVisible();
 });
}

test('Settings opens typed Assistant without speech, keeps typed focus, and preserves the manual draft',async({page},info)=>{
 await page.route('**/api/config',route=>route.fulfill({json:{assistantAvailable:true,transcriptionAvailable:false}}));
 let calls=0;
 await page.route('**/api/assistant',route=>{
  calls++;
  if(calls===1)return route.fulfill({status:502,json:{error:'Try again.'}});
  if(calls===2)return route.fulfill({json:{message:'What time?',proposal:null}});
  return route.fulfill({json:{message:'Add a bath.',proposal:{id:'typed-proposal',summary:'Add a bath.',operations:[{type:'create_entry',entry:{activity:'bath',startAt:'2026-11-17T10:00:00Z',endAt:null,status:'completed',pee:false,poo:false,temperature:null,notes:''}}]}}});
 });
 await page.route('**/api/proposals/typed-proposal/reject',route=>route.fulfill({json:{ok:true}}));
 await page.goto('/');
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await page.getByRole('textbox',{name:/^Notes/}).fill('Keep this manual draft.');
 await page.getByLabel('Pee',{exact:true}).check();
 await expect(page.getByRole('button',{name:'Assistant',exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'Settings',exact:true}).last().click();
 const assistant=page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true});await expect(assistant).toBeVisible();
 expect((await assistant.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:info.outputPath('settings-enabled.png'),fullPage:true});
 await assistant.click();
 const instruction=page.getByRole('textbox',{name:'Your instruction',exact:true});
 await expect(instruction).toBeFocused();await expect(page.getByRole('button',{name:'Record voice'})).toHaveCount(0);
 await instruction.fill('Record a bath.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Try again.');await expect(instruction).toHaveValue('Record a bath.');await expect(instruction).toBeFocused();
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Your reply',exact:true})).toBeFocused();
 await page.getByRole('textbox',{name:'Your reply',exact:true}).fill('At eleven.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Cancel changes',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Your reply',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'New instruction',exact:true}).click();await expect(instruction).toBeFocused();
 await page.screenshot({path:info.outputPath('assistant-typed.png'),fullPage:true});
 await page.getByRole('button',{name:'Close Assistant'}).click();
 await expect(page.getByRole('button',{name:'Settings',exact:true}).last()).toBeFocused();
 await expect(page.getByRole('textbox',{name:/^Notes/})).toHaveValue('Keep this manual draft.');
 await expect(page.getByLabel('Pee',{exact:true})).toBeChecked();
 await page.goBack();await expect(instruction).toBeVisible();
});

test('an open page receives Assistant availability without losing its draft',async({page},info)=>{
 await page.clock.install();let enabled=false,calls=0;
 await page.route('**/api/config',route=>{calls++;return route.fulfill({json:{assistantAvailable:enabled,transcriptionAvailable:enabled}});});
 await page.goto('/');await expect.poll(()=>calls).toBe(1);
 await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByLabel('Notes').fill('Keep this open draft.');
 await expect(page.getByRole('button',{name:'Assistant',exact:true})).toHaveCount(0);
 enabled=true;await page.clock.fastForward(10000);
 const assistant=page.getByRole('button',{name:'Assistant',exact:true});await expect(assistant).toBeVisible();
 await assistant.click();await expect(page.getByRole('textbox',{name:'Your instruction',exact:true})).toBeEditable();
 await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close Assistant',exact:true}).click();await page.clock.runFor(20);await expect(assistant).toBeFocused();
 await expect(page.getByLabel('Notes')).toHaveValue('Keep this open draft.');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();
 if(info.project.name!=='desktop'){
  await page.setViewportSize({width:320,height:844});await page.addStyleTag({content:'.mobile-pages button{font-size:20px}'});
  const nav=page.getByRole('navigation',{name:'Diary pages',exact:true});
  expect(await nav.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  for(const button of await nav.getByRole('button').all()){
   const box=(await button.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);
  }
 }
 await page.screenshot({path:info.outputPath('assistant-navigation.png'),fullPage:true});
});

test('configuration failures recover on focus and keep known availability during another failure',async({page})=>{
 let failed=true,malformed=false,calls=0;
 await page.route('**/api/config',route=>{calls++;return failed?route.abort():route.fulfill({json:malformed?{}:{assistantAvailable:true,transcriptionAvailable:false}});});
 await page.goto('/');await expect.poll(()=>calls).toBe(1);await expect(page.getByRole('button',{name:'Assistant',exact:true})).toHaveCount(0);
 failed=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const assistant=page.getByRole('button',{name:'Assistant',exact:true});await expect(assistant).toBeVisible();
 failed=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>calls).toBe(3);await expect(assistant).toBeVisible();
 failed=false;malformed=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>calls).toBe(4);await expect(assistant).toBeVisible();
});

test('a stalled config request times out and late responses cannot replace renewed availability',async({page})=>{
 await page.clock.install();let calls=0,release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/config',async route=>{
  calls++;if(calls===1){await waiting;await route.fulfill({json:{assistantAvailable:false,transcriptionAvailable:false}});}
  else await route.fulfill({json:{assistantAvailable:true,transcriptionAvailable:false}});
 });
 await page.goto('/');await expect.poll(()=>calls).toBe(1);await page.clock.runFor(8500);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const assistant=page.getByRole('button',{name:'Assistant',exact:true});await expect(assistant).toBeVisible();expect(calls).toBe(2);
 release();await expect(assistant).toBeVisible();
});

test('session expiry cancels a config response before the retained page signs in again',async({page})=>{
 let delayed=false,calls=0,release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/config',async route=>{
  calls++;if(delayed){await waiting;await route.fulfill({json:{assistantAvailable:true,transcriptionAvailable:true}});}
  else await route.fulfill({json:{assistantAvailable:false,transcriptionAvailable:false}});
 });
 await page.goto('/');await expect.poll(()=>calls).toBe(1);delayed=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>calls).toBe(2);
 await page.evaluate(()=>window.dispatchEvent(new Event('babylog:unauthorized')));
 await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 delayed=false;release();
 await page.getByLabel('Username',{exact:true}).fill('browser-owner');await page.getByLabel('Password',{exact:true}).fill('Synthetic browser password 123');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Our daily diary',exact:true})).toBeVisible();
 await expect.poll(()=>calls).toBe(3);await expect(page.getByRole('button',{name:'Assistant',exact:true})).toHaveCount(0);
});
