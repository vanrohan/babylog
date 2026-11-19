import {test,expect,type Page} from '@playwright/test';
// Service workers bypass page-level network mocks.
test.use({serviceWorkers:'block'});
const login={username:'browser-owner',password:'Synthetic browser password 123'};
async function signIn(page:Page){
 await page.getByRole('textbox',{name:'Username',exact:true}).fill(login.username);await page.getByLabel('Password',{exact:true}).fill(login.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
}
async function settings(page:Page){await page.getByRole('button',{name:'Settings',exact:true}).last().click();}

test('shared login protects data and Settings contains no account management',async({page,request},info)=>{
 expect((await request.get('/api/export')).status()).toBe(401);await page.goto('/');await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();await expect(page.locator('.app-shell')).toHaveCount(0);
 await expect(page.getByText('Sign-in help',{exact:true})).toHaveCount(0);await expect(page.locator('.auth-help')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('login-clean.png')});
 await page.getByRole('textbox',{name:'Username',exact:true}).fill(login.username);await page.getByLabel('Password',{exact:true}).fill('wrong');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('The username or password is incorrect.');
 await page.screenshot({path:info.outputPath('login.png')});await signIn(page);await settings(page);
 await expect(page.getByRole('region',{name:'Household login',exact:true})).toContainText(login.username);
 await expect(page.getByText('Manage accounts',{exact:true})).toHaveCount(0);await expect(page.getByText('Change password',{exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('shared-settings.png')});
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();await expect(page.locator('.app-shell')).toHaveCount(0);
 await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
});

test('login shows a useful rate-limit error and retains the entered username',async({page})=>{
 await page.goto('/');
 await page.route('**/api/auth/login',route=>route.fulfill({status:429,headers:{'Retry-After':'840'},json:{error:'Too many sign-in attempts. Try again in 14 minutes.'}}));
 await page.getByRole('textbox',{name:'Username',exact:true}).fill(login.username);await page.getByLabel('Password',{exact:true}).fill('wrong');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Too many sign-in attempts. Try again in 14 minutes.');
 await expect(page.getByRole('textbox',{name:'Username',exact:true})).toHaveValue(login.username);
 await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
});

test('two devices use the same login and signing out leaves the other signed in',async({page,browser})=>{
 await page.goto('/');await signIn(page);const context=await browser.newContext({serviceWorkers:'block'});
 try{
  const second=await context.newPage();await second.goto('http://127.0.0.1:3006/');await signIn(second);
  expect((await second.request.get('/api/entries')).status()).toBe(200);
  await settings(page);await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  await second.reload();await expect(second.locator('.app-shell')).toBeVisible();expect((await second.request.get('/api/export')).status()).toBe(200);
 }finally{await context.close();}
});

test('a 401 during Save preserves the household draft after signing in again',async({page})=>{
 await page.goto('/');await signIn(page);await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.locator('#entry-form').getByRole('button',{name:'Bath',exact:true}).click();await page.getByRole('textbox',{name:/^Notes/}).fill('Retain after an expired Save.');
 const before=await (await page.request.get('/api/entries')).json();await page.request.post('/api/auth/logout',{data:{}});
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 await signIn(page);expect((await (await page.request.get('/api/entries')).json()).length).toBe(before.length);await expect(page.getByRole('textbox',{name:/^Notes/})).toHaveValue('Retain after an expired Save.');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();
});

test('a changed credential generation clears a retained draft',async({page})=>{
 await page.goto('/');await signIn(page);await page.getByRole('button',{name:'Add an entry',exact:true}).click();await page.getByRole('textbox',{name:/^Notes/}).fill('Old login draft.');
 await page.request.post('/api/auth/logout',{data:{}});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 await page.route('**/api/auth/login',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,user:{...data.user,id:'rotated-household-login'}}});});
 await signIn(page);await page.getByRole('button',{name:'Add an entry',exact:true}).click();await expect(page.getByRole('textbox',{name:/^Notes/})).toHaveValue('');
});

test('session expiry stops recording and a failed logout remains visible',async({page})=>{
 await page.addInitScript(()=>{(window as any).stopped=0;Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{const context=new AudioContext();await context.resume();const oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();const stream=destination.stream;(window as any).authMicrophone=stream;return stream;}}});});
 await page.goto('/');await signIn(page);await settings(page);await page.getByRole('dialog').getByRole('button',{name:'Assistant',exact:true}).click();await page.getByRole('button',{name:'Record voice',exact:true}).click();await expect(page.locator('.recording-time')).toBeVisible();
 await page.request.post('/api/auth/logout',{data:{}});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>{const tracks=((window as any).authMicrophone as MediaStream).getTracks();return tracks.length>0&&tracks.every(track=>track.readyState==='ended');})).toBe(true);
 await signIn(page);await page.getByRole('button',{name:'Close Assistant',exact:true}).click();await settings(page);
 await page.route('**/api/auth/logout',route=>route.fulfill({status:503,json:{error:'Logout failed. Try again.'}}));await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Logout failed. Try again.');await expect(page.getByRole('dialog')).toBeVisible();
});
