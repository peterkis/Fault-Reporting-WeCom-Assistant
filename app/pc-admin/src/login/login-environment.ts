import * as THREE from 'three';
import environmentAssetUrl from './assets/login-environment-v1.pmrem?url';

const GZIP_BYTES=880178,RAW_BYTES=6291456,WIDTH=768,HEIGHT=1024;
const GZIP_SHA256='dfe29d470a36a2cb171559d79437ad2ab95478d7a94a42037188c6f0005bec3b';
const RAW_SHA256='fd1d0fbaf0ebf04caa87c7f365de90e975372ac1fa7842c79616de3fc8e657ab';
const LITTLE_ENDIAN=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
type AssetFailureReason='rebake-required'|'url-invalid'|'fetch-failed'|'http-status'|'mime'|'content-encoding'|'body-unavailable'|'compressed-length'|'compressed-integrity'|'decompression-unavailable'|'decompression-failed'|'raw-length'|'hash-unavailable'|'raw-integrity';
export class LoginEnvironmentAssetFailure extends Error {
  constructor(readonly reason:AssetFailureReason){super('LANYARD_ENV_'+reason.replaceAll('-','_').toUpperCase());}
}
const aborted=()=>new DOMException('Login environment preparation cancelled','AbortError');
const checkAbort=(signal:AbortSignal)=>{if(signal.aborted)throw aborted();};
async function exactBytes(stream:ReadableStream<Uint8Array>,length:number,reason:'compressed-length'|'raw-length',signal:AbortSignal,assertCurrent:()=>void):Promise<Uint8Array<ArrayBuffer>>{
  checkAbort(signal);const reader=stream.getReader();let offset=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
    const bytes=new Uint8Array(length);
    for(;;){
      let part:ReadableStreamReadResult<Uint8Array>;
      try{part=await reader.read();}catch{checkAbort(signal);throw new LoginEnvironmentAssetFailure(reason==='raw-length'?'decompression-failed':'fetch-failed');}
      checkAbort(signal);assertCurrent();if(part.done)break;
      if(!(part.value instanceof Uint8Array)||part.value.byteLength>length-offset)throw new LoginEnvironmentAssetFailure(reason);
      bytes.set(part.value,offset);offset+=part.value.byteLength;
    }
    if(offset!==length)throw new LoginEnvironmentAssetFailure(reason);return bytes;
  }finally{signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
}
async function verify(bytes:Uint8Array<ArrayBuffer>,expected:string,reason:'compressed-integrity'|'raw-integrity',signal:AbortSignal,assertCurrent:()=>void):Promise<void>{
  if(!globalThis.crypto?.subtle)throw new LoginEnvironmentAssetFailure('hash-unavailable');
  let digest:ArrayBuffer;try{digest=await crypto.subtle.digest('SHA-256',bytes);}catch{checkAbort(signal);throw new LoginEnvironmentAssetFailure('hash-unavailable');}
  checkAbort(signal);assertCurrent();
  const actual=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  if(actual!==expected)throw new LoginEnvironmentAssetFailure(reason);
}
export function disposeLoginEnvironment(texture:THREE.DataTexture):void{
  try{texture.dispose();}finally{texture.image.data=null;}
}

/** One frozen asset, not a configurable media or filesystem loader. */
export async function prepareLoginEnvironment(signal:AbortSignal,assertCurrent:()=>void,retain:(texture:THREE.DataTexture)=>void):Promise<void>{
  let response:Response|null=null,compressed:Uint8Array<ArrayBuffer>|null=null,raw:Uint8Array<ArrayBuffer>|null=null,pixels:Uint16Array<ArrayBuffer>|null=null,texture:THREE.DataTexture|null=null;
  try{
    checkAbort(signal);assertCurrent();
    if(THREE.REVISION!=='186')throw new LoginEnvironmentAssetFailure('rebake-required');
    if(typeof DecompressionStream!=='function')throw new LoginEnvironmentAssetFailure('decompression-unavailable');
    let url:URL;try{url=new URL(environmentAssetUrl,location.href);}catch{throw new LoginEnvironmentAssetFailure('url-invalid');}
    if(url.origin!==location.origin||url.search||url.hash)throw new LoginEnvironmentAssetFailure('url-invalid');
    try{response=await fetch(url.href,{signal,mode:'same-origin',redirect:'error'});}catch{checkAbort(signal);throw new LoginEnvironmentAssetFailure('fetch-failed');}
    checkAbort(signal);assertCurrent();
    if(response.status!==200||response.url!==url.href)throw new LoginEnvironmentAssetFailure('http-status');
    if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/octet-stream')throw new LoginEnvironmentAssetFailure('mime');
    if(response.headers.get('content-encoding')!==null)throw new LoginEnvironmentAssetFailure('content-encoding');
    const declared=response.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/u.test(declared)||Number(declared)!==GZIP_BYTES))throw new LoginEnvironmentAssetFailure('compressed-length');
    if(!response.body)throw new LoginEnvironmentAssetFailure('body-unavailable');
    compressed=await exactBytes(response.body,GZIP_BYTES,'compressed-length',signal,assertCurrent);
    checkAbort(signal);assertCurrent();await verify(compressed,GZIP_SHA256,'compressed-integrity',signal,assertCurrent);
    checkAbort(signal);assertCurrent();
    let decompressor:DecompressionStream;
    try{decompressor=new DecompressionStream('gzip');}catch{throw new LoginEnvironmentAssetFailure('decompression-unavailable');}
    let decompressed:ReadableStream<Uint8Array>;
    try{const source=new Response(compressed).body;compressed=null;if(!source)throw new LoginEnvironmentAssetFailure('body-unavailable');decompressed=source.pipeThrough(decompressor);}
    catch(error){checkAbort(signal);assertCurrent();if(error instanceof LoginEnvironmentAssetFailure)throw error;throw new LoginEnvironmentAssetFailure('decompression-failed');}
    raw=await exactBytes(decompressed,RAW_BYTES,'raw-length',signal,assertCurrent);
    checkAbort(signal);assertCurrent();await verify(raw,RAW_SHA256,'raw-integrity',signal,assertCurrent);
    checkAbort(signal);assertCurrent();
    // The bake is lower-left row first, RGBA half-float words in little endian.
    // Preserve raw half bits; never normalize to Float32 or flip the rows.
    if(LITTLE_ENDIAN)pixels=new Uint16Array(raw.buffer,raw.byteOffset,RAW_BYTES/2);
    else{pixels=new Uint16Array(RAW_BYTES/2);const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);for(let index=0;index<pixels.length;index++)pixels[index]=view.getUint16(index*2,true);}
    raw=null;checkAbort(signal);assertCurrent();
    texture=new THREE.DataTexture(pixels,WIDTH,HEIGHT,THREE.RGBAFormat,THREE.HalfFloatType);
    texture.mapping=THREE.CubeUVReflectionMapping;texture.colorSpace=THREE.LinearSRGBColorSpace;
    texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
    texture.generateMipmaps=false;texture.mipmaps=[];texture.flipY=false;texture.internalFormat=null;
    texture.anisotropy=1;texture.premultiplyAlpha=false;texture.unpackAlignment=4;texture.needsUpdate=true;
    checkAbort(signal);assertCurrent();
    // No await after construction: either retain synchronously or release here.
    retain(texture);texture=null;
  }finally{
    if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});
    compressed=null;raw=null;pixels=null;if(texture)disposeLoginEnvironment(texture);
  }
}
