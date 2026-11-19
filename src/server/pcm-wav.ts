import {AppError} from './schema.ts';

export function pcmWavDuration(buffer:Buffer){
 const invalid=()=>{throw new AppError('The recording is incomplete or unsupported. Record again.');};
 if(buffer.length<44||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')return invalid();
 const limit=buffer.readUInt32LE(4)+8;
 if(limit!==buffer.length)return invalid();
 let format=false,dataBytes:number|undefined,offset=12;
 while(offset<limit){
  if(offset+8>limit)return invalid();
  const name=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),start=offset+8,end=start+size;
  if(end>limit||end+(size%2)>limit)return invalid();
  if(name==='fmt '){
   if(format||size<16||buffer.readUInt16LE(start)!==1||buffer.readUInt16LE(start+2)!==1||buffer.readUInt32LE(start+4)!==16000||buffer.readUInt32LE(start+8)!==32000||buffer.readUInt16LE(start+12)!==2||buffer.readUInt16LE(start+14)!==16)return invalid();
   format=true;
  }else if(name==='data'){
   if(dataBytes!==undefined||size%2)return invalid();
   dataBytes=size;
  }
  offset=end+(size%2);
 }
 if(!format||dataBytes===undefined)return invalid();
 return dataBytes/32000;
}
