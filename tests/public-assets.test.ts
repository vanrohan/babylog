import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {archivePublicAssets,mergePublicAssets} from '../scripts/lib/public-assets.ts';

async function fixture(t:TestContext){
 const directory=await mkdtemp(join(tmpdir(),'babylog-public-assets-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return {directory,archive:join(directory,'archive'),publicDirectory:join(directory,'public')};
}
async function build(directory:string,name:string,files:Record<string,string>){
 const dist=join(directory,name);
 for(const [file,content] of Object.entries(files)){
  const path=join(dist,'assets',file);await mkdir(dirname(path),{recursive:true});await writeFile(path,content);
 }
 await writeFile(join(dist,'index.html'),'<html>'+name+'</html>');
 await writeFile(join(dist,'sw.js'),'service worker '+name);
 return dist;
}
async function contents(directory:string,relative=''):Promise<Record<string,string>>{
 const result:Record<string,string>={};
 for(const item of await readdir(join(directory,relative),{withFileTypes:true})){
  const path=relative?relative+'/'+item.name:item.name;
  if(item.isDirectory())Object.assign(result,await contents(directory,path));
  else result[path]=(await readFile(join(directory,path))).toString();
 }
 return result;
}

test('retained public releases keep complete lazy, CSS, font, and image sets without old HTML',async t=>{
 const {directory,archive,publicDirectory}=await fixture(t);
 const firstFiles={
  'index-ENTRY001.js':"import('./Dashboard-DASH0001.js');",
  'Dashboard-DASH0001.js':"import './Dashboard-STYLE001.css';",
  'Dashboard-STYLE001.css':"@font-face{src:url('./fonts/household-FONT0001.woff2')}body{background:url('./care-IMAGE001.webp')}",
  'index-MAIN0001.css':'body{color:blue}',
  'fonts/household-FONT0001.woff2':'font bytes',
  'care-IMAGE001.webp':'image bytes',
  'pcm-worklet-SHARED01.js':'shared worklet bytes'
 };
 const secondFiles={'index-ENTRY002.js':'new entry','Dashboard-DASH0002.js':'new lazy chunk','index-MAIN0002.css':'new styles','pcm-worklet-SHARED01.js':'shared worklet bytes'};
 const first=await build(directory,'first',firstFiles),second=await build(directory,'second',secondFiles);
 const archived=await archivePublicAssets(first,archive);
 assert.equal(archived.id.length,64);assert.deepEqual(archived.files.sort(),Object.keys(firstFiles).sort());
 assert.equal((await archivePublicAssets(first,archive)).id,archived.id);
 await archivePublicAssets(second,archive);
 await mkdir(publicDirectory,{recursive:true});await writeFile(join(publicDirectory,'index.html'),'fresh HTML');await writeFile(join(publicDirectory,'sw.js'),'fresh worker');
 const merged=await mergePublicAssets(archive,publicDirectory);
 assert.deepEqual(merged,{releases:2,files:10});
 assert.deepEqual(await contents(join(publicDirectory,'assets')),{...firstFiles,...secondFiles});
 assert.equal(await readFile(join(publicDirectory,'index.html'),'utf8'),'fresh HTML');
 assert.equal(await readFile(join(publicDirectory,'sw.js'),'utf8'),'fresh worker');
 const manifest=JSON.parse(await readFile(join(archive,'releases',archived.id,'manifest.json'),'utf8'));
 assert.equal(manifest.id,archived.id);assert.deepEqual(manifest.files.map((file:any)=>file.path).sort(),Object.keys(firstFiles).sort());
});

test('the archive prunes whole releases and keeps the latest five complete sets',async t=>{
 const {directory,archive,publicDirectory}=await fixture(t);
 const ids:string[]=[],expected:Record<string,string>={};
 for(let release=1;release<=7;release++){
  const hash=String(release).padStart(8,'0');
  const files={['index-'+hash+'.js']:'entry '+release,['Lazy-'+hash+'.js']:'lazy '+release,['Lazy-'+hash+'.css']:'styles '+release,'shared-SHARED01.woff2':'same shared font'};
  const result=await archivePublicAssets(await build(directory,'release-'+release,files),archive);ids.push(result.id);
  if(release>=3)Object.assign(expected,files);
 }
 const index=JSON.parse(await readFile(join(archive,'index.json'),'utf8'));
 assert.deepEqual(index.releases,ids.slice(-5));
 assert.deepEqual((await readdir(join(archive,'releases'))).sort(),ids.slice(-5).sort());
 assert.deepEqual(await mergePublicAssets(archive,publicDirectory),{releases:5,files:16});
 assert.deepEqual(await contents(join(publicDirectory,'assets')),expected);
});

test('conflicting hashed filenames refuse archive and merge without overwriting existing bytes',async t=>{
 const {directory,archive,publicDirectory}=await fixture(t);
 const first=await build(directory,'first',{'index-SAME0001.js':'original bytes'});
 const second=await build(directory,'second',{'index-SAME0001.js':'different bytes'});
 const result=await archivePublicAssets(first,archive),before=await readFile(join(archive,'index.json'),'utf8');
 await assert.rejects(archivePublicAssets(second,archive),/filename collision/);
 assert.equal(await readFile(join(archive,'index.json'),'utf8'),before);
 assert.equal(await readFile(join(archive,'releases',result.id,'assets','index-SAME0001.js'),'utf8'),'original bytes');
 await mkdir(join(publicDirectory,'assets'),{recursive:true});await writeFile(join(publicDirectory,'assets','index-SAME0001.js'),'fresh conflicting bytes');
 await assert.rejects(mergePublicAssets(archive,publicDirectory),/filename collision/);
 assert.equal(await readFile(join(publicDirectory,'assets','index-SAME0001.js'),'utf8'),'fresh conflicting bytes');
});

test('private files, service workers, source maps, and symlinks never enter the asset archive',async t=>{
 const {directory,archive,publicDirectory}=await fixture(t);
 const dist=await build(directory,'mixed',{
  'index-PUBLIC01.js':'public code',
  'unhashed.js':'unhashed code',
  'index.html':'old HTML',
  'sw.js':'old worker',
  'service-worker-WORKER01.js':'hashed worker',
  'index-PUBLIC01.js.map':'source map',
  '.env':'private environment',
  'diary-PRIVATE1.database':'private diary',
  'private-PRIVATE1.json':'private data'
 });
 await writeFile(join(dist,'.env'),'server secret');await writeFile(join(dist,'server.js'),'server code');
 await mkdir(join(dist,'data'));await writeFile(join(dist,'data','private.database'),'private database');
 const external=join(directory,'external');await mkdir(external);await writeFile(join(external,'secret-SECRET01.js'),'external private bytes');
 await symlink(join(external,'secret-SECRET01.js'),join(dist,'assets','linked-LINKED01.js'));
 await symlink(external,join(dist,'assets','linked-directory'));
 const result=await archivePublicAssets(dist,archive);
 assert.deepEqual(result.files,['index-PUBLIC01.js']);
 await mergePublicAssets(archive,publicDirectory);
 assert.deepEqual(await contents(join(publicDirectory,'assets')),{'index-PUBLIC01.js':'public code'});
 await symlink(join(dist,'assets'),join(directory,'linked-assets'));
 const linkedDist=join(directory,'linked-dist');await mkdir(linkedDist);await symlink(join(dist,'assets'),join(linkedDist,'assets'));
 await assert.rejects(archivePublicAssets(linkedDist,archive),/real asset directory/);
});

test('changed retained bytes fail validation before another release can be merged',async t=>{
 const {directory,archive,publicDirectory}=await fixture(t);
 const dist=await build(directory,'first',{'index-ENTRY001.js':'original bytes'});
 const result=await archivePublicAssets(dist,archive);
 await writeFile(join(archive,'releases',result.id,'assets','index-ENTRY001.js'),'changed retained bytes');
 await assert.rejects(mergePublicAssets(archive,publicDirectory),/retained public asset changed/);
 const another=await build(directory,'another',{'index-ENTRY002.js':'other bytes'});
 await assert.rejects(archivePublicAssets(another,archive),/retained public asset changed/);
});
