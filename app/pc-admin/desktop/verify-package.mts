import {listPackage,extractFile} from '@electron/asar';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {readConfig} from './policy.mjs';
const root=process.cwd(),release=path.join(root,'.local/electron/releases'),archive=path.join(release,'win-unpacked/resources/app.asar');
const framePaths=Array.from({length:68},(_,index)=>'startup-frames/'+String(index).padStart(3,'0')+'.webp');
const allowedFiles=['desktop.config.json','icon.ico','icon.png','main.mjs','package.json','policy.mjs','startup-state.mjs','preload.cjs','unavailable.html','chrome.html','login-chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs','startup.html','startup.css','startup.mjs','startup-preload.cjs','frame-playback.mjs','startup-video.mp4','startup-frames/manifest.json',...framePaths];
// ASAR reports directory entries too. Only this exact directory and its 69 files are admitted.
const allowed=[...allowedFiles,'startup-frames'];
const actual=listPackage(archive,{isPack:false}).map(file=>file.replaceAll('\\','/').replace(/^\//u,'')).sort();
if(JSON.stringify(actual)!==JSON.stringify([...allowed].sort()))throw Error('DESKTOP_PACKAGE_ALLOWLIST_MISMATCH:'+actual.filter(file=>!allowed.includes(file)).slice(0,5).join(','));
const config=readConfig(JSON.parse(extractFile(archive,'desktop.config.json').toString('utf8').replace(/^\uFEFF/u,'')) as unknown);
for(const file of ['main.mjs','policy.mjs','startup-state.mjs','preload.cjs','chrome.mjs','chrome-preload.cjs','startup.mjs','startup-preload.cjs','frame-playback.mjs']){
  if(!extractFile(archive,file).equals(readFileSync(path.join(root,'.local/electron/compiled',file))))throw Error('DESKTOP_PACKAGE_COMPILED_DRIFT:'+file);
}
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
for(const file of ['unavailable.html','chrome.html','login-chrome.html','chrome.css','startup.html','startup.css','startup-video.mp4','icon.ico','icon.png']){
  if(!extractFile(archive,file).equals(readFileSync(path.join(root,'app/pc-admin/desktop',file))))throw Error('DESKTOP_PACKAGE_SOURCE_DRIFT:'+file);
}
const sourceVideo=readFileSync(path.join(root,'app/pc-admin/desktop/startup-video.mp4')),packagedVideo=extractFile(archive,'startup-video.mp4');
const startupVideo={file:'startup-video.mp4',bytes:sourceVideo.length,sourceSha256:sha(sourceVideo),packageSha256:sha(packagedVideo)};
if(startupVideo.bytes!==350437||startupVideo.sourceSha256!=='0b52ad1a40dc473a6e6adce5b4ea2297f1ecf62ce73ec87e69d7e15eb5fea65b'||startupVideo.packageSha256!==startupVideo.sourceSha256)throw Error('DESKTOP_PACKAGE_STARTUP_VIDEO_MISMATCH');
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('DESKTOP_PACKAGE_FRAMES_MANIFEST_INVALID');return value as Record<string,unknown>;}
const frameDirectory=path.join(root,'app/pc-admin/desktop/startup-frames'),frameManifestFile='startup-frames/manifest.json';
if(lstatSync(frameDirectory).isSymbolicLink()||!lstatSync(frameDirectory).isDirectory())throw Error('DESKTOP_PACKAGE_FRAMES_SOURCE_REPARSE_REJECTED');
if(JSON.stringify(readdirSync(frameDirectory).sort())!==JSON.stringify(['manifest.json',...framePaths.map(file=>path.basename(file))].sort()))throw Error('DESKTOP_PACKAGE_FRAMES_SOURCE_INVENTORY_INVALID');
const sourceManifest=readFileSync(path.join(frameDirectory,'manifest.json')),packageManifest=extractFile(archive,frameManifestFile);
if(lstatSync(path.join(frameDirectory,'manifest.json')).isSymbolicLink()||!packageManifest.equals(sourceManifest))throw Error('DESKTOP_PACKAGE_FRAMES_MANIFEST_DRIFT');
const frameManifest=object(JSON.parse(sourceManifest.toString('utf8')) as unknown),frameSource=object(frameManifest.source),generator=object(frameManifest.generator);
if(frameManifest.schemaVersion!==1||frameManifest.width!==540||frameManifest.height!==540||frameManifest.frameCount!==68||frameManifest.fps!==30||frameManifest.durationSeconds!==68/30
  ||frameManifest.format!=='webp'||frameManifest.lossless!==true||frameSource.file!==startupVideo.file||frameSource.bytes!==startupVideo.bytes||frameSource.sha256!==startupVideo.sourceSha256
  ||!Array.isArray(frameManifest.frames)||frameManifest.frames.length!==68)throw Error('DESKTOP_PACKAGE_FRAMES_MANIFEST_INVALID');
const expectedArguments=['-hide_banner','-loglevel','error','-nostdin','-y','-i','startup-video.mp4','-map','0:v:0','-an','-map_metadata','-1',
  '-vf','scale=540:540:flags=lanczos','-c:v','libwebp','-lossless','1','-compression_level','6','-q:v','100','-pix_fmt','bgra','-threads:v','1',
  '-fps_mode','passthrough','-start_number','0','-frames:v','68','startup-frames/%03d.webp'];
if(generator.ffmpegVersion!=='ffmpeg version 9.0.2-essentials_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers'
  ||generator.ffprobeVersion!=='ffprobe version 9.0.2-essentials_build-www.gyan.dev Copyright (c) 2007-2026 the FFmpeg developers'
  ||JSON.stringify(generator.arguments)!==JSON.stringify(expectedArguments))throw Error('DESKTOP_PACKAGE_FRAMES_GENERATOR_INVALID');
let frameBytes=0;
for(const [index,file]of framePaths.entries()){
  const item=object(frameManifest.frames[index]),sourceFile=path.join(root,'app/pc-admin/desktop',file),info=lstatSync(sourceFile);
  const bytes=readFileSync(sourceFile),packaged=extractFile(archive,file);
  if(item.file!==file||item.bytes!==bytes.length||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/u.test(item.sha256)||!info.isFile()||info.isSymbolicLink()
    ||sha(bytes)!==item.sha256||sha(packaged)!==item.sha256||!packaged.equals(bytes))throw Error('DESKTOP_PACKAGE_FRAME_BYTES_MISMATCH:'+file);
  if(bytes.length<25||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,12)!=='WEBP'
    ||bytes.toString('ascii',12,16)!=='VP8L'||bytes[20]!==0x2f)throw Error('DESKTOP_PACKAGE_FRAME_FORMAT_INVALID:'+file);
  const dimensions=bytes.readUInt32LE(21);
  if((dimensions&0x3fff)+1!==540||((dimensions>>>14)&0x3fff)+1!==540||(dimensions>>>28)!==0)throw Error('DESKTOP_PACKAGE_FRAME_DIMENSIONS_INVALID:'+file);
  frameBytes+=bytes.length;
}
const startupFrames={manifest:frameManifestFile,sourceManifestSha256:sha(sourceManifest),packageManifestSha256:sha(packageManifest),frameCount:68,width:540,height:540,fps:30,frameBytes};
const packageInfo:unknown=JSON.parse(extractFile(archive,'package.json').toString('utf8').replace(/^\uFEFF/u,''));
if(!packageInfo||typeof packageInfo!=='object'||!('version' in packageInfo)||typeof packageInfo.version!=='string'||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(packageInfo.version))throw Error('DESKTOP_PACKAGE_VERSION_INVALID');
// Select the exact current version without requiring deletion of older rollback installers.
const file='Yixiaoxiu-Workbench-'+packageInfo.version+'-x64-Setup.exe';
if(!readdirSync(release).includes(file))throw Error('DESKTOP_EXACT_INSTALLER_REQUIRED');
const manifest={schemaVersion:1,serverOrigin:config.serverOrigin,installer:{file,bytes:readFileSync(path.join(release,file)).length,sha256:sha(readFileSync(path.join(release,file)))},asarSha256:sha(readFileSync(archive)),startupVideo,startupFrames,files:allowedFiles.map(file=>({file,sha256:sha(extractFile(archive,file))})),lockSha256:sha(readFileSync(path.join(root,'package-lock.json'))),signed:false};
writeFileSync(path.join(release,'desktop-build.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(path.join(release,file+'.sha256'),manifest.installer.sha256+'  '+file+'\n');
console.log(JSON.stringify(manifest));
