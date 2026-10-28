import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {seedEmployeeMedia,paddedEmployeePng,observeEmployeeMediaHttp} from './helpers/employee-media-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {createYxxH5MediaFFmpegTranscoder} from '../app/server/src/yxx-h5-media-transcode.mjs';
import {migrateWorkbenchDisplayMedia} from '../app/server/scripts/workbench-display-media-migrate.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Sample {first_ms:number;all_ms:number;frame_ms:number;preview_bytes:number;preview_sql:number;preview_requests:number}
const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1]??0;
const skip=!process.env.PILOT_DATABASE_URL||!process.env.H5_MEDIA_FFMPEG||!process.env.H5_MEDIA_FFPROBE?'NOT_RUN: own PG18 and controlled FFmpeg required':false;

test('PC server posters and native media reduce same-data preview cost with old-route rollback',{skip,timeout:240000},async()=>{
 const ffmpeg=process.env.H5_MEDIA_FFMPEG,ffprobe=process.env.H5_MEDIA_FFPROBE;assert.ok(ffmpeg&&ffprobe);
 const directory=join(tmpdir(),'pc-media-preview-'+randomUUID());await mkdir(directory);const videoFile=join(directory,'synthetic.mp4');
 const generated=spawnSync(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=960x540:rate=24:duration=4','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-threads','1',videoFile],{windowsHide:true,timeout:20000});assert.equal(generated.status,0);
 const video=await readFile(videoFile),base=await sharp({create:{width:1280,height:720,channels:3,background:'#3c789c'}}).png().toBuffer(),picture=paddedEmployeePng(1024*1024,base);
 const materials=[...Array.from({length:6},()=>({bytes:picture,kind:'IMAGE' as const,mime:'image/png'})),{bytes:video,kind:'VIDEO' as const,mime:'video/mp4',duration:4000}];
 const results:{employee_read:boolean;samples:Sample[];first_p50:number;first_p95:number;all_p50:number;all_p95:number;frame_p50:number;frame_p95:number;screenshot:string}[]=[];
 try{for(const enabled of [false,true])await withDetailRestructureFixture(async f=>{
  if(!enabled)await migrateWorkbenchDisplayMedia({databaseUrl:f.databaseUrl,expectedDatabase:new URL(f.databaseUrl).pathname.slice(1),target:'previews',mode:'apply'});
  const converter=createYxxH5MediaFFmpegTranscoder({ffmpegPath:ffmpeg,ffprobePath:ffprobe,temporaryRoot:f.privateRoot}),seeded=await seedEmployeeMedia(f,materials,{transcoder:converter});
  let browser:Browser|undefined,failure:unknown;const observation=observeEmployeeMediaHttp(f),samples:Sample[]=[];
  try{
   for(let attempt=0;attempt<12;attempt++){if(!(await seeded.media.processNextTranscode()).processed)break;}
   const ready=await seeded.media.listForIntake({intakeId:seeded.intakeId,verifyCurrentRead:async()=>{}});assert.equal(ready.length,7);assert.ok(ready.every(item=>item.thumbnail?.status==='READY'));assert.equal(ready.at(-1)?.playback_status,'READY');
   const cookie=f.browserCookies[0];assert.ok(cookie?.url);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const active=browser;
   await active.command('Page.enable');
   await active.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__pcMediaTiming={start:performance.now(),first:null,all:null,frame:null};document.addEventListener('load',event=>{if(event.target?.matches?.('.detail-media-card img')){const t=globalThis.__pcMediaTiming;if(t.first===null)t.first=performance.now()-t.start;}},true);const check=()=>{const cards=[...document.querySelectorAll('.detail-media-card')];if(cards.length===7&&cards.every(card=>{const img=card.querySelector('img');return img?.complete&&img.naturalWidth>0;})){globalThis.__pcMediaTiming.all=performance.now()-globalThis.__pcMediaTiming.start;}else requestAnimationFrame(check);};requestAnimationFrame(check);})()`});
   for(let round=0;round<11;round++){
    const offset=observation.records.length;
    await active.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+seeded.ticketId+'?detail=page'});
    await active.waitFor('Boolean(document.querySelector(".detail-media-grid"))');await active.evaluate('document.querySelector(".detail-media-grid").scrollIntoView({block:"center"})');
    await active.waitFor('globalThis.__pcMediaTiming?.all!==null&&document.querySelectorAll(".detail-media-card img").length===7');
    const preview=observation.records.slice(offset).filter(record=>record.path.includes('/media/'));
    assert.equal(preview.length,7);assert.ok(preview.every(record=>record.status===200));
    if(enabled){assert.ok(preview.every(record=>record.path.includes('variant=THUMBNAIL')&&record.bytes<=160*1024));assert.ok(preview.every(record=>record.sqlAfterHeaders===0));}
    else assert.ok(preview.every(record=>record.path.includes('variant=PLAYABLE')));
    const beforeVideo=observation.records.length;
    await active.evaluate(`globalThis.__pcMediaClick=performance.now();document.addEventListener('playing',event=>{if(event.target?.tagName==='VIDEO')event.target.requestVideoFrameCallback(()=>{globalThis.__pcMediaTiming.frame=performance.now()-globalThis.__pcMediaClick;});},{once:true,capture:true});`);
    await clickWorkbenchControl(active,'.detail-media-card:has(.media-video-play)');
    await active.waitFor('globalThis.__pcMediaTiming?.frame!==null');
    if(enabled){assert.equal(await active.evaluate('document.querySelector("video").preload'),'none');assert.equal(await active.evaluate('new URL(document.querySelector("video").src).pathname.startsWith("/api/workbench/media/web/")'),true);assert.ok(observation.records.slice(beforeVideo).some(record=>record.path.includes('variant=PLAYABLE')&&record.range!==null));}
    else assert.equal(await active.evaluate('document.querySelector("video").src.startsWith("blob:")'),true);
    const timing:unknown=await active.evaluate('globalThis.__pcMediaTiming');assert.ok(timing&&typeof timing==='object'&&'first' in timing&&typeof timing.first==='number'&&'all' in timing&&typeof timing.all==='number'&&'frame' in timing&&typeof timing.frame==='number');
    if(round>0)samples.push({first_ms:timing.first,all_ms:timing.all,frame_ms:timing.frame,preview_bytes:preview.reduce((sum,row)=>sum+row.bytes,0),preview_sql:preview.reduce((sum,row)=>sum+row.sql.length,0),preview_requests:preview.length});
    await clickWorkbenchControl(active,'button[aria-label="关闭附件预览"]');await active.waitFor('!document.querySelector("video")');
   }
   const screenshot=join(directory,enabled?'employee-read.png':'legacy-read.png');await writeFile(screenshot,Buffer.from(await active.screenshot(),'base64'));
   results.push({employee_read:enabled,samples,first_p50:percentile(samples.map(s=>s.first_ms),.5),first_p95:percentile(samples.map(s=>s.first_ms),.95),all_p50:percentile(samples.map(s=>s.all_ms),.5),all_p95:percentile(samples.map(s=>s.all_ms),.95),frame_p50:percentile(samples.map(s=>s.frame_ms),.5),frame_p95:percentile(samples.map(s=>s.frame_ms),.95),screenshot});
  }catch(error){failure=error;if(browser){await writeFile(join(directory,enabled?'employee-failure.png':'legacy-failure.png'),Buffer.from(await browser.screenshot(),'base64')).catch(()=>{});await writeFile(join(directory,'browser-failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,timing:globalThis.__pcMediaTiming,media:[...document.querySelectorAll("video,audio")].map(v=>({ready:v.readyState,error:v.error?.code,src:v.getAttribute("src")}))})').catch(()=>null))).catch(()=>{});}}
  finally{observation.close();await closeBrowserTestResources([async()=>{await browser?.close();},()=>seeded.media.close()],failure);}
 },{employeeReadEnabled:enabled});
 const before=results[0],after=results[1];assert.ok(before&&after);await writeFile(join(directory,'comparison.json'),JSON.stringify({samples_per_mode:10,material_sha256:materials.map(item=>createHash('sha256').update(item.bytes).digest('hex')),results},null,2));
 console.log('PC_MEDIA_PREVIEWS '+JSON.stringify({directory,samples_per_mode:10,results}));
 assert.ok(after.first_p95<before.first_p95&&after.all_p95<before.all_p95,'same-data image preview p95 improves');assert.ok(after.frame_p95<before.frame_p95,'native first-frame p95 improves');
 }finally{await unlink(videoFile).catch(()=>{});}
});
