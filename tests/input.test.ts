import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTemperature,endAfterFifteenMinutes,parseTimeAmount,timeAgo,shiftedTime} from '../src/client/input.ts';

test('custom time amounts accept hours and minutes without accepting partial numeric text',()=>{
 for(const [hours,minutes,total] of [['0','15',15],['1','30',90],[' 2 ',' 5 ',125],['168','0',10080]] as const)assert.equal(parseTimeAmount(hours,minutes),total);
 for(const [hours,minutes] of [['','15'],['0',''],['0','0'],['1','60'],['-1','10'],['1.5','0'],['1e2','0'],['0','1,5'],['168','1']])assert.throws(()=>parseTimeAmount(hours,minutes));
});

test('ago uses the supplied instant across midnight, year boundaries, and both clock changes',()=>{
 for(const [now,minutes,iso,local] of [
  ['2026-11-09T14:30:17.123Z',15,'2026-11-09T14:15:17.123Z','2026-11-09T15:15'],
  ['2026-11-08T23:05:17.123Z',15,'2026-11-08T22:50:17.123Z','2026-11-08T23:50'],
  ['2027-01-01T00:05:00Z',90,'2026-12-31T22:35:00.000Z','2026-12-31T23:35'],
  ['2026-03-29T01:05:00Z',15,'2026-03-29T00:50:00.000Z','2026-03-29T01:50'],
  ['2026-10-25T01:05:17.123Z',15,'2026-10-25T00:50:17.123Z','2026-10-25T02:50']
 ] as const)assert.deepEqual(timeAgo(minutes,Date.parse(now)),{iso,local});
 assert.equal(timeAgo(0,Date.parse('2026-10-25T00:55:17.123Z')).iso,'2026-10-25T00:55:17.123Z');
 for(const minutes of [-1,1.5,10081,Infinity])assert.throws(()=>timeAgo(minutes));
});

test('duration can calculate either endpoint and preserves the exact anchor occurrence',()=>{
 assert.deepEqual(shiftedTime(-90,'2026-11-09T00:30'),{iso:'2026-11-08T22:00:00.000Z',local:'2026-11-08T23:00'});
 assert.deepEqual(shiftedTime(-15,'2026-03-29T03:05'),{iso:'2026-03-29T00:50:00.000Z',local:'2026-03-29T01:50'});
 assert.deepEqual(shiftedTime(-15,'2026-10-25T02:10','2026-10-25T01:10:17.123Z'),{iso:'2026-10-25T00:55:17.123Z',local:'2026-10-25T02:55'});
 assert.throws(()=>shiftedTime(15,'2026-03-29T02:30'));
 assert.throws(()=>shiftedTime(1.5,'2026-11-09T15:00'));
});

test('temperature accepts either decimal separator and optional empty values',()=>{
 for(const input of ['36.7','36,7',' 36,7 '])assert.equal(parseTemperature(input),36.7);
 for(const input of ['', '  '])assert.equal(parseTemperature(input),null);
 for(const value of [20,50,36.75])assert.equal(parseTemperature(String(value)),value);
});

test('15-minute end uses elapsed time across midnight, year boundaries, and clock changes',()=>{
 for(const [start,original,iso,local] of [
  ['2026-11-07T13:10',undefined,'2026-11-07T12:25:00.000Z','2026-11-07T13:25'],
  ['2026-11-07T23:55',undefined,'2026-11-07T23:10:00.000Z','2026-11-08T00:10'],
  ['2026-12-31T23:55',undefined,'2026-12-31T23:10:00.000Z','2027-01-01T00:10'],
  ['2028-02-28T23:55',undefined,'2028-02-28T23:10:00.000Z','2028-02-29T00:10'],
  ['2026-03-29T01:55',undefined,'2026-03-29T01:10:00.000Z','2026-03-29T03:10'],
  ['2026-10-25T02:55','2026-10-25T00:55:17.123Z','2026-10-25T01:10:17.123Z','2026-10-25T02:10'],
  ['2026-10-25T02:55','2026-10-25T01:55:17.123Z','2026-10-25T02:10:17.123Z','2026-10-25T03:10'],
  ['2026-11-07T13:10','2026-11-07T12:10:42.456Z','2026-11-07T12:25:42.456Z','2026-11-07T13:25'],
  ['2026-11-07T13:11','2026-11-07T12:10:42.456Z','2026-11-07T12:26:00.000Z','2026-11-07T13:26'],
 ] as const)assert.deepEqual(endAfterFifteenMinutes(start,original),{iso,local});
});

test('15-minute end stays unavailable for missing, invalid, and nonexistent start times',()=>{
 for(const value of ['', 'bad','2026-02-30T12:00','2026-11-07T25:00','2026-03-29T02:30'])assert.equal(endAfterFifteenMinutes(value),null);
});

test('temperature rejects malformed and out of range values before serialization',()=>{
 for(const input of ['19.9','50,1','NaN','Infinity','3e1','0x24','36 C','36,7.2','36,,7','36.','36,','-36','36 7']){
  assert.throws(()=>parseTemperature(input),/Enter a temperature/);
 }
});

test('last end uses the latest past endpoint across dates and excludes the edited record',async()=>{
 const {lastActivityEnd}=await import('../src/client/input.ts');
 const entries=[
  {id:'later-start',endAt:null},
  {id:'latest-end',endAt:'2026-10-25T01:10:17.123Z'},
  {id:'edited',endAt:'2026-10-25T02:00:00Z'},
  {id:'future',endAt:'2026-10-26T02:00:00Z'},
  {id:'earlier-end',endAt:'2026-10-25T00:55:42.456Z'}
 ];
 const now=Date.parse('2026-10-25T03:00:00Z');
 assert.deepEqual(lastActivityEnd(entries,'edited',now),{iso:'2026-10-25T01:10:17.123Z',local:'2026-10-25T02:10'});
 assert.deepEqual(lastActivityEnd([...entries].reverse(),'edited',now),lastActivityEnd(entries,'edited',now));
 assert.equal(lastActivityEnd([],undefined,now),null);
 assert.equal(lastActivityEnd([{id:'active',endAt:null},{id:'future',endAt:'2027-01-01T00:00:00Z'}],undefined,now),null);
});
