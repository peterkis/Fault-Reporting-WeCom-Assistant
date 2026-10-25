import {crc32} from 'node:zlib';
import type {H5MediaKind} from '../../../contracts/yxx_h5_media_contracts.js';
export const H5_MEDIA_LIMITS=Object.freeze({VOICE:5*1024*1024,IMAGE:10*1024*1024,VIDEO:20*1024*1024,total:40*1024*1024,duration:60_000,count:8,unbound:16,ttl:24*60*60*1000,deadline:60_000,chunk:64*1024,thumbnail:160*1024,playableVideo:8*1024*1024,plaintext:32*1024*1024,readLeases:2,waiting:8});
export class H5MediaError extends Error {constructor(public code:string,public status=400){super(code);this.name='H5MediaError';}}
export function mediaFail(code:string,status=400):never {throw new H5MediaError(code,status);}
export function mediaUuid(value:unknown):string {if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))mediaFail('YXX_MEDIA_INPUT_INVALID');return value.toLowerCase();}
export function supportedMedia(kind:H5MediaKind,mime:string):boolean {return kind==='IMAGE'?['image/jpeg','image/png','image/webp'].includes(mime):kind==='VOICE'?['audio/amr','audio/wav','audio/mp4','audio/webm','audio/ogg','audio/mpeg'].includes(mime):['video/mp4','video/webm','video/quicktime'].includes(mime);}
function png(bytes:Buffer):boolean {
 if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
 let at=8,idat=false,header=false;
 for(let n=0;n<1024&&at+12<=bytes.length;n++){
  const size=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+size+12;
  if(end>bytes.length||!/^\w{4}$/u.test(type)||crc32(bytes.subarray(at+4,at+size+8))!==bytes.readUInt32BE(at+size+8))return false;
  if(!header){if(type!=='IHDR'||size!==13)return false;const w=bytes.readUInt32BE(at+8),h=bytes.readUInt32BE(at+12);if(!w||!h||w>8192||h>8192||w*h>16_777_216)return false;header=true;}
  if(type==='IDAT')idat=true;if(type==='IEND')return size===0&&idat&&end===bytes.length;at=end;
 }return false;
}
function jpeg(bytes:Buffer):boolean {
 if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)return false;let at=2,frame=false,scan=false;
 for(let n=0;n<4096&&at<bytes.length;n++){
  if(bytes[at++]!==255)return false;while(bytes[at]===255)at++;const marker=bytes[at++];
  if(marker===217)return frame&&scan&&at===bytes.length;if(marker===undefined||at+2>bytes.length)return false;
  const size=bytes.readUInt16BE(at),end=at+size;if(size<2||end>bytes.length)return false;
  if([192,193,194].includes(marker)){if(size<8)return false;const h=bytes.readUInt16BE(at+3),w=bytes.readUInt16BE(at+5);if(!h||!w||w>8192||h>8192||w*h>16_777_216)return false;frame=true;}
  else if(marker===218){if(!frame)return false;at=end;const start=at;while(at<bytes.length){if(bytes[at]!==255){at++;continue;}const next=bytes[at+1];if(next===0||next!==undefined&&next>=208&&next<=215){at+=2;continue;}break;}if(at===start)return false;scan=true;continue;}
  else if(![196,219,221,254].includes(marker)&&!(marker>=224&&marker<=239))return false;at=end;
 }return false;
}
/** Checks the declared container before storage; FFmpeg independently validates playable copies. */
export function inspectMedia(bytes:Buffer,kind:H5MediaKind,mime:string):number|null {
 if(!supportedMedia(kind,mime)||!bytes.length||bytes.length>H5_MEDIA_LIMITS[kind])mediaFail('YXX_MEDIA_FORMAT_INVALID',422);
 if(mime==='image/png'){if(!png(bytes))mediaFail('YXX_MEDIA_FORMAT_INVALID',422);return null;}
 if(mime==='image/jpeg'){if(!jpeg(bytes))mediaFail('YXX_MEDIA_FORMAT_INVALID',422);return null;}
 if(mime==='image/webp'){
  if(bytes.length<30||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);const type=bytes.toString('ascii',12,16),size=bytes.readUInt32LE(16);let w=0,h=0;
  if(size+20>bytes.length)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);
  if(type==='VP8X'&&size>=10){w=bytes.readUIntLE(24,3)+1;h=bytes.readUIntLE(27,3)+1;}
  else if(type==='VP8L'&&size>=5&&bytes[20]===47){const bits=bytes.readUInt32LE(21);w=(bits&0x3fff)+1;h=((bits>>>14)&0x3fff)+1;}
  else if(type==='VP8 '&&size>=10&&bytes.subarray(23,26).equals(Buffer.from([157,1,42]))){w=bytes.readUInt16LE(26)&0x3fff;h=bytes.readUInt16LE(28)&0x3fff;}
  if(!w||!h||w>8192||h>8192||w*h>16_777_216)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);return null;
 }
 if(mime==='audio/amr'){
  const wide=bytes.toString('ascii',0,9)==='#!AMR-WB\n',header=wide?9:6;if(!wide&&bytes.toString('ascii',0,6)!=='#!AMR\n')mediaFail('YXX_MEDIA_FORMAT_INVALID',422);
  const sizes=wide?[18,24,33,37,41,47,51,59,61,6,0,0,0,0,0,1]:[13,14,16,18,20,21,27,32,6,0,0,0,0,0,0,1];let at=header,frames=0;
  while(at<bytes.length){const frame=bytes[at];if(frame===undefined||(frame&0x83)!==0)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);const size=sizes[(frame>>3)&15]??0;if(!size||at+size>bytes.length)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);at+=size;frames++;}
  if(!frames)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);const duration=frames*20;if(duration>H5_MEDIA_LIMITS.duration)mediaFail('YXX_MEDIA_DURATION_EXCEEDED',422);return duration;
 }
 if(mime==='audio/wav'){
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);
  let at=12,rate=0,length=0,alignment=0;for(let n=0;n<1024&&at+8<=bytes.length;n++){const size=bytes.readUInt32LE(at+4),end=at+8+size;if(end>bytes.length)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);const type=bytes.toString('ascii',at,at+4);if(type==='fmt '&&size>=16){const channels=bytes.readUInt16LE(at+10),sampleRate=bytes.readUInt32LE(at+12),bits=bytes.readUInt16LE(at+22);alignment=bytes.readUInt16LE(at+20);rate=bytes.readUInt32LE(at+16);if(bytes.readUInt16LE(at+8)!==1||![1,2].includes(channels)||sampleRate<8000||sampleRate>96000||![8,16,24,32].includes(bits)||alignment!==channels*bits/8||rate!==sampleRate*alignment)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);}if(type==='data')length+=size;at=end+(size&1);}
  if(!rate||!length||!alignment||length%alignment)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);const duration=Math.ceil(length/rate*1000);if(duration>H5_MEDIA_LIMITS.duration)mediaFail('YXX_MEDIA_DURATION_EXCEEDED',422);return duration;
 }
 if(['video/mp4','video/quicktime','audio/mp4'].includes(mime)){if(bytes.length<24||bytes.toString('ascii',4,8)!=='ftyp'||bytes.readUInt32BE(0)<16||bytes.readUInt32BE(0)>bytes.length)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);return null;}
 if(mime.endsWith('/webm')){if(bytes.length<16||bytes.readUInt32BE(0)!==0x1a45dfa3)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);return null;}
 if(mime==='audio/ogg'){if(bytes.length<32||bytes.toString('ascii',0,4)!=='OggS')mediaFail('YXX_MEDIA_FORMAT_INVALID',422);return null;}
 if(mime==='audio/mpeg'){if(bytes.length<16||!(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&((bytes[1]??0)&224)===224))mediaFail('YXX_MEDIA_FORMAT_INVALID',422);return null;}
 mediaFail('YXX_MEDIA_FORMAT_INVALID',422);
}
