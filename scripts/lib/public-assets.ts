import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,open,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,join,resolve} from 'node:path';

type Asset={path:string;digest:string;size:number};
type Manifest={version:1;id:string;files:Asset[]};
type ArchiveIndex={version:1;releases:string[]};
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const releaseId=/^[a-f0-9]{64}$/;
const hashedAsset=/^[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|bmp|apng|wasm|wav|mp3|ogg|m4a|mp4|webm)$/;

function assetPath(path:string){
 return path.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))&&hashedAsset.test(basename(path))&&!/^(?:sw|service-worker|serviceworker|workbox)(?:[.-]|$)/i.test(basename(path));
}
async function regularFile(path:string){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{if(!(await file.stat()).isFile())throw new Error(`Expected a regular public asset: ${path}`);return await file.readFile();}
 finally{await file.close();}
}
async function directory(path:string){
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error(`Expected a real asset directory: ${path}`);
}
async function readIndex(archiveDirectory:string):Promise<ArchiveIndex>{
 for(const path of [archiveDirectory,join(archiveDirectory,'releases')]){
  try{await directory(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 let data:Buffer;
 try{data=await regularFile(join(archiveDirectory,'index.json'));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,releases:[]};throw error;}
 const value=JSON.parse(data.toString());
 if(value.version!==1||!Array.isArray(value.releases)||value.releases.some((id:unknown)=>typeof id!=='string'||!releaseId.test(id))||new Set(value.releases).size!==value.releases.length)throw new Error('The public asset archive index is invalid.');
 return value;
}
async function manifests(archiveDirectory:string,index:ArchiveIndex){
 const releases:Manifest[]=[];
 for(const id of index.releases){
  const root=join(archiveDirectory,'releases',id);await directory(root);
  const manifest=JSON.parse((await regularFile(join(root,'manifest.json'))).toString()) as Manifest;
  if(manifest.version!==1||manifest.id!==id||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('A public asset manifest is invalid.');
  const paths=new Set<string>();
  for(const file of manifest.files){
   if(!assetPath(file.path)||!releaseId.test(file.digest)||!Number.isSafeInteger(file.size)||file.size<0||paths.has(file.path))throw new Error('A public asset manifest contains an invalid file.');
   paths.add(file.path);
   const parts=file.path.split('/');
   for(let count=0;count<parts.length;count++)await directory(join(root,'assets',...parts.slice(0,count)));
   const bytes=await regularFile(join(root,'assets',...parts));
   if(bytes.length!==file.size||digest(bytes)!==file.digest)throw new Error(`A retained public asset changed: ${file.path}`);
  }
  if(digest(JSON.stringify(manifest.files))!==id)throw new Error('A public asset manifest digest is invalid.');
  releases.push(manifest);
 }
 return releases;
}
function rejectCollisions(files:Asset[],known:Map<string,string>){
 for(const file of files){
  const previous=known.get(file.path);
  if(previous!==undefined&&previous!==file.digest)throw new Error(`Public asset filename collision: ${file.path}`);
  known.set(file.path,file.digest);
 }
}

export async function archivePublicAssets(distDirectory:string,archiveDirectory='.public-assets',keep=5){
 if(!Number.isInteger(keep)||keep<1||keep>5)throw new Error('Keep between one and five public asset releases.');
 const assetsDirectory=resolve(distDirectory,'assets'),archive=resolve(archiveDirectory);
 if(archive===assetsDirectory||archive.startsWith(assetsDirectory+'/'))throw new Error('Keep the public asset archive outside dist/assets.');
 await directory(assetsDirectory);
 const files:Asset[]=[],contents=new Map<string,Buffer>();
 async function collect(relative:string){
  const path=join(assetsDirectory,relative);
  for(const item of await readdir(path,{withFileTypes:true})){
   const name=relative?relative+'/'+item.name:item.name;
   if(item.isSymbolicLink())continue;
   if(item.isDirectory()){
    if(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.name))await collect(name);
   }else if(item.isFile()&&assetPath(name)){
    const bytes=await regularFile(join(assetsDirectory,...name.split('/')));
    files.push({path:name,digest:digest(bytes),size:bytes.length});contents.set(name,bytes);
   }
  }
 }
 await collect('');files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(!files.length)throw new Error('The build contains no hashed public assets.');
 const index=await readIndex(archive),retained=await manifests(archive,index),known=new Map<string,string>();
 for(const manifest of retained)rejectCollisions(manifest.files,known);
 rejectCollisions(files,known);
 const id=digest(JSON.stringify(files)),target=join(archive,'releases',id);
 await mkdir(join(archive,'releases'),{recursive:true});
 if(!index.releases.includes(id)){
  const staging=join(archive,'releases','.pending-'+randomUUID());
  try{
   for(const file of files){const path=join(staging,'assets',...file.path.split('/'));await mkdir(dirname(path),{recursive:true});await writeFile(path,contents.get(file.path)!,{flag:'wx'});}
   await writeFile(join(staging,'manifest.json'),JSON.stringify({version:1,id,files} satisfies Manifest,null,2)+'\n',{flag:'wx'});
   await rename(staging,target);
  }finally{await rm(staging,{recursive:true,force:true});}
 }
 const recent=[...index.releases.filter(value=>value!==id),id],pruned=recent.slice(0,-keep),releases=recent.slice(-keep);
 const temporary=join(archive,'.index-'+randomUUID()+'.json');
 try{await writeFile(temporary,JSON.stringify({version:1,releases} satisfies ArchiveIndex,null,2)+'\n',{flag:'wx'});await rename(temporary,join(archive,'index.json'));}
 finally{await rm(temporary,{force:true});}
 for(const obsolete of pruned)await rm(join(archive,'releases',obsolete),{recursive:true});
 return {id,files:files.map(file=>file.path),pruned};
}

export async function mergePublicAssets(archiveDirectory:string,publicDirectory:string){
 const archive=resolve(archiveDirectory),index=await readIndex(archive),retained=await manifests(archive,index);
 const known=new Map<string,string>(),sources=new Map<string,string>();
 for(const manifest of retained){
  rejectCollisions(manifest.files,known);
  for(const file of manifest.files)sources.set(file.path,join(archive,'releases',manifest.id,'assets',...file.path.split('/')));
 }
 const publicRoot=resolve(publicDirectory);await mkdir(publicRoot,{recursive:true});await directory(publicRoot);
 const destination=join(publicRoot,'assets');await mkdir(destination,{recursive:true});await directory(destination);
 // A collision must leave the destination unchanged.
 for(const [path,expected] of known){
  const parts=path.split('/');
  for(let count=1;count<parts.length;count++){
   try{await directory(join(destination,...parts.slice(0,count)));}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  try{if(digest(await regularFile(join(destination,...parts)))!==expected)throw new Error(`Public asset filename collision: ${path}`);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 for(const [path,source] of sources){
  const target=join(destination,...path.split('/'));await mkdir(dirname(target),{recursive:true});
  try{await copyFile(source,target,constants.COPYFILE_EXCL);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(digest(await regularFile(target))!==known.get(path))throw new Error(`Public asset filename collision: ${path}`);}
 }
 return {releases:retained.length,files:sources.size};
}
