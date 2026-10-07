import type {AttachmentStore,StoredAttachment,AttachmentReason} from '../contracts/workbench_attachment_contracts.js';
import {open,lstat,realpath} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createDecipheriv,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {crc32} from 'node:zlib';
export const ATTACHMENT_MAX_BYTES=10*1024*1024;
export const ATTACHMENT_CHUNK_BYTES=64*1024;
export const ATTACHMENT_DEADLINE_MS=15_000;
export class AttachmentError extends Error {constructor(public code:string,public status=422){super(code);}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function invalid():never {throw new AttachmentError('ATTACHMENT_STORAGE_UNAVAILABLE',503);}
function record(value:unknown):StoredAttachment {
  if(!value||typeof value!=='object'||Array.isArray(value))invalid();
  const r=value as Record<string,unknown>,keys=['ref','source_intake_id','source_message_id','media_ref','mime_type','byte_size','sha256','retention_until_epoch_ms','scan_status','classification'];
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))
    ||typeof r.ref!=='string'||!UUID.test(r.ref)||typeof r.source_intake_id!=='string'||!UUID.test(r.source_intake_id)
    ||typeof r.source_message_id!=='string'||!/^[1-9][0-9]{0,18}$/u.test(r.source_message_id)||BigInt(r.source_message_id)>9223372036854775807n
    ||typeof r.media_ref!=='string'||!/^wmr_[a-f0-9]{32}$/u.test(r.media_ref)||typeof r.mime_type!=='string'||r.mime_type.length>64
    ||typeof r.byte_size!=='number'||!Number.isSafeInteger(r.byte_size)||r.byte_size<=0
    ||typeof r.sha256!=='string'||!/^\w{64}$/u.test(r.sha256)||!/^[a-f0-9]{64}$/u.test(r.sha256)
    ||typeof r.retention_until_epoch_ms!=='string'||!/^[1-9][0-9]{0,15}$/u.test(r.retention_until_epoch_ms)
    ||!['PASSED','PENDING','REJECTED'].includes(String(r.scan_status))||!['INTERNAL','SENSITIVE_INTERNAL','PATIENT_SENSITIVE','SECRET'].includes(String(r.classification)))invalid();
  // Keep canonical AAD order independent of JSON object property order on disk.
  return {ref:r.ref,source_intake_id:r.source_intake_id,source_message_id:r.source_message_id,media_ref:r.media_ref,mime_type:r.mime_type,byte_size:r.byte_size,sha256:r.sha256,
    retention_until_epoch_ms:r.retention_until_epoch_ms,scan_status:r.scan_status as StoredAttachment['scan_status'],classification:r.classification as StoredAttachment['classification']};
}
export function attachmentReason(asset:StoredAttachment,now=Date.now()):AttachmentReason|null {
  if(BigInt(asset.retention_until_epoch_ms)<=BigInt(now))return 'EXPIRED';
  if(asset.byte_size>ATTACHMENT_MAX_BYTES)return 'OVERSIZED';
  if(!['image/png','image/jpeg'].includes(asset.mime_type))return 'UNSUPPORTED';
  if(asset.scan_status!=='PASSED'||!['INTERNAL','SENSITIVE_INTERNAL'].includes(asset.classification))return 'UNTRUSTED';
  return null;
}
function jpegMatches(bytes:Buffer):boolean {
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return false;
  let at=2,frame=false,scan=false,components=0;
  for(let count=0;count<2048&&at<bytes.length;count++){
    if(bytes[at++]!==0xff)return false;while(bytes[at]===0xff)at++;const marker=bytes[at++];
    if(marker===0xd9)return frame&&scan&&at===bytes.length;
    if(marker===undefined||at+2>bytes.length)return false;
    const size=bytes.readUInt16BE(at),end=at+size;if(size<2||end>bytes.length)return false;
    if([0xc0,0xc1,0xc2].includes(marker)){
      if(frame||size<8||bytes[at+2]!==8)return false;const height=bytes.readUInt16BE(at+3),width=bytes.readUInt16BE(at+5);components=bytes[at+7]??0;
      if(!width||!height||width>8192||height>8192||width*height>16_777_216||![1,3,4].includes(components)||size!==8+3*components)return false;frame=true;
    }else if(marker===0xda){
      const selected=bytes[at+2]??0;if(!frame||selected<1||selected>components||size!==6+2*selected)return false;
      const start=bytes[end-3]??255,until=bytes[end-2]??255,approx=bytes[end-1]??255;if(start>until||until>63||(approx>>4)>13||(approx&15)>13)return false;
      at=end;const entropyStart=at;
      while(at<bytes.length){if(bytes[at]!==0xff){at++;continue;}const next=bytes[at+1];if(next===0||next!==undefined&&next>=0xd0&&next<=0xd7){at+=2;continue;}break;}
      if(at===entropyStart)return false;scan=true;continue;
    }else if(![0xc4,0xdb,0xdd,0xfe].includes(marker)&&!(marker>=0xe0&&marker<=0xef))return false;
    at=end;
  }
  return false;
}
function imageMatches(bytes:Buffer,mime:string):boolean {
  if(mime==='image/jpeg')return jpegMatches(bytes);
  if(mime!=='image/png'||bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return false;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>8192||height>8192||width*height>16_777_216)return false;
  let at=8,idat=false;
  for(let count=0;count<1024&&at+12<=bytes.length;count++){
    const size=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8);if(size>ATTACHMENT_MAX_BYTES||at+size+12>bytes.length||!/[A-Za-z]{4}/u.test(type)||crc32(bytes.subarray(at+4,at+size+8))!==bytes.readUInt32BE(at+size+8))return false;
    if(type==='IDAT')idat=true;if(type==='IEND')return size===0&&idat&&at+12===bytes.length;at+=size+12;
  }
  return false;
}
export function createWorkbenchAttachmentStore({root,key}:{root:string;key:Uint8Array}):AttachmentStore {
  if(!root||key.byteLength!==32)invalid();
  const directory=resolve(root),secret=Buffer.from(key);
  let stopped=false,active=0,handles=0,plaintext:Buffer|null=null,stream:Readable|null=null,controller:AbortController|null=null;
  let finished:Promise<void>=Promise.resolve();
  async function safeHandle(name:string,max:number):Promise<FileHandle> {
    // Reject configured junctions too: no ancestor may redirect the private root.
    for(let path=directory;;path=dirname(path)){if((await lstat(path)).isSymbolicLink())invalid();if(dirname(path)===path)break;}
    if(await realpath(directory)!==directory)invalid();
    const path=join(directory,name),before=await lstat(path);
    if(before.size>max)throw new AttachmentError(max===256*1024?'ATTACHMENT_STORAGE_UNAVAILABLE':'ATTACHMENT_OVERSIZED',max===256*1024?503:422);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)invalid();
    const handle=await open(path,'r');handles++;
    try{const after=await handle.stat();if(after.size>max)throw new AttachmentError('ATTACHMENT_OVERSIZED');if(!after.isFile()||after.nlink!==1||after.dev!==before.dev||after.ino!==before.ino||await realpath(path)!==path)invalid();return handle;}
    catch(error){await handle.close();handles--;throw error;}
  }
  async function read(name:string,max:number,signal?:AbortSignal) {
    let handle:FileHandle|undefined;
    try{handle=await safeHandle(name,max);const chunks:Buffer[]=[];let size=0;
      for(;;){signal?.throwIfAborted();const chunk=Buffer.alloc(Math.min(ATTACHMENT_CHUNK_BYTES,max+1-size)),result=await handle.read(chunk,0,chunk.length,null);
        if(!result.bytesRead)break;size+=result.bytesRead;if(size>max)throw new AttachmentError('ATTACHMENT_OVERSIZED');chunks.push(chunk.subarray(0,result.bytesRead));}
      return Buffer.concat(chunks,size);}
    catch(error){if(error instanceof AttachmentError)throw error;if((error as {code?:unknown})?.code==='ENOENT')throw new AttachmentError('ATTACHMENT_MISSING',404);throw new AttachmentError('ATTACHMENT_STORAGE_UNAVAILABLE',503);}
    finally{if(handle){await handle.close();handles--;}}
  }
  async function entries():Promise<readonly StoredAttachment[]> {
    if(stopped)invalid();
    const bytes=await read('manifest.json',256*1024);
    let data:unknown;try{data=JSON.parse(bytes.toString('utf8'));}catch{invalid();}
    if(!data||typeof data!=='object'||Array.isArray(data))invalid();
    const v=data as Record<string,unknown>;if(v.version!==1||Object.keys(v).length!==2||!Array.isArray(v.assets)||v.assets.length>500)invalid();
    const assets=v.assets.map(record);if(new Set(assets.map(a=>a.ref)).size!==assets.length)invalid();return assets;
  }
  return Object.freeze({entries,
    async open(ref:string,signal:AbortSignal) {
      if(stopped)invalid();if(!UUID.test(ref))throw new AttachmentError('ATTACHMENT_NOT_FOUND',404);
      if(active)throw new AttachmentError('ATTACHMENT_BUSY',429);
      active=1;let finish=()=>{},released=false,leaseStream:Readable|null=null;finished=new Promise<void>(r=>{finish=r;});
      const ownController=new AbortController();controller=ownController;
      const combined=AbortSignal.any([signal,ownController.signal]);
      const timer=setTimeout(()=>ownController.abort(new AttachmentError('ATTACHMENT_TIMEOUT',504)),ATTACHMENT_DEADLINE_MS);timer.unref();
      const aborted=()=>{void close();};
      const release=async()=>{if(released)return;released=true;clearTimeout(timer);combined.removeEventListener('abort',aborted);if(plaintext){plaintext.fill(0);plaintext=null;}stream=null;controller=null;active=0;finish();};
      const close=async()=>{if(released)return;leaseStream?.destroy();await release();};
      try{combined.throwIfAborted();const asset=(await entries()).find(a=>a.ref===ref);if(!asset)throw new AttachmentError('ATTACHMENT_NOT_FOUND',404);
        const reason=attachmentReason(asset);if(reason)throw new AttachmentError('ATTACHMENT_'+reason,reason==='EXPIRED'?410:422);
        const encrypted=await read(ref+'.asset',ATTACHMENT_MAX_BYTES+28,combined);combined.throwIfAborted();
        if(encrypted.length!==asset.byte_size+28)throw new AttachmentError('ATTACHMENT_INTEGRITY_FAILED');
        let candidate:Buffer|null=null;
        try{const decipher=createDecipheriv('aes-256-gcm',secret,encrypted.subarray(0,12));decipher.setAuthTag(encrypted.subarray(12,28));decipher.setAAD(Buffer.from(JSON.stringify(asset)));
          candidate=decipher.update(encrypted.subarray(28));const tail=decipher.final();plaintext=tail.length?Buffer.concat([candidate,tail]):candidate;if(tail.length)candidate.fill(0);tail.fill(0);candidate=null;}
        catch{throw new AttachmentError('ATTACHMENT_INTEGRITY_FAILED');}finally{candidate?.fill(0);encrypted.fill(0);}
        if(createHash('sha256').update(plaintext).digest('hex')!==asset.sha256)throw new AttachmentError('ATTACHMENT_INTEGRITY_FAILED');
        if(!imageMatches(plaintext,asset.mime_type))throw new AttachmentError('ATTACHMENT_UNSUPPORTED');
        const bytes=plaintext;
        leaseStream=Readable.from((async function*(){try{for(let at=0;at<bytes.length;at+=ATTACHMENT_CHUNK_BYTES){combined.throwIfAborted();yield Buffer.from(bytes.subarray(at,at+ATTACHMENT_CHUNK_BYTES));}}finally{await release();}})(),{objectMode:false,highWaterMark:ATTACHMENT_CHUNK_BYTES});stream=leaseStream;
        combined.addEventListener('abort',aborted,{once:true});
        return {stream:leaseStream,close};
      }catch(error){await close();throw error;}
    },
    async close(){stopped=true;controller?.abort();stream?.destroy();await finished;secret.fill(0);},
    ownedResourceState:()=>({active,handles,plaintext_bytes:plaintext?.length??0}),
  });
}
