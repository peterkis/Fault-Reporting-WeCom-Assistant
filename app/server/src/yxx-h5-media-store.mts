import {open,lstat,realpath,unlink} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {H5MediaObject,H5MediaPrivateStore,H5MediaVariant} from '../../../contracts/yxx_h5_media_contracts.js';
import {H5_MEDIA_LIMITS,H5MediaError,mediaFail,mediaUuid} from './yxx-h5-media-format.mjs';

export function createYxxH5MediaPrivateStore({root,key}:{root:string;key:Uint8Array}):H5MediaPrivateStore {
 if(typeof root!=='string'||!root||key.byteLength!==32)mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);
 const directory=resolve(root),secret=Buffer.from(key);let stopped=false,active=0,handles=0,plaintext:Buffer|null=null;
 let settled:Promise<void>=Promise.resolve();let finish=()=>{};
 const name=(ref:string,variant:H5MediaVariant)=>join(directory,mediaUuid(ref)+'.'+({ORIGINAL:'original',PLAYABLE:'playable',THUMBNAIL:'thumbnail'} satisfies Record<H5MediaVariant,string>)[variant]+'.asset');
 async function safeRoot(){for(let p=directory;;p=dirname(p)){const s=await lstat(p);if(s.isSymbolicLink()||!s.isDirectory())mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);if(dirname(p)===p)break;}if(await realpath(directory)!==directory)mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);}
 function check(asset:H5MediaObject){mediaUuid(asset.media_ref);if(!['ORIGINAL','PLAYABLE','THUMBNAIL'].includes(asset.variant)||!['VOICE','IMAGE','VIDEO'].includes(asset.kind)||!Number.isSafeInteger(asset.byte_size)||asset.byte_size<1||asset.byte_size>(asset.variant==='THUMBNAIL'?H5_MEDIA_LIMITS.thumbnail:H5_MEDIA_LIMITS[asset.kind])||asset.variant==='THUMBNAIL'&&(asset.kind!=='IMAGE'||asset.mime_type!=='image/jpeg')||!/^[a-f0-9]{64}$/u.test(asset.sha256)||typeof asset.mime_type!=='string'||asset.mime_type.length>64)mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);}
 function aad(asset:H5MediaObject){return Buffer.from(JSON.stringify({media_ref:asset.media_ref,variant:asset.variant,kind:asset.kind,mime_type:asset.mime_type,byte_size:asset.byte_size,sha256:asset.sha256}));}
 function enter(){if(stopped)mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);if(active)mediaFail('YXX_MEDIA_BUSY',429);active=1;settled=new Promise<void>(r=>{finish=r;});}
 function leave(){plaintext?.fill(0);plaintext=null;active=0;finish();}
 async function closeHandle(handle:FileHandle|undefined){if(handle){try{await handle.close();}finally{handles--;}}}
 return Object.freeze({
   async write(asset:H5MediaObject,bytes:Buffer,signal:AbortSignal){check(asset);if(bytes.length!==asset.byte_size||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);enter();let handle:FileHandle|undefined,created=false,completed=false;const path=name(asset.media_ref,asset.variant);let ciphertext:Buffer|null=null;
   try{signal.throwIfAborted();await safeRoot();signal.throwIfAborted();handle=await open(path,'wx',0o600);handles++;created=true;const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(aad(asset));ciphertext=cipher.update(bytes);const tail=cipher.final();if(tail.length){tail.fill(0);mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);}
    for(const part of [iv,cipher.getAuthTag(),ciphertext]){for(let at=0;at<part.length;){signal.throwIfAborted();const result=await handle.write(part,at,Math.min(H5_MEDIA_LIMITS.chunk,part.length-at),null);if(!result.bytesWritten)mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);at+=result.bytesWritten;}}
    await handle.sync();signal.throwIfAborted();completed=true;
   }catch(error){if(error instanceof H5MediaError)throw error;mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);}
   finally{ciphertext?.fill(0);await closeHandle(handle);if(created&&!completed)await unlink(path).catch(()=>{});leave();}
  },
  async read(asset:H5MediaObject,signal:AbortSignal){check(asset);enter();let handle:FileHandle|undefined,ciphertext:Buffer|null=null;
   try{signal.throwIfAborted();await safeRoot();const path=name(asset.media_ref,asset.variant),before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size!==asset.byte_size+28)mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);
    handle=await open(path,'r');handles++;const after=await handle.stat();if(!after.isFile()||after.nlink!==1||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||await realpath(path)!==path)mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);
    ciphertext=Buffer.alloc(asset.byte_size+28);let length=0;while(length<ciphertext.length){signal.throwIfAborted();const result=await handle.read(ciphertext,length,Math.min(H5_MEDIA_LIMITS.chunk,ciphertext.length-length),null);if(!result.bytesRead)mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);length+=result.bytesRead;}const finalStat=await handle.stat();if(finalStat.size!==ciphertext.length)mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);
    const decipher=createDecipheriv('aes-256-gcm',secret,ciphertext.subarray(0,12));decipher.setAuthTag(ciphertext.subarray(12,28));decipher.setAAD(aad(asset));
    try{plaintext=decipher.update(ciphertext.subarray(28));const tail=decipher.final();if(tail.length){tail.fill(0);mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);}}catch{mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);}
    if(plaintext.length!==asset.byte_size||createHash('sha256').update(plaintext).digest('hex')!==asset.sha256)mediaFail('YXX_MEDIA_INTEGRITY_FAILED',422);signal.throwIfAborted();const out=plaintext;plaintext=null;return out;
   }catch(error){if(error instanceof H5MediaError)throw error;if((error as {code?:unknown})?.code==='ENOENT')mediaFail('YXX_MEDIA_NOT_FOUND',404);mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);}
   finally{ciphertext?.fill(0);await closeHandle(handle);leave();}
  },
  async remove(ref:string,variant:H5MediaVariant){await safeRoot();const path=name(ref,variant);let s;try{s=await lstat(path);}catch(error){if((error as {code?:unknown})?.code==='ENOENT')return;throw error;}if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1)mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);await unlink(path);},
  async close(){stopped=true;await settled;secret.fill(0);},
  ownedResourceState:()=>({active,handles,plaintext_bytes:plaintext?.length??0}),
 });
}
