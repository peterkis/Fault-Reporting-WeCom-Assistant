import type { H5BootstrapExtension } from '../api/types';
export type MediaKind='VOICE'|'IMAGE'|'VIDEO';
export interface MediaCandidate {kind:MediaKind;byteSize:number|null;mimeType:string;durationMs:number|null}
export const DEFAULT_LIMITS:H5BootstrapExtension['limits']={voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024};
export function validateMedia(candidate:MediaCandidate,existing:MediaCandidate[],limits=DEFAULT_LIMITS):'mediaLimit'|'mediaInvalid'|null {
  const mime=candidate.mimeType.toLowerCase().split(';')[0];
  const allowed=candidate.kind==='VOICE'?['audio/amr','audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/ogg']:candidate.kind==='IMAGE'?['image/jpeg','image/png','image/webp']:['video/mp4','video/webm','video/quicktime'];
  if(!mime||!allowed.includes(mime))return 'mediaInvalid';
  const maximum=candidate.kind==='VOICE'?limits.voice_bytes:candidate.kind==='IMAGE'?limits.image_bytes:limits.video_bytes;
  const count=candidate.kind==='VOICE'?limits.voice_count:candidate.kind==='IMAGE'?limits.image_count:limits.video_count;
  if(existing.filter(item=>item.kind===candidate.kind).length>=count)return 'mediaLimit';
  if(candidate.byteSize!==null&&(!Number.isSafeInteger(candidate.byteSize)||candidate.byteSize<=0||candidate.byteSize>maximum))return 'mediaLimit';
  if(existing.reduce((total,item)=>total+(item.byteSize??0),candidate.byteSize??0)>limits.total_bytes)return 'mediaLimit';
  if(candidate.kind!=='IMAGE'&&(candidate.durationMs===null||!Number.isFinite(candidate.durationMs)||candidate.durationMs<=0||candidate.durationMs>60_000))return 'mediaLimit';
  return null;
}
export function hasFaultMaterial(description:string,refs:readonly string[]):boolean{return description.trim().length>0||refs.length>0;}
export function measureDuration(file:Blob,kind:MediaKind):Promise<number|null>{
  if(kind==='IMAGE')return Promise.resolve(null);
  return new Promise((resolve,reject)=>{
    const element=document.createElement(kind==='VIDEO'?'video':'audio');
    const url=URL.createObjectURL(file);const timer=window.setTimeout(()=>done(null),10_000);
    const done=(value:number|null)=>{clearTimeout(timer);element.removeAttribute('src');element.load();URL.revokeObjectURL(url);if(value===null)reject(new Error('mediaInvalid'));else resolve(value);};
    element.preload='metadata';element.onloadedmetadata=()=>done(Number.isFinite(element.duration)?Math.ceil(element.duration*1000):null);element.onerror=()=>done(null);element.src=url;
  });
}
