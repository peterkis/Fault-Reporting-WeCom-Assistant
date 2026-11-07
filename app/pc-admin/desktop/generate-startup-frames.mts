/** Development-only, deterministic extraction. No FFmpeg executable enters the desktop package. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const desktop=path.join(process.cwd(),'app/pc-admin/desktop'),output=path.join(desktop,'startup-frames');
const sourceHash='0b52ad1a40dc473a6e6adce5b4ea2297f1ecf62ce73ec87e69d7e15eb5fea65b';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const args=process.argv.slice(2),options=new Map<string,string>();
for(let index=0;index<args.length;index+=2){
  const key=args[index],value=args[index+1];
  if(!key||!['--ffmpeg','--ffprobe','--attachment'].includes(key)||!value||options.has(key))throw Error('DESKTOP_FRAME_GENERATOR_ARGUMENTS_INVALID');
  options.set(key,value);
}
function option(name:string):string {const value=options.get(name);if(!value)throw Error('DESKTOP_FRAME_GENERATOR_ARGUMENT_REQUIRED:'+name);return path.resolve(value);}
const ffmpeg=option('--ffmpeg'),ffprobe=option('--ffprobe'),attachment=option('--attachment');
for(const file of [attachment,path.join(desktop,'startup-video.mp4')]){
  const bytes=readFileSync(file);
  if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||bytes.length!==350437||sha(bytes)!==sourceHash)throw Error('DESKTOP_FRAME_SOURCE_MISMATCH');
}
const run=(tool:string,parameters:readonly string[])=>execFileSync(tool,parameters,{cwd:desktop,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
const ffmpegVersion=run(ffmpeg,['-version']).split(/\r?\n/u)[0],ffprobeVersion=run(ffprobe,['-version']).split(/\r?\n/u)[0];
if(ffmpegVersion!=='ffmpeg version 9.0.2-essentials_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers'
  ||ffprobeVersion!=='ffprobe version 9.0.2-essentials_build-www.gyan.dev Copyright (c) 2007-2026 the FFmpeg developers')throw Error('DESKTOP_FRAME_TOOL_VERSION_MISMATCH');
const probe:unknown=JSON.parse(run(ffprobe,['-v','error','-count_frames','-show_entries','stream=codec_name,codec_type,profile,level,width,height,r_frame_rate,avg_frame_rate,time_base,duration_ts,nb_frames,nb_read_frames','-of','json','startup-video.mp4']));
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('DESKTOP_FRAME_SOURCE_PROBE_INVALID');return value as Record<string,unknown>;}
const streams=record(probe).streams;
if(!Array.isArray(streams)||streams.length!==1)throw Error('DESKTOP_FRAME_SOURCE_STREAMS_INVALID');
const stream=record(streams[0]);
if(stream.codec_name!=='h264'||stream.codec_type!=='video'||stream.profile!=='High'||stream.level!==32||stream.width!==972||stream.height!==972
  ||stream.r_frame_rate!=='30/1'||stream.avg_frame_rate!=='30/1'||stream.time_base!=='1/30'||stream.duration_ts!==68||stream.nb_frames!=='68'||stream.nb_read_frames!=='68')throw Error('DESKTOP_FRAME_SOURCE_TIMING_INVALID');
const names=Array.from({length:68},(_,index)=>String(index).padStart(3,'0')+'.webp');
if(existsSync(output)){
  if(!lstatSync(output).isDirectory()||lstatSync(output).isSymbolicLink())throw Error('DESKTOP_FRAME_OUTPUT_REPARSE_REJECTED');
  for(const name of readdirSync(output)){
    const info=lstatSync(path.join(output,name));
    if(![...names,'manifest.json'].includes(name)||!info.isFile()||info.isSymbolicLink())throw Error('DESKTOP_FRAME_OUTPUT_INVENTORY_INVALID');
  }
}else mkdirSync(output);
const parameters=['-hide_banner','-loglevel','error','-nostdin','-y','-i','startup-video.mp4','-map','0:v:0','-an','-map_metadata','-1',
  '-vf','scale=540:540:flags=lanczos','-c:v','libwebp','-lossless','1','-compression_level','6','-q:v','100','-pix_fmt','bgra','-threads:v','1',
  '-fps_mode','passthrough','-start_number','0','-frames:v','68','startup-frames/%03d.webp'];
run(ffmpeg,parameters);
if(JSON.stringify(readdirSync(output).filter(name=>name!=='manifest.json').sort())!==JSON.stringify(names))throw Error('DESKTOP_FRAME_OUTPUT_COUNT_INVALID');
const frames=names.map(name=>{
  const bytes=readFileSync(path.join(output,name));
  if(bytes.length<25||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,12)!=='WEBP'
    ||bytes.toString('ascii',12,16)!=='VP8L'||bytes[20]!==0x2f)throw Error('DESKTOP_FRAME_OUTPUT_NOT_LOSSLESS');
  const dimensions=bytes.readUInt32LE(21);
  if((dimensions&0x3fff)+1!==540||((dimensions>>>14)&0x3fff)+1!==540||(dimensions>>>28)!==0)throw Error('DESKTOP_FRAME_OUTPUT_DIMENSIONS_INVALID');
  return {file:'startup-frames/'+name,bytes:bytes.length,sha256:sha(bytes)};
});
const manifest={schemaVersion:1,source:{file:'startup-video.mp4',bytes:350437,sha256:sourceHash},width:540,height:540,frameCount:68,fps:30,durationSeconds:68/30,format:'webp',lossless:true,
  generator:{ffmpegVersion,ffprobeVersion,arguments:parameters,sourceProbe:{codec:'h264',profile:'High',level:32,width:972,height:972,rate:'30/1',frames:68,timeBase:'1/30',durationTicks:68,audioStreams:0}},frames};
const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');writeFileSync(path.join(output,'manifest.json'),bytes);
console.log(JSON.stringify({sourceSha256:sourceHash,frameCount:frames.length,width:540,height:540,fps:30,frameBytes:frames.reduce((total,frame)=>total+frame.bytes,0),manifestSha256:sha(bytes),ffmpegVersion}));
