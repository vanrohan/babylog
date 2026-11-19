import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {recordingWav,PcmRecording} from '../src/client/recording.ts';

test('PCM export preserves duration and final samples across microphone sample rates',async()=>{
 for(const rate of [16000,44100,48000,96000]){
  const first=new Float32Array(rate),last=new Float32Array(rate).fill(.1);
  const wav=Buffer.from(await recordingWav([first,last],rate).arrayBuffer());
  assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.length,44+64000);
  assert.equal(wav.readInt16LE(44),0);assert(wav.readInt16LE(wav.length-2)>3000);
 }
 const full=await recordingWav([new Float32Array(96000*120)],96000).arrayBuffer();assert(full.byteLength<4*1024*1024);
});

test('the worklet flushes its final partial block once and mixes channels without feedback',()=>{
 let Processor:any;const messages:any[]=[];
 class Base{port={onmessage:null as any,postMessage:(data:any)=>messages.push(data)};}
 vm.runInNewContext(readFileSync(new URL('../src/client/pcm-worklet.js',import.meta.url),'utf8'),{
  AudioWorkletProcessor:Base,sampleRate:48000,Float32Array,registerProcessor:(_name:string,type:any)=>{Processor=type;}
 });
 const processor=new Processor();
 processor.process([[new Float32Array(2048).fill(.1),new Float32Array(2048).fill(.3)]]);
 processor.process([[new Float32Array(17).fill(.4)]]);
 processor.port.onmessage();processor.port.onmessage();
 assert.equal(messages.length,3);assert.equal(messages[0].length,2048);assert(Math.abs(messages[0][0]-.2)<.0001);
 assert.equal(messages[1].length,17);assert(Math.abs(messages[1][16]-.4)<.0001);assert.equal(messages[2].done,true);
 assert.equal(processor.process([]),false);
});

test('startup cancellation and a stalled audio context settle and release microphone resources',async t=>{
 const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{removeEventListener(){}}});
 t.after(()=>{if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else delete (globalThis as any).document;});
 let stops=0,closes=0;
 const track={removeEventListener(){},stop(){stops++;}};
 const stream={getTracks:()=>[track]} as unknown as MediaStream;
 const context={resume:()=>new Promise<void>(()=>{}),close:async()=>{closes++;},onstatechange:null} as unknown as AudioContext;
 const cancelled=new PcmRecording(stream,context),pending=cancelled.start();cancelled.cancel();cancelled.cancel();
 await assert.rejects(pending,/cancelled/);assert.equal(stops,1);assert.equal(closes,1);
 t.mock.timers.enable({apis:['setTimeout']});
 const stalled=new PcmRecording(stream,context),opening=stalled.start();
 const rejection=assert.rejects(opening,/startup timed out/);t.mock.timers.tick(8001);await rejection;
 assert.equal(stops,2);assert.equal(closes,2);
});

test('the worklet enforces its frame limit without waiting for a browser timer',()=>{
 let Processor:any;const messages:any[]=[];
 class Base{port={onmessage:null as any,postMessage:(data:any)=>messages.push(data)};}
 vm.runInNewContext(readFileSync(new URL('../src/client/pcm-worklet.js',import.meta.url),'utf8'),{
  AudioWorkletProcessor:Base,sampleRate:1,Float32Array,registerProcessor:(_name:string,type:any)=>{Processor=type;}
 });
 const processor=new Processor();assert.equal(processor.process([[new Float32Array(128).fill(.1)]]),false);
 assert.equal(messages[0].length,120);assert.equal(messages[1].done,true);assert.equal(messages.length,2);
});
