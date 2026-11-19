import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeDays,rangeFor,shiftDate} from '../src/dashboard.ts';
import type {Entry} from '../src/shared.ts';
const entry=(fields:Partial<Entry>={}):Entry=>({id:'test',activity:'sleep',feedingType:null,startAt:'2026-11-02T22:00:00Z',endAt:'2026-11-03T02:00:00Z',status:'completed',pee:false,poo:false,temperature:null,notes:'',version:1,createdAt:'2026-11-02T22:00:00Z',updatedAt:'2026-11-02T22:00:00Z',...fields});

test('sleep splits at midnight and overlapping records do not inflate totals',()=>{
 const days=summarizeDays([entry(),entry({id:'overlap',startAt:'2026-11-03T00:00:00Z',endAt:'2026-11-03T03:00:00Z'})],'2026-11-02','2026-11-04');
 assert.deepEqual(days.map(d=>d.sleepMinutes),[60,240,0]);
 assert.deepEqual(days.map(d=>d.entries.length),[1,2,0]);
});
test('counts use the start date and preserve flags on custom records',()=>{
 const days=summarizeDays([entry({activity:'breastfeeding'}),entry({id:'n',activity:'nappy',startAt:'2026-11-03T12:00:00Z',endAt:null,pee:true,poo:true}),entry({id:'c',activity:'Bath',startAt:'2026-11-03T13:00:00Z',endAt:null,pee:true})],'2026-11-02','2026-11-03');
 assert.deepEqual(days.map(d=>d.feeds),[1,0]);
 assert.equal(days[1].nappies,1);assert.equal(days[1].pee,2);assert.equal(days[1].poo,1);
});
test('active timers stop at now and untimed completed sleep stays unknown',()=>{
 const [day]=summarizeDays([entry({startAt:'2026-11-03T09:00:00Z',endAt:null,status:'active'}),entry({id:'unknown',startAt:'2026-11-03T12:00:00Z',endAt:null})],'2026-11-03','2026-11-03',new Date('2026-11-03T10:00:00Z'));
 assert.equal(day.sleepMinutes,60);assert.equal(day.active,1);assert.equal(day.untimedSleep,1);
});
test('clock change days retain real durations and valid wall clock segments',()=>{
 for(const [date,start,end,hours] of [['2026-03-29','2026-03-28T23:00:00Z','2026-03-29T22:00:00Z',23],['2026-10-25','2026-10-24T22:00:00Z','2026-10-25T23:00:00Z',25]] as const){
  const [day]=summarizeDays([entry({startAt:start,endAt:end})],date,date);
  assert.equal(day.hours,hours);assert.equal(day.sleepMinutes,hours*60);
  assert(day.marks.every(m=>m.minute>=0&&m.minute+m.duration<=1440&&m.duration>=0));
 }
});
test('midnight end excludes the next day and empty dates remain visible',()=>{
 const days=summarizeDays([entry({endAt:'2026-11-02T23:00:00Z'})],'2026-11-02','2026-11-03');
 assert.equal(days[0].sleepMinutes,60);assert.equal(days[1].entries.length,0);
});
test('week and month ranges follow the calendar and custom ranges validate',()=>{
 assert.deepEqual(rangeFor('week','2026-11-03'),{from:'2026-11-02',to:'2026-11-08'});
 assert.deepEqual(rangeFor('week','2027-01-03'),{from:'2026-12-28',to:'2027-01-03'});
 assert.deepEqual(rangeFor('month','2028-02-15'),{from:'2028-02-01',to:'2028-02-29'});
 assert.equal(summarizeDays([],'2024-01-01','2024-12-31').length,366);
 assert.equal(summarizeDays([],'2026-11-03','2026-11-03').length,1);
 assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
 assert.throws(()=>summarizeDays([],'2026-02-30','2026-03-01'));
 assert.throws(()=>summarizeDays([],'2026-11-04','2026-11-03'));
 assert.throws(()=>summarizeDays([],'2025-01-01','2026-01-02'));
});

test('short clock transition intervals keep real durations and separate wall clock marks',()=>{
 const [autumn]=summarizeDays([entry({startAt:'2026-10-25T00:45:00Z',endAt:'2026-10-25T01:15:00Z'})],'2026-10-25','2026-10-25');
 assert.equal(autumn.sleepMinutes,30);
 assert.deepEqual(autumn.marks.map(m=>[m.minute,m.duration]),[[165,15],[120,15]]);
 const [spring]=summarizeDays([entry({startAt:'2026-03-29T00:45:00Z',endAt:'2026-03-29T01:15:00Z'})],'2026-03-29','2026-03-29');
 assert.equal(spring.sleepMinutes,30);
 assert.deepEqual(spring.marks.map(m=>[m.minute,m.duration]),[[105,15],[180,15]]);
});

test('range clipping shows carried records without counting their starts or findings again',()=>{
 const carried=entry({activity:'breastfeeding',pee:true,poo:true});
 const point=entry({id:'at-start',activity:'nappy',startAt:'2026-11-02T23:00:00Z',endAt:null,pee:true});
 const excluded=entry({id:'at-end',activity:'nappy',startAt:'2026-11-03T23:00:00Z',endAt:null,poo:true});
 const [day]=summarizeDays([carried,point,excluded],'2026-11-03','2026-11-03');
 assert.deepEqual(day.entries.map(e=>e.id),['test','at-start']);
 assert.equal(day.feeds,0);
 assert.equal(day.nappies,1);
 assert.equal(day.pee,1);
 assert.equal(day.poo,0);
 assert(day.marks.some(m=>m.track==='feeding'&&m.minute===0));
});

test('an active sleep splits across midnight and includes only elapsed time',()=>{
 const days=summarizeDays([entry({startAt:'2026-11-02T22:30:00Z',endAt:null,status:'active'})],'2026-11-02','2026-11-04',new Date('2026-11-03T00:30:00Z'));
 assert.deepEqual(days.map(d=>d.sleepMinutes),[30,90,0]);
 assert.deepEqual(days.map(d=>d.active),[1,1,0]);
 assert.equal(days[2].entries.length,0);
});

test('renaming and deleting a record recomputes activity totals and tracks',()=>{
 const original=entry({startAt:'2026-11-03T09:00:00Z',endAt:'2026-11-03T10:00:00Z',pee:true});
 const [sleep]=summarizeDays([original],'2026-11-03','2026-11-03');
 assert.equal(sleep.sleepMinutes,60);
 const [renamed]=summarizeDays([{...original,activity:'Bath'}],'2026-11-03','2026-11-03');
 assert.equal(renamed.sleepMinutes,0);
 assert.equal(renamed.pee,1);
 assert(renamed.marks.every(m=>m.track==='other'));
 const [deleted]=summarizeDays([],'2026-11-03','2026-11-03');
 assert.equal(deleted.entries.length,0);
 assert.equal(deleted.pee,0);
 assert.equal(deleted.sleepMinutes,0);
});

test('bath events have a separate track with optional durations',()=>{
 const [day]=summarizeDays([
  entry({id:'point-bath',activity:'bath',startAt:'2026-11-03T14:00:00Z',endAt:null}),
  entry({id:'timed-bath',activity:'bath',startAt:'2026-11-03T15:00:00Z',endAt:'2026-11-03T15:20:00Z'})
 ],'2026-11-03','2026-11-03');
 assert.equal(day.entries.length,2);
 assert.deepEqual(day.marks.map(m=>[m.track,m.duration]),[['bath',0],['bath',20]]);
 assert.equal(day.sleepMinutes,0);assert.equal(day.feeds,0);assert.equal(day.nappies,0);
});

test('zoom preserves the range center and keeps inclusive bounds',async()=>{
 const {zoomRange}=await import('../src/dashboard.ts');
 assert.deepEqual(zoomRange('2026-11-01','2026-11-14',0.5),{from:'2026-11-04',to:'2026-11-10'});
 assert.deepEqual(zoomRange('2026-11-03','2026-11-03',0.5),{from:'2026-11-03',to:'2026-11-03'});
 assert.equal(summarizeDays([], ...Object.values(zoomRange('2026-01-01','2026-12-31',2)) as [string,string]).length,366);
 assert.throws(()=>zoomRange('2026-11-04','2026-11-03',2));
});

test('start density wraps midnight, normalizes each activity, and excludes carried starts',async()=>{
 const {startDensity}=await import('../src/dashboard.ts');
 const midnight=entry({id:'midnight',activity:'breastfeeding',startAt:'2026-11-02T23:00:00Z',endAt:null});
 const old=entry({id:'old',startAt:'2026-11-02T20:00:00Z',endAt:'2026-11-03T02:00:00Z'});
 const rows=[midnight,midnight,old,entry({id:'custom',activity:'walk',startAt:'2026-11-03T12:00:00Z',endAt:null})];
 const groups=startDensity(rows,'2026-11-03','2026-11-03',60);
 assert.deepEqual(groups.map(g=>[g.track,g.count]),[['feeding',1],['other',1]]);
 const points=groups[0].points;
 assert.equal(points[0][1],points.at(-1)![1]);assert(points[1][1]>points[36][1]);
 const area=points.slice(1).reduce((s,p,i)=>s+(p[1]+points[i][1])/2*10/60,0);
 assert(Math.abs(area-100)<0.01);
 assert.deepEqual(startDensity([],'2026-11-03','2026-11-03'),[]);
 assert.throws(()=>startDensity(rows,'2026-11-03','2026-11-03',0));
 const edited=startDensity([{...midnight,activity:'bath',startAt:'2026-11-03T11:00:00Z'}],'2026-11-03','2026-11-03');
 assert.equal(edited[0].track,'bath');assert(edited[0].points[72][1]>edited[0].points[0][1]);
});

test('feeding combines breast and syringe entries without changing types or counting carried starts twice',async()=>{
 const {trackFor,startDensity}=await import('../src/dashboard.ts');
 const rows=[
  entry({id:'breast',activity:'feeding',feedingType:'Breast'}),
  entry({id:'syringe',activity:'feeding',feedingType:'Syringe',startAt:'2026-11-03T09:00:00Z',endAt:null,notes:'Formula, 20 ml.'}),
  entry({id:'spaced',activity:'breast feeding',startAt:'2026-11-03T10:00:00Z',endAt:null}),
  entry({id:'custom',activity:'feeding advice',startAt:'2026-11-03T11:00:00Z',endAt:null})
 ];
 const original=structuredClone(rows);const days=summarizeDays(rows,'2026-11-02','2026-11-03');
 assert.deepEqual(days.map(day=>day.feeds),[1,2]);
 assert(days[1].marks.filter(mark=>mark.id!=='custom').every(mark=>mark.track==='feeding'));
 assert.equal(trackFor('feeding advice'),'other');assert.equal(trackFor(' Syringe Feeding '),'feeding');
 assert.deepEqual(startDensity(rows,'2026-11-03','2026-11-03').map(group=>[group.track,group.count]),[['feeding',2],['other',1]]);
 const corrected=rows.map(row=>row.id==='breast'?{...row,feedingType:'Bottle'}:row);
 assert.deepEqual(summarizeDays(corrected,'2026-11-02','2026-11-03').map(day=>day.feeds),[1,2]);
 assert.deepEqual(startDensity(corrected,'2026-11-02','2026-11-03'),startDensity(rows,'2026-11-02','2026-11-03'));
 assert.equal(corrected[0].feedingType,'Bottle');assert.equal(rows[0].feedingType,'Breast');
 const renamed=rows.map(row=>row.id==='syringe'?{...row,activity:'walk'}:row);
 assert.equal(summarizeDays(renamed,'2026-11-03','2026-11-03')[0].feeds,1);
 assert.deepEqual(rows,original);
});
