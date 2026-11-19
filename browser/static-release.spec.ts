import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import express from 'express';
import {createApp} from '../src/server/app.ts';
import {createTestDiary,testAuth} from '../tests/test-diary.ts';
import {config} from '../src/server/settings.ts';
import {archivePublicAssets,mergePublicAssets} from '../scripts/lib/public-assets.ts';

test.use({serviceWorkers:'allow'});
async function deployment(){
 const directory=mkdtempSync(join(tmpdir(),'babylog-static-browser-')),oldDirectory=join(directory,'old'),newDirectory=join(directory,'current'),archive=join(directory,'archive');
 let fixture:Awaited<ReturnType<typeof createTestDiary>>|undefined,server:ReturnType<typeof createServer>|undefined;
 const close=async()=>{
  try{
   if(server?.listening){const active=server;await new Promise<void>((resolve,reject)=>{active.close(error=>error?reject(error):resolve());active.closeAllConnections();});}
  }finally{
   try{await fixture?.close();}finally{rmSync(directory,{recursive:true,force:true});}
  }
 };
 try{
 mkdirSync(join(oldDirectory,'assets'),{recursive:true});cpSync(resolve('dist'),newDirectory,{recursive:true});
 const current=readFileSync(join(newDirectory,'index.html'),'utf8');
 const previous='<!doctype html><html><head><link rel="stylesheet" href="/assets/index-previous1.css"></head><body><h1>Previous release</h1><button id="lazy">Open previous feature</button><p id="feature"></p><script type="module" src="/assets/index-previous1.js"></script></body></html>';
 const size=Math.max(Buffer.byteLength(current),Buffer.byteLength(previous))+32;
 const oldHtml=previous.padEnd(size,' '),newHtml=current.padEnd(size,' ');expect(Buffer.byteLength(oldHtml)).toBe(Buffer.byteLength(newHtml));
 const fixed=new Date('2020-01-01T00:00:00.000Z');
 for(const [path,html] of [[oldDirectory,oldHtml],[newDirectory,newHtml]]){writeFileSync(join(path,'index.html'),html);utimesSync(join(path,'index.html'),fixed,fixed);}
 writeFileSync(join(oldDirectory,'sw.js'),readFileSync('public/sw.js'));
 writeFileSync(join(oldDirectory,'assets/index-previous1.css'),'body{font-family:system-ui}button{min-height:44px}');
 writeFileSync(join(oldDirectory,'assets/index-previous1.js'),`document.querySelector('#lazy').addEventListener('click',async()=>{const feature=await import('/assets/lazy-previous1.js');document.querySelector('#feature').textContent=feature.label;});await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;`);
 writeFileSync(join(oldDirectory,'assets/lazy-previous1.js'),`export const label='Previous feature loaded';`);
 let handler=express().use(express.static(oldDirectory));
 const active=createServer((request,response)=>handler(request,response));server=active;active.listen(0,'127.0.0.1');await once(active,'listening');
 const address=active.address();if(!address||typeof address==='string')throw new Error('The static release test server has no port.');
 const origin=`http://127.0.0.1:${address.port}`;
 fixture=await createTestDiary();const {store}=fixture,auth=await testAuth(store,{username:'release-owner',password:'Synthetic release password 123'});
 return {origin,upgrade:async()=>{
  await archivePublicAssets(oldDirectory,archive);await archivePublicAssets(newDirectory,archive);await mergePublicAssets(archive,newDirectory);
  const previous={directory:config.clientDirectory,origin:config.publicOrigin};
  config.clientDirectory=newDirectory;config.publicOrigin='';handler=createApp(store,undefined,auth);
  config.clientDirectory=previous.directory;config.publicOrigin=previous.origin;
 },close};
 }catch(error){await close();throw error;}
}

test('a controlled old worker loads the current sign-in page after a same-size deployment',async({page},info)=>{
 const app=await deployment();
 try{
  await page.goto(app.origin+'/');await expect(page.getByRole('heading',{name:'Previous release'})).toBeVisible();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.reload();
  await expect.poll(()=>page.evaluate(async()=>{const cached=await caches.match(location.origin+'/');return !!cached&&(await cached.text()).includes('Previous release');})).toBe(true);
  const old=await page.request.get(app.origin+'/');const headers=old.headers();expect(headers.etag).toBeTruthy();expect(headers['last-modified']).toBeTruthy();
  await app.upgrade();await page.setExtraHTTPHeaders({'If-None-Match':headers.etag,'If-Modified-Since':headers['last-modified'],'Cache-Control':'max-age=0'});
  await page.goto(app.origin+'/');await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.getByLabel('Username',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Previous release'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('static-update-sign-in.png')});
 }finally{await app.close();}
});

test('an open old page can load its uncached feature after the next deployment',async({page},info)=>{
 const app=await deployment();
 try{
  await page.goto(app.origin+'/');await expect(page.getByRole('heading',{name:'Previous release'})).toBeVisible();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  expect(await page.evaluate(async()=>!!await caches.match(location.origin+'/assets/lazy-previous1.js'))).toBe(false);
  await app.upgrade();
  const request=page.waitForResponse(response=>response.url()===app.origin+'/assets/lazy-previous1.js');
  await page.getByRole('button',{name:'Open previous feature'}).click();const response=await request;
  expect(response.status()).toBe(200);expect(response.headers()['content-type']).toMatch(/(?:java|ecma)script/);
  await expect(page.locator('#feature')).toHaveText('Previous feature loaded');await expect(page.getByRole('heading',{name:'Previous release'})).toBeVisible();
  await page.screenshot({path:info.outputPath('static-update-previous-feature.png')});
 }finally{await app.close();}
});
