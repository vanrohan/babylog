import {cp,mkdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {archivePublicAssets,mergePublicAssets} from './lib/public-assets.ts';

await archivePublicAssets('dist');
await rm('.prisma-build',{recursive:true,force:true});
await mkdir('.prisma-build',{recursive:true});
const build=spawnSync('bun',['build','src/server/compute.ts','--target=bun','--outdir','.prisma-build','--entry-naming','server.js'],{stdio:'inherit'});
if(build.status!==0)throw new Error('Cloud server build failed.');
await cp('dist','.prisma-build/public',{recursive:true});
const retained=await mergePublicAssets('.public-assets','.prisma-build/public');
console.log(`Public assets: ${retained.files} files across ${retained.releases} releases.`);
