import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as nextTurn} from 'node:timers/promises';
import sharp from 'sharp';
import {createYxxH5MediaFFmpegTranscoder} from '../app/server/src/yxx-h5-media-transcode.mjs';
import {H5_MEDIA_LIMITS} from '../app/server/src/yxx-h5-media-format.mjs';
import type {H5MediaTranscoder} from '../contracts/yxx_h5_media_contracts.js';

const signal=()=>new AbortController().signal;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const codecSkip=!process.env.H5_MEDIA_FFMPEG||!process.env.H5_MEDIA_FFPROBE?'NOT_RUN: explicit controlled FFmpeg pair unavailable':false;

test('video poster uses a real midpoint/one-second frame within the existing JPEG budget',{skip:codecSkip,timeout:90000},()=>fixture(async(converter,root)=>{
 assert.ok(converter.thumbnail);const ffmpeg=process.env.H5_MEDIA_FFMPEG;assert.ok(ffmpeg);
 for(const duration of [0.5,2]){
  const source=join(root,'poster-'+duration+'.mp4'),at=Math.min(1,duration/2);
  const generated:ReturnType<typeof spawnSync>=spawnSync(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i',`color=c=red:s=1280x720:r=24:d=${duration}`,'-vf',`drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,${at/2})'`,'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-threads','1',source],{windowsHide:true,timeout:15000});assert.equal(generated.status,0);
  const bytes=await readFile(source),before=hash(bytes);
  const result:Awaited<ReturnType<NonNullable<H5MediaTranscoder['thumbnail']>>>=await converter.thumbnail({bytes,mime_type:'video/mp4',kind:'VIDEO',signal:signal()});assert.equal(hash(bytes),before);assert.equal(result.mime_type,'image/jpeg');assert.ok(result.bytes.length<=160*1024);
  const metadata=await sharp(result.bytes).metadata();assert.ok(metadata.width&&metadata.height&&Math.max(metadata.width,metadata.height)<=960);
  const pixel=await sharp(result.bytes).resize(1,1).raw().toBuffer();assert.ok((pixel[2]??0)>(pixel[0]??0)+100,'poster is the blue later frame, not the red initial frame');
 }
}));

async function fixture(run:(converter:H5MediaTranscoder,root:string,temporaryRoot:string)=>Promise<void>){
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,'workbench-media-quality-'));
  assert.equal(dirname(root),parent);
  const temporaryRoot=join(root,'transcode');await mkdir(temporaryRoot);
  // Image conversion needs only the compiled Node child; no implicit executable discovery.
  const converter=createYxxH5MediaFFmpegTranscoder({temporaryRoot,
    ffmpegPath:process.env.H5_MEDIA_FFMPEG??join(root,'unconfigured-ffmpeg.exe'),
    ffprobePath:process.env.H5_MEDIA_FFPROBE??join(root,'unconfigured-ffprobe.exe')});
  try{await run(converter,root,temporaryRoot);}
  finally{
    await converter.close();
    try{assert.deepEqual(converter.ownedResourceState(),{active:0,processes:0,temporary_files:0});assert.deepEqual(await readdir(temporaryRoot),[]);}
    finally{await rm(root,{recursive:true,force:true});}
  }
}

async function rgba(bytes:Buffer){return sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
function psnr(left:Buffer,right:Buffer){assert.equal(left.length,right.length);let squareError=0;for(let i=0;i<left.length;i++){const difference=(left[i]??0)-(right[i]??0);squareError+=difference*difference;}return squareError===0?Infinity:10*Math.log10(255*255/(squareError/left.length));}
async function waitForProcess(converter:H5MediaTranscoder){const deadline=performance.now()+5000;while(converter.ownedResourceState().processes!==1){assert.ok(performance.now()<deadline,'the isolated codec process starts');await nextTurn();}}

// Fine, one-pixel strokes and small labels are deliberate: downsampling or a
// lossy screenshot path must fail even when a large blank background looks fine.
function textChart(width:number,height:number){
  const raw=Buffer.alloc(width*height*3,255),glyphs=['11111100011000110001100011000111111','00100011000010000100001000010001110','11111000010000111111100001000011111','11111000010000101111000010000111111'];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const glyph=glyphs[Math.floor(x/8)%glyphs.length]??'',stroke=x%8<5&&y%12<7&&glyph[(y%12)*5+x%8]==='1';
    const value=stroke||x===Math.floor(width/2)||y===Math.floor(height/2)?0:255,at=(y*width+x)*3;raw[at]=value;raw[at+1]=value;raw[at+2]=value;
  }
  return sharp(raw,{raw:{width,height,channels:3}});
}

test('background image codec preserves full-resolution screenshot text pixels and source bytes',{timeout:30_000},()=>fixture(async converter=>{
  const source=await textChart(1440,960).png().toBuffer(),before=hash(source),compress=converter.compressImage;assert.ok(compress);
  const result=await compress({bytes:source,mime_type:'image/png',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()});
  try{const original=await rgba(source),converted=await rgba(result.bytes);assert.equal(result.mime_type,'image/webp');assert.equal(converted.info.width,1440);assert.equal(converted.info.height,960);assert.deepEqual(converted.data,original.data,'all small text strokes survive the lossless screenshot path');assert.equal(hash(source),before);}
  finally{result.bytes.fill(0);}
}));

test('background image codec preserves transparent pixels and alpha without a background matte',{timeout:30_000},()=>fixture(async converter=>{
  const width=256,height=128,raw=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;raw[at]=x;raw[at+1]=y;raw[at+2]=255-x;raw[at+3]=[0,64,128,255][x%4]??0;}
  const source=await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer(),compress=converter.compressImage;assert.ok(compress);
  const result=await compress({bytes:source,mime_type:'image/png',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()});
  try{const converted=await rgba(result.bytes);assert.equal(converted.info.width,width);assert.equal(converted.info.height,height);assert.deepEqual(converted.data,raw,'including RGB beneath alpha=0');}
  finally{result.bytes.fill(0);}
}));

test('background image codec applies EXIF rotation and reflection once and keeps all pixels',{timeout:30_000},()=>fixture(async converter=>{
  const width=96,height=64,raw=Buffer.alloc(width*height*3),colors=[[230,20,20],[20,210,20],[20,20,230],[220,210,20]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const color=colors[(y<height/2?0:2)+(x<width/2?0:1)];assert.ok(color);for(let channel=0;channel<3;channel++)raw[(y*width+x)*3+channel]=color[channel]??0;}
  // Expected row-major quadrant order is independent of Sharp's orientation implementation.
  for(const entry of [{orientation:2,order:[1,0,3,2],width,height},{orientation:6,order:[2,0,3,1],width:height,height:width},{orientation:7,order:[3,1,2,0],width:height,height:width}]){
    const source=await sharp(raw,{raw:{width,height,channels:3}}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).withMetadata({orientation:entry.orientation}).toBuffer(),before=hash(source),compress=converter.compressImage;assert.ok(compress);
    const result=await compress({bytes:source,mime_type:'image/jpeg',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()});
    try{const converted=await rgba(result.bytes),metadata=await sharp(result.bytes).metadata();assert.equal(converted.info.width,entry.width);assert.equal(converted.info.height,entry.height);assert.ok(metadata.orientation===undefined||metadata.orientation===1);
      for(let quadrant=0;quadrant<4;quadrant++){const x=Math.floor(entry.width*(quadrant%2===0?0.25:0.75)),y=Math.floor(entry.height*(quadrant<2?0.25:0.75)),color=colors[entry.order[quadrant]??-1];assert.ok(color);for(let channel=0;channel<3;channel++)assert.ok(Math.abs((converted.data[(y*entry.width+x)*4+channel]??0)-(color[channel]??0))<=12,`orientation ${entry.orientation}, quadrant ${quadrant}, channel ${channel}`);}
      assert.equal(hash(source),before);
    }finally{result.bytes.fill(0);}
  }
}));

test('high-quality JPEG conversion retains small high-contrast text without resizing',{timeout:30_000},()=>fixture(async converter=>{
  const source=await textChart(1280,800).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer(),compress=converter.compressImage;assert.ok(compress);
  const result=await compress({bytes:source,mime_type:'image/jpeg',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()});
  try{const original=await rgba(source),converted=await rgba(result.bytes);assert.equal(converted.info.width,original.info.width);assert.equal(converted.info.height,original.info.height);assert.ok(psnr(original.data,converted.data)>=38,'high-quality re-encoding must keep the text chart at PSNR >=38 dB');}
  finally{result.bytes.fill(0);}
}));

test('image size rejection and cancellation leave no plaintext file or codec child',{timeout:30_000},()=>fixture(async(converter,_root,temporaryRoot)=>{
  const source=await textChart(2000,1200).png().toBuffer(),before=hash(source),compress=converter.compressImage;assert.ok(compress);
  await assert.rejects(compress({bytes:source,mime_type:'image/png',maxOutputBytes:1,signal:signal()}));
  assert.deepEqual(converter.ownedResourceState(),{active:0,processes:0,temporary_files:0});assert.deepEqual(await readdir(temporaryRoot),[]);
  const controller=new AbortController(),pending=compress({bytes:source,mime_type:'image/png',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:controller.signal}),outcome=assert.rejects(pending);
  await waitForProcess(converter);await assert.rejects(compress({bytes:source,mime_type:'image/png',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()}),{code:'YXX_MEDIA_BUSY'});controller.abort();await outcome;
  assert.equal(hash(source),before);assert.deepEqual(converter.ownedResourceState(),{active:0,processes:0,temporary_files:0});assert.deepEqual(await readdir(temporaryRoot),[]);
  const recovered=await compress({bytes:source,mime_type:'image/png',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()});recovered.bytes.fill(0);
}));

test('closing the transcoder cancels an active image child and blocks new work',{timeout:30_000},()=>fixture(async converter=>{
  const source=await textChart(2000,1200).png().toBuffer(),compress=converter.compressImage;assert.ok(compress);
  const pending=compress({bytes:source,mime_type:'image/png',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()}),outcome=assert.rejects(pending);
  await waitForProcess(converter);await converter.close();await outcome;
  await assert.rejects(compress({bytes:source,mime_type:'image/png',maxOutputBytes:H5_MEDIA_LIMITS.IMAGE,signal:signal()}),{code:'YXX_MEDIA_CONVERSION_UNAVAILABLE'});
}));

function execute(executable:string,args:string[],maxBuffer=64*1024){const result=spawnSync(executable,args,{windowsHide:true,timeout:20_000,maxBuffer});assert.equal(result.error,undefined);assert.equal(result.status,0,'controlled codec command succeeds');return result.stdout;}
function probe(file:string){
  const parsed:unknown=JSON.parse(execute(resolve(process.env.H5_MEDIA_FFPROBE??''),['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate,nb_read_frames,color_transfer','-of','json',file]).toString('utf8'));
  assert.ok(parsed&&typeof parsed==='object'&&'streams' in parsed&&Array.isArray(parsed.streams));const stream:unknown=parsed.streams[0];
  assert.ok(stream&&typeof stream==='object'&&'width' in stream&&'height' in stream&&'avg_frame_rate' in stream&&'nb_read_frames' in stream);
  return {width:Number(stream.width),height:Number(stream.height),rate:String(stream.avg_frame_rate),frames:Number(stream.nb_read_frames),transfer:'color_transfer' in stream?String(stream.color_transfer):null};
}
function firstFrame(file:string){return execute(resolve(process.env.H5_MEDIA_FFMPEG??''),['-nostdin','-v','error','-threads','1','-i',file,'-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],4*1024*1024);}
function generateVideo(file:string,hdr=false){execute(resolve(process.env.H5_MEDIA_FFMPEG??''),['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=1280x960:rate=30000/1001','-t','0.501','-threads','1','-c:v','libx264','-crf','0','-pix_fmt','yuv420p',...(hdr?['-vf','setparams=color_trc=smpte2084','-color_trc','smpte2084']:[]),file]);}

test('quality video keeps source resolution, fractional frame rate, frame count and detail even with the performance flag',{skip:codecSkip,timeout:60_000},()=>fixture(async(converter,root)=>{
  const input=join(root,'input.mp4'),output=join(root,'output.mp4');generateVideo(input);
  const source=await readFile(input),before=hash(source),expected=probe(input),result=await converter.normalize({bytes:source,kind:'VIDEO',mime_type:'video/mp4',signal:signal(),performanceEnabled:true,preserveQuality:true,maxOutputBytes:H5_MEDIA_LIMITS.VIDEO});
  try{await writeFile(output,result.bytes);assert.deepEqual(probe(output),expected,'quality mode must not fall back to 720p, 24fps, or drop final frames');assert.ok(psnr(firstFrame(input),firstFrame(output))>=35,'decoded video detail remains at PSNR >=35 dB');assert.equal(hash(source),before);}
  finally{result.bytes.fill(0);}
}));

test('HDR video fails safely without changing source or leaving temporary output',{skip:codecSkip,timeout:60_000},()=>fixture(async(converter,root,temporaryRoot)=>{
  const input=join(root,'hdr.mp4');generateVideo(input,true);assert.equal(probe(input).transfer,'smpte2084');const source=await readFile(input),before=hash(source);
  await assert.rejects(converter.normalize({bytes:source,kind:'VIDEO',mime_type:'video/mp4',signal:signal(),preserveQuality:true}),{code:'YXX_MEDIA_HDR_CONVERSION_UNAVAILABLE'});
  assert.equal(hash(source),before);assert.deepEqual(await readdir(temporaryRoot),[]);assert.deepEqual(converter.ownedResourceState(),{active:0,processes:0,temporary_files:0});
}));
