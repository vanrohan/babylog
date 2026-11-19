class BabylogPcm extends AudioWorkletProcessor {
 constructor(){
  super();this.buffer=new Float32Array(2048);this.used=0;this.frames=0;this.finished=false;
  this.port.onmessage=()=>this.finish();
 }
 flush(){
  if(this.used){const samples=this.buffer.slice(0,this.used);this.port.postMessage(samples,[samples.buffer]);this.used=0;}
 }
 finish(){
  if(this.finished)return;
  this.finished=true;this.flush();this.port.postMessage({done:true});
 }
 process(inputs){
  if(this.finished)return false;
  const channels=inputs[0];
  if(!channels?.length)return true;
  for(let i=0;i<channels[0].length;i++){
   let value=0;for(const channel of channels)value+=channel[i]/channels.length;
   this.buffer[this.used++]=value;this.frames++;
   if(this.used===this.buffer.length)this.flush();
   if(this.frames>=sampleRate*120){this.finish();return false;}
  }
  return true;
 }
}
registerProcessor('babylog-pcm',BabylogPcm);
