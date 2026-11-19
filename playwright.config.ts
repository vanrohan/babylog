import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./browser',fullyParallel:false,workers:1,timeout:30_000,
 use:{baseURL:'http://127.0.0.1:3006',screenshot:'only-on-failure',trace:'retain-on-failure'},
 projects:[
  {name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:1000}}},
  {name:'phone',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  {name:'ipad',use:{channel:'chrome',viewport:{width:820,height:1180},isMobile:true,hasTouch:true}},
  {name:'webkit-phone',testMatch:['assistant-availability.spec.ts','save-reliability.spec.ts','entry-validation.spec.ts','diary-refresh.spec.ts','progress.spec.ts','auth.spec.ts','entry-undo.spec.ts','dense-care.spec.ts','chat-time-flow.spec.ts','mobile-layout.spec.ts','recording.spec.ts','entry-time.spec.ts','time-helpers.spec.ts','entry-rollers.spec.ts','static-release.spec.ts'],use:{browserName:'webkit',viewport:{width:390,height:844},isMobile:true,hasTouch:true}}
 ],
 webServer:{command:'npm run build && node --import tsx browser/server.ts',url:'http://127.0.0.1:3006/api/health',reuseExistingServer:false}
});
