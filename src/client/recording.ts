export function recordingWav(chunks:Float32Array[],sampleRate:number){
 const frames=chunks.reduce((sum,chunk)=>sum+chunk.length,0),input=new Float32Array(frames);
 let offset=0;for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
 const rate=16000,count=Math.floor(frames*rate/sampleRate),wav=new ArrayBuffer(44+count*2),view=new DataView(wav);
 const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
 view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
 for(let i=0;i<count;i++){
  const from=Math.floor(i*sampleRate/rate),to=Math.min(frames,Math.max(from+1,Math.floor((i+1)*sampleRate/rate)));
  let value=0;for(let j=from;j<to;j++)value+=input[j]/(to-from);
  value=Math.max(-1,Math.min(1,value));view.setInt16(44+i*2,Math.round(value*(value<0?32768:32767)),true);
 }
 return new Blob([wav],{type:'audio/wav'});
}

export function microphoneLevel(samples:Float32Array){
 let peak=0,sum=0;
 for(const value of samples){peak=Math.max(peak,Math.abs(value));sum+=value*value;}
 const rms=Math.sqrt(sum/Math.max(1,samples.length));
 return {peak,rms,active:rms>=0.003};
}
export interface CaptureInfo {durationMs:number;chunks:number;mimeType:string;capture:string;sampleRate:number;frames:number;peak:number;rms:number;signalMs:number}
export class PcmRecording {
 state:'inactive'|'recording'|'stopping'='inactive';
 private node?:AudioWorkletNode;private source?:MediaStreamAudioSourceNode;
 private chunks:Float32Array[]=[];private frames=0;private peak=0;private signalFrames=0;private squares=0;private began=0;private lastFrame=0;
 private timer?:ReturnType<typeof setInterval>;private flushTimer?:ReturnType<typeof setTimeout>;
 private disposed=false;private ready?:()=>void;private failure='';private stoppedAt=0;
 private rejectStart?:(error:Error)=>void;
 onstop?:(blob:Blob,info:CaptureInfo,error:string)=>void;
 onlevel?:(active:boolean)=>void;
 constructor(private stream:MediaStream,private context=new AudioContext()){}
 private interrupt=()=>{this.stop('Recording was interrupted. It can omit words. Play it back and record again.');};
 private visibility=()=>{if(document.hidden)this.interrupt();};
 async start(){
  let startupTimer:ReturnType<typeof setTimeout>|undefined;
  const cancelled=new Promise<never>((_,reject)=>{
   this.rejectStart=reject;startupTimer=setTimeout(()=>reject(new Error('Microphone startup timed out. Record again.')),8000);
  });
  try{await Promise.race([this.open(),cancelled]);}
  catch(error){this.cancel();throw error;}
  finally{clearTimeout(startupTimer);this.rejectStart=undefined;}
 }
 private async open(){
   await this.context.resume();
   if(this.disposed)throw new Error('Recording cancelled.');
   await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js?no-inline',import.meta.url).href);
   if(this.disposed)throw new Error('Recording cancelled.');
   if(this.context.state!=='running')throw new Error('The microphone did not start. Record again.');
   this.node=new AudioWorkletNode(this.context,'babylog-pcm');this.source=this.context.createMediaStreamSource(this.stream);
   this.node.port.onmessage=event=>{
    if(this.disposed)return;
    if(event.data.done){this.finish();return;}
    const samples=event.data as Float32Array;
    this.chunks.push(samples);this.frames+=samples.length;this.lastFrame=performance.now();
    const level=microphoneLevel(samples);this.peak=Math.max(this.peak,level.peak);this.squares+=level.rms*level.rms*samples.length;
    if(level.active)this.signalFrames+=samples.length;
    this.onlevel?.(level.active);this.ready?.();this.ready=undefined;
   };
   this.node.onprocessorerror=this.interrupt;
   const firstFrame=new Promise<void>((resolve,reject)=>{
    this.ready=resolve;
    this.flushTimer=setTimeout(()=>reject(new Error('No microphone audio arrived. Record again.')),5000);
   });
   this.began=performance.now();this.lastFrame=this.began;this.state='recording';
   this.source.connect(this.node);this.node.connect(this.context.destination);
   await firstFrame;clearTimeout(this.flushTimer);
   if(this.disposed)throw new Error('Recording cancelled.');
   for(const track of this.stream.getTracks()){
    track.addEventListener('mute',this.interrupt);track.addEventListener('ended',this.interrupt);
    if(track.muted||track.readyState==='ended')throw new Error('The microphone is unavailable. Record again.');
   }
   document.addEventListener('visibilitychange',this.visibility);
   this.context.onstatechange=()=>{if(this.state==='recording'&&this.context.state!=='running')this.interrupt();};
   this.timer=setInterval(()=>{
    if(performance.now()-this.lastFrame>2000)this.interrupt();
    else if(performance.now()-this.began>=120000)this.stop();
   },250);
 }
 stop(error=''){
  if(this.state!=='recording'||this.disposed)return;
  this.state='stopping';this.stoppedAt=performance.now();this.failure=error;
  clearInterval(this.timer);this.node?.port.postMessage({stop:true});
  this.flushTimer=setTimeout(()=>{this.failure||='The recording could not finish. It can omit words. Record again.';this.finish();},1500);
 }
 private finish(){
  if(this.disposed)return;
  const durationMs=Math.min(120000,(this.stoppedAt||performance.now())-this.began);
  const signalMs=this.signalFrames/this.context.sampleRate*1000,rms=Math.sqrt(this.squares/Math.max(1,this.frames));
  const info={durationMs,chunks:this.chunks.length,mimeType:'audio/wav',capture:'pcm-worklet',sampleRate:this.context.sampleRate,frames:this.frames,peak:this.peak,rms,signalMs};
  const blob=recordingWav(this.chunks,this.context.sampleRate);
  const error=this.failure||(signalMs<200||rms<0.003?(this.peak<0.0005?'No microphone signal was recorded.':'Recording level is low.')+' Play it back, then record again or retry transcription.':'');
  this.cancel();this.onstop?.(blob,info,error);
 }
 cancel(){
  if(this.disposed)return;
  this.disposed=true;this.state='inactive';clearInterval(this.timer);clearTimeout(this.flushTimer);
  this.rejectStart?.(new Error('Recording cancelled.'));
  document.removeEventListener('visibilitychange',this.visibility);this.context.onstatechange=null;
  for(const track of this.stream.getTracks()){
   track.removeEventListener('mute',this.interrupt);track.removeEventListener('ended',this.interrupt);track.stop();
  }
  this.source?.disconnect();this.node?.disconnect();this.node?.port.close();void this.context.close().catch(()=>{});
 }
}
