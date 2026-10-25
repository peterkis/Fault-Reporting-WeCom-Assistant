import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,lstat,unlink} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import type {H5MediaTranscoder,H5MediaTranscodeResult,H5MediaThumbnailResult} from '../../../contracts/yxx_h5_media_contracts.js';
import {H5_MEDIA_LIMITS,H5MediaError,mediaFail,inspectMedia} from './yxx-h5-media-format.mjs';

/** One explicit executable pair, one child at a time, private bounded temporary files. */
export function createYxxH5MediaFFmpegTranscoder({ffmpegPath,ffprobePath,temporaryRoot,timeoutMs=25_000}:{ffmpegPath:string;ffprobePath:string;temporaryRoot:string;timeoutMs?:number}):H5MediaTranscoder {
 if(!ffmpegPath||!ffprobePath||!temporaryRoot||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>25_000)mediaFail('YXX_MEDIA_TRANSCODER_CONFIG_INVALID',503);
 const ffmpeg=resolve(ffmpegPath),ffprobe=resolve(ffprobePath),root=resolve(temporaryRoot);let active=0,processes=0,temporary_files=0,stopped=false,current:AbortController|null=null;
 let settled:Promise<void>=Promise.resolve(),finish=()=>{};
 async function run(executable:string,args:string[],signal:AbortSignal):Promise<Buffer>{
  signal.throwIfAborted();return new Promise<Buffer>((resolveResult,reject)=>{const child=spawn(executable,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});processes++;const chunks:Buffer[]=[];let bytes=0,failed=false;
   const abort=()=>{failed=true;child.kill();};signal.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>64*1024){failed=true;child.kill();}else chunks.push(Buffer.from(chunk));});
   child.stderr.on('data',()=>{}); // Never expose filenames or untrusted media tags in errors/logs.
   child.once('error',()=>{failed=true;});child.once('close',code=>{processes--;signal.removeEventListener('abort',abort);if(failed||code!==0||signal.aborted)reject(new H5MediaError('YXX_MEDIA_CONVERSION_UNAVAILABLE',503));else resolveResult(Buffer.concat(chunks));});
  });
 }
 return Object.freeze({
  async normalize({bytes,kind,mime_type,signal,performanceEnabled=false,maxOutputBytes}:Parameters<H5MediaTranscoder['normalize']>[0]):Promise<H5MediaTranscodeResult>{
   if(stopped)mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);if(active)mediaFail('YXX_MEDIA_BUSY',429);if(!bytes.length||bytes.length>H5_MEDIA_LIMITS[kind])mediaFail('YXX_MEDIA_OVERSIZED',413);const maximum=Math.min(H5_MEDIA_LIMITS[kind],performanceEnabled&&kind==='VIDEO'?H5_MEDIA_LIMITS.playableVideo:H5_MEDIA_LIMITS[kind],maxOutputBytes??H5_MEDIA_LIMITS[kind]);if(!Number.isSafeInteger(maximum)||maximum<1)mediaFail('YXX_MEDIA_INPUT_INVALID');
   active=1;settled=new Promise<void>(r=>{finish=r;});const controller=new AbortController();current=controller;const combined=AbortSignal.any([signal,controller.signal]),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref();let directory:string|null=null,result:Buffer|null=null;
   try{for(const path of [ffmpeg,ffprobe]){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||!['','.exe'].includes(extname(path).toLowerCase()))mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);}
    const parent=await lstat(root);if(!parent.isDirectory()||parent.isSymbolicLink())mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);directory=await mkdtemp(join(root,'yxx-transcode-'));temporary_files=1;
    const input=join(directory,'input.media'),output=join(directory,kind==='VOICE'?'playable.wav':'playable.mp4');await writeFile(input,bytes,{mode:0o600,flag:'wx'});temporary_files=2;combined.throwIfAborted();
    const containerDuration=inspectMedia(bytes,kind,mime_type);const probe=await run(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration:stream=codec_type,duration','-of','json',input],combined);let value:unknown;try{value=JSON.parse(probe.toString('utf8'));}catch{mediaFail('YXX_MEDIA_FORMAT_INVALID',422);}
    if(!value||typeof value!=='object')mediaFail('YXX_MEDIA_FORMAT_INVALID',422);const data=value as {format?:{duration?:unknown};streams?:{codec_type?:unknown;duration?:unknown}[]};
    const probed=[Number(data.format?.duration),...(data.streams??[]).map(s=>Number(s.duration))].filter(n=>Number.isFinite(n)&&n>0),duration=containerDuration!==null?containerDuration/1000:Math.max(...probed),hasAudio=data.streams?.some(s=>s.codec_type==='audio'),hasVideo=data.streams?.some(s=>s.codec_type==='video');
    if(!Number.isFinite(duration)||duration<=0||kind==='VOICE'&&!hasAudio||kind==='VIDEO'&&!hasVideo)mediaFail('YXX_MEDIA_FORMAT_INVALID',422);if(duration*1000>H5_MEDIA_LIMITS.duration)mediaFail('YXX_MEDIA_DURATION_EXCEEDED',422);
    const args=['-nostdin','-v','error','-threads','1','-filter_threads','1','-protocol_whitelist','file,pipe','-i',input,'-map_metadata','-1','-t','60'];
    if(kind==='VOICE')args.push('-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-fs',String(maximum),'-threads','1',output);
    else{args.push('-map','0:v:0','-map','0:a:0?','-vf',performanceEnabled?'scale=w=720:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24':'scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','veryfast','-crf','27');if(performanceEnabled)args.push('-maxrate','850k','-bufsize','1700k');args.push('-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart','-fs',String(maximum),'-threads','1',output);}
    await run(ffmpeg,args,combined);temporary_files=3;const info=await lstat(output);if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>maximum)mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);
    const outputProbe=await run(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration','-of','json',output],combined);let outputInfo:unknown;try{outputInfo=JSON.parse(outputProbe.toString('utf8'));}catch{mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);}const outputDuration=outputInfo&&typeof outputInfo==='object'?Number((outputInfo as {format?:{duration?:unknown}}).format?.duration):NaN;
    if(!Number.isFinite(outputDuration)||outputDuration<=0||outputDuration>60||outputDuration+0.25<duration)mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);
    result=await readFile(output);combined.throwIfAborted();const out=result;result=null;return {bytes:out,mime_type:kind==='VOICE'?'audio/wav':'video/mp4',duration_ms:Math.ceil(outputDuration*1000)};
   }catch(error){if(error instanceof H5MediaError)throw error;mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);}
   finally{result?.fill(0);clearTimeout(timer);controller.abort();if(directory)await rm(directory,{recursive:true,force:true});temporary_files=0;current=null;active=0;finish();}
  },
  async thumbnail({bytes,mime_type,signal}:Parameters<NonNullable<H5MediaTranscoder['thumbnail']>>[0]):Promise<H5MediaThumbnailResult>{
   if(stopped)mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);if(active)mediaFail('YXX_MEDIA_BUSY',429);inspectMedia(bytes,'IMAGE',mime_type);
   active=1;settled=new Promise<void>(r=>{finish=r;});const controller=new AbortController();current=controller;const combined=AbortSignal.any([signal,controller.signal]),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref();let directory:string|null=null,result:Buffer|null=null;
   try{
    for(const path of [ffmpeg,ffprobe]){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||!['','.exe'].includes(extname(path).toLowerCase()))mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);}
    const parent=await lstat(root);if(!parent.isDirectory()||parent.isSymbolicLink())mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);directory=await mkdtemp(join(root,'yxx-transcode-'));temporary_files=1;
    const input=join(directory,'input.media'),output=join(directory,'thumbnail.jpg');await writeFile(input,bytes,{mode:0o600,flag:'wx'});temporary_files=2;combined.throwIfAborted();
    for(const quality of [8,16,24,31]){
     await unlink(output).catch(error=>{if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;});
     await run(ffmpeg,['-nostdin','-v','error','-threads','1','-filter_threads','1','-protocol_whitelist','file,pipe','-i',input,'-map','0:v:0','-map_metadata','-1','-map_chapters','-1','-vf',"scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease",'-frames:v','1','-an','-c:v','mjpeg','-pix_fmt','yuvj444p','-q:v',String(quality),'-update','1','-threads','1',output],combined);temporary_files=3;
     const info=await lstat(output);if(!info.isFile()||info.isSymbolicLink()||info.size<1)mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);if(info.size>H5_MEDIA_LIMITS.thumbnail)continue;
     result=await readFile(output);inspectMedia(result,'IMAGE','image/jpeg');combined.throwIfAborted();const out=result;result=null;return {bytes:out,mime_type:'image/jpeg'};
    }
    mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);
   }catch(error){if(error instanceof H5MediaError)throw error;mediaFail('YXX_MEDIA_CONVERSION_UNAVAILABLE',503);}
   finally{result?.fill(0);clearTimeout(timer);controller.abort();if(directory)await rm(directory,{recursive:true,force:true});temporary_files=0;current=null;active=0;finish();}
  },
  async close(){stopped=true;current?.abort();await settled;},
  ownedResourceState:()=>({active,processes,temporary_files}),
 });
}
