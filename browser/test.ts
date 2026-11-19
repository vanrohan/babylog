import {test as base,expect} from '@playwright/test';
export {expect};
export type {Page,Locator} from '@playwright/test';
export const test=base.extend<{signedIn:void}>({
 signedIn:[async({context,request},use)=>{
  const response=await request.post('/api/auth/login',{data:{username:'browser-owner',password:'Synthetic browser password 123'}});
  expect(response.ok()).toBeTruthy();await context.addCookies((await request.storageState()).cookies);await use();
 },{auto:true}]
});

export async function saveEntry(page:import('@playwright/test').Page,name:'Save entry'|'Save changes'='Save entry'){
 const response=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname.startsWith('/api/entry-saves/')&&response.request().method()==='POST';
 });
 await page.getByRole('button',{name,exact:true}).click();
 expect((await response).ok()).toBe(true);
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
}
