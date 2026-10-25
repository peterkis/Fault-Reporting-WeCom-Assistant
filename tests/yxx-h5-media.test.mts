import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,link,unlink,symlink,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {once} from 'node:events';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createYxxH5MediaPrivateStore} from '../app/server/src/yxx-h5-media-store.mjs';
import {createYxxH5MediaWeCom} from '../app/server/src/yxx-h5-media-wecom.mjs';
import {createYxxH5MediaFFmpegTranscoder} from '../app/server/src/yxx-h5-media-transcode.mjs';
import {inspectMedia,H5_MEDIA_LIMITS} from '../app/server/src/yxx-h5-media-format.mjs';
import {collectYxxH5MediaBody} from '../app/server/src/yxx-h5-media.mjs';
import {createYxxH5MediaBudget} from '../app/server/src/yxx-h5-media-budget.mjs';
import type {H5MediaObject} from '../contracts/yxx_h5_media_contracts.js';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
const signal=()=>new AbortController().signal;
function asset(bytes:Buffer):H5MediaObject{return {media_ref:randomUUID(),variant:'ORIGINAL',kind:'IMAGE',mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
function wav(durationMs=400):Buffer{const size=Math.ceil(16000*durationMs/1000)*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b;}

for(const partial of [false,true])test(`caller abort closes a genuinely stalled Readable ${partial?'after collected bytes':'before its first byte'}`,{timeout:2000},async()=>{
 let reached=()=>{};const stalled=new Promise<void>(resolve=>{reached=resolve;});
 class StalledBody extends Readable {
  sent=false;reads=0;pending=0;maximumPending=0;returns=0;lastRead:Promise<unknown>|null=null;
  override _read(){if(partial&&!this.sent){this.sent=true;this.push(Buffer.from('private partial material'));}}
  override [Symbol.asyncIterator](){const iterator=super[Symbol.asyncIterator](),next=iterator.next.bind(iterator),finish=iterator.return?.bind(iterator);
   iterator.next=()=>{this.reads++;this.pending++;this.maximumPending=Math.max(this.maximumPending,this.pending);const result=next().finally(()=>{this.pending--;});this.lastRead=result;if(this.reads===(partial?2:1))reached();return result;};
   if(finish)iterator.return=async()=>{this.returns++;return finish();};return iterator;
  }
 }
 const body=new StalledBody(),closed=once(body,'close'),controller=new AbortController(),result=collectYxxH5MediaBody(body,1024,controller.signal);
 await stalled;controller.abort();await assert.rejects(result,{code:'YXX_MEDIA_UPLOAD_CANCELLED'});await closed;await body.lastRead?.catch(()=>{});
 assert.equal(body.destroyed,true);assert.equal(body.closed,true);assert.equal(body.pending,0);assert.equal(body.maximumPending,1);assert.equal(body.returns,1);assert.equal(body.reads,partial?2:1);
});

test('known uploads use an exact bounded buffer and reject short or longer declared content',async()=>{
 const original=Buffer.from('private material');const result=await collectYxxH5MediaBody(Readable.from([original.subarray(0,3),original.subarray(3)]),1024,signal(),original.length);assert.deepEqual(result,original);assert.equal(result.buffer.byteLength,original.length);result.fill(0);assert.equal(original.toString(),'private material','the caller retains its input ownership');
 await assert.rejects(collectYxxH5MediaBody(Readable.from([original]),1024,signal(),original.length+1),{code:'YXX_MEDIA_SIZE_MISMATCH'});
 await assert.rejects(collectYxxH5MediaBody(Readable.from([original]),1024,signal(),original.length-1),{code:'YXX_MEDIA_SIZE_MISMATCH'});
});

test('media budget releases disk before HTTP completion and enforces two leases, eight waiters and cancellation',async()=>{
 const budget=createYxxH5MediaBudget(),one=await budget.acquire({disk:true,read:true,bytes:1024},signal());one.releaseDisk();
 const two=await budget.acquire({disk:true,read:true,bytes:1024},signal());two.releaseDisk();assert.equal(budget.snapshot().read_leases,2);assert.equal(budget.snapshot().disk_operations,0);
 const controllers=Array.from({length:8},()=>new AbortController()),pending=controllers.map(controller=>budget.acquire({disk:true,read:true,bytes:1024},controller.signal));const outcomes=pending.map(result=>result.then(()=>false,()=>true));
 assert.equal(budget.snapshot().waiting,8);await assert.rejects(budget.acquire({disk:true,read:true,bytes:1},signal()),{code:'YXX_MEDIA_BUSY'});
 for(const controller of controllers)controller.abort();assert.deepEqual(await Promise.all(outcomes),Array(8).fill(true));assert.equal(budget.snapshot().waiting,0);
 one.release();one.release();two.release();budget.close();assert.deepEqual(budget.snapshot(),{disk_operations:0,read_leases:0,plaintext_reserved_bytes:0,waiting:0});
});

test('aggregate media plaintext reservations cannot exceed 32 MiB',async()=>{
 const budget=createYxxH5MediaBudget(),one=await budget.acquire({disk:true,read:true,bytes:20*1024*1024},signal());one.releaseDisk();let acquired=false;
 const pending=budget.acquire({disk:true,read:true,bytes:20*1024*1024},signal()).then(reservation=>{acquired=true;return reservation;});await Promise.resolve();assert.equal(acquired,false);assert.equal(budget.snapshot().waiting,1);one.release();const two=await pending;assert.equal(budget.snapshot().plaintext_reserved_bytes,20*1024*1024);two.release();budget.close();
});

test('private encrypted originals authenticate metadata and content before exposing plaintext',async()=>{
 const root=await mkdtemp(join(tmpdir(),'yxx-media-encrypted-')),key=randomBytes(32),store=createYxxH5MediaPrivateStore({root,key}),a=asset(PNG);
 try{await store.write(a,PNG,signal());const path=join(root,a.media_ref+'.original.asset'),ciphertext=await readFile(path);assert.equal(ciphertext.includes(PNG),false);const bytes=await store.read(a,signal());assert.deepEqual(bytes,PNG);bytes.fill(0);
  await assert.rejects(store.read({...a,mime_type:'image/jpeg'},signal()),{code:'YXX_MEDIA_INTEGRITY_FAILED'});ciphertext[ciphertext.length-1]=(ciphertext[ciphertext.length-1]??0)^1;await writeFile(path,ciphertext);await assert.rejects(store.read(a,signal()),{code:'YXX_MEDIA_INTEGRITY_FAILED'});assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
 }finally{await store.close();key.fill(0);await rm(root,{recursive:true,force:true});}
});
test('private storage rejects traversal, hardlinks, junction roots and aborted writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'yxx-media-links-')),key=randomBytes(32),store=createYxxH5MediaPrivateStore({root,key}),a=asset(PNG);
 try{await store.write(a,PNG,signal());await assert.rejects(store.read({...a,media_ref:'../x'},signal()),{code:'YXX_MEDIA_INPUT_INVALID'});const linked=join(root,'hardlink');await link(join(root,a.media_ref+'.original.asset'),linked);await assert.rejects(store.read(a,signal()),{code:'YXX_MEDIA_INTEGRITY_FAILED'});await unlink(linked);
  const redirected=root+'-junction';await symlink(root,redirected,'junction');const alias=createYxxH5MediaPrivateStore({root:redirected,key});try{await assert.rejects(alias.read(a,signal()),{code:'YXX_MEDIA_STORAGE_UNAVAILABLE'});}finally{await alias.close();await unlink(redirected);}
  const aborted=new AbortController();aborted.abort();await assert.rejects(store.write(asset(PNG),PNG,aborted.signal));assert.equal((await readdir(root)).length,1);assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
 }finally{await store.close();key.fill(0);await rm(root,{recursive:true,force:true});}
});
test('container checks refuse markup, damaged PNG and overlong actual AMR/WAV recordings',()=>{
 assert.equal(inspectMedia(PNG,'IMAGE','image/png'),null);assert.throws(()=>inspectMedia(Buffer.from('<html>secret</html>'),'IMAGE','image/png'),{code:'YXX_MEDIA_FORMAT_INVALID'});
 const damaged=Buffer.from(PNG);damaged[damaged.length-1]=(damaged[damaged.length-1]??0)^1;assert.throws(()=>inspectMedia(damaged,'IMAGE','image/png'),{code:'YXX_MEDIA_FORMAT_INVALID'});
 const amr=Buffer.concat([Buffer.from('#!AMR\n'),Buffer.alloc(13)]);amr[6]=4;assert.equal(inspectMedia(amr,'VOICE','audio/amr'),20);
 const long=Buffer.concat([Buffer.from('#!AMR\n'),...Array.from({length:3001},()=>amr.subarray(6))]);assert.throws(()=>inspectMedia(long,'VOICE','audio/amr'),{code:'YXX_MEDIA_DURATION_EXCEEDED'});assert.equal(inspectMedia(wav(),'VOICE','audio/wav'),400);assert.throws(()=>inspectMedia(wav(60_001),'VOICE','audio/wav'),{code:'YXX_MEDIA_DURATION_EXCEEDED'});const forged=wav(60_001);forged.writeUInt32LE(3200000,28);assert.throws(()=>inspectMedia(forged,'VOICE','audio/wav'),{code:'YXX_MEDIA_FORMAT_INVALID'});
});
test('official JS-SDK signatures cache corporate and agent tickets and never expose credentials',async()=>{
 const calls:URL[]=[],ticket='synthetic-ticket',token='synthetic-token';const fetchImpl:typeof fetch=async(input)=>{const url=new URL(String(input));calls.push(url);assert.equal(url.hostname,'qyapi.weixin.qq.com');return Response.json({errcode:0,ticket,expires_in:7200});};
 const provider=createYxxH5MediaWeCom({accessTokenProvider:async()=>token,publicOrigin:'https://h5.example.test',corpId:'corp-test',agentId:'100',fetchImpl,now:()=>1792440000000});
 try{const url='https://h5.example.test/wecom/yixiaoxiu/submit?x=1&y=2#fragment';const first=await provider.sign({url,signal:signal()}),second=await provider.sign({url,signal:signal()});assert.equal(calls.length,1);assert.equal(calls[0]?.pathname,'/cgi-bin/get_jsapi_ticket');assert.equal(first.signature,createHash('sha1').update('jsapi_ticket='+ticket+'&noncestr='+first.nonceStr+'&timestamp='+first.timestamp+'&url='+url.split('#')[0]).digest('hex'));assert.notEqual(first.nonceStr,second.nonceStr);assert.equal(JSON.stringify(first).includes(ticket),false);assert.equal(JSON.stringify(first).includes(token),false);
  await provider.sign({url,type:'AGENT',signal:signal()});assert.equal(calls[1]?.pathname,'/cgi-bin/ticket/get');assert.equal(calls[1]?.searchParams.get('type'),'agent_config');await assert.rejects(provider.sign({url:'https://foreign.example/wecom/yixiaoxiu/',signal:signal()}),{code:'YXX_MEDIA_INPUT_INVALID'});
 }finally{await provider.close();}
});
test('a cached JS-SDK signature does not contend with an in-flight external material download',async()=>{
 let release=()=>{},started=()=>{};const downloadStarted=new Promise<void>(resolve=>{started=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
 const provider=createYxxH5MediaWeCom({accessTokenProvider:async()=> 'synthetic-token',publicOrigin:'https://h5.example.test',corpId:'corp-test',agentId:'100',fetchImpl:async input=>{if(new URL(String(input)).pathname.endsWith('/media/get')){started();await hold;return new Response(new Uint8Array(PNG),{headers:{'content-length':String(PNG.length)}});}return Response.json({errcode:0,ticket:'synthetic-ticket',expires_in:7200});}});
 try{const signing={url:'https://h5.example.test/wecom/yixiaoxiu/',signal:signal()};await provider.sign(signing);const download=provider.download({kind:'IMAGE',serverId:'synthetic-media-id',signal:signal()});await downloadStarted;assert.match((await provider.sign(signing)).signature,/^[a-f0-9]{40}$/u);release();const result=await download;assert.deepEqual(result.bytes,PNG);result.bytes.fill(0);}finally{release();await provider.close();}
});
test('WeCom originals use fixed ordinary media endpoint, validate bytes and sanitize token failures',async()=>{
 const amr=Buffer.concat([Buffer.from('#!AMR\n'),Buffer.from([4]),Buffer.alloc(12)]),calls:URL[]=[];let fail=false,invalidated='';const credential=Object.assign(async()=> 'private-token-canary',{invalidate:(token:string)=>{invalidated=token;}});
 const fetchImpl:typeof fetch=async(input,init)=>{const url=new URL(String(input));calls.push(url);assert.equal(init?.redirect,'error');return fail?Response.json({errcode:42001,errmsg:'must not leak private-token-canary'}):new Response(new Uint8Array(amr),{headers:{'content-type':'audio/amr','content-length':String(amr.length)}});};
 const provider=createYxxH5MediaWeCom({accessTokenProvider:credential,publicOrigin:'https://h5.example.test',corpId:'corp-test',agentId:'100',fetchImpl});
 try{const result=await provider.download({kind:'VOICE',serverId:'opaque-server-id',signal:signal()});assert.deepEqual(result.bytes,amr);result.bytes.fill(0);assert.equal(calls[0]?.pathname,'/cgi-bin/media/get');assert.equal(calls[0]?.searchParams.get('media_id'),'opaque-server-id');fail=true;await assert.rejects(provider.download({kind:'VOICE',serverId:'opaque-server-id',signal:signal()}),(error:unknown)=>{assert.ok(error instanceof Error);assert.equal(error.message,'YXX_MEDIA_PROVIDER_UNAVAILABLE');assert.equal(error.message.includes('private-token-canary'),false);return true;});assert.equal(invalidated,'private-token-canary');
 }finally{await provider.close();}
});
test('failed JS-SDK ticket refreshes use a bounded cooldown instead of repeated provider calls',async()=>{
 let calls=0,now=1792440000000;const provider=createYxxH5MediaWeCom({accessTokenProvider:async()=> 'token',publicOrigin:'https://h5.example.test',corpId:'corp-test',agentId:'100',now:()=>now,fetchImpl:async()=>{calls++;return Response.json({errcode:50000,errmsg:'synthetic outage'});}});
 try{const input={url:'https://h5.example.test/wecom/yixiaoxiu/',signal:signal()};await assert.rejects(provider.sign(input),{code:'YXX_MEDIA_PROVIDER_UNAVAILABLE'});await assert.rejects(provider.sign(input),{code:'YXX_MEDIA_PROVIDER_UNAVAILABLE'});assert.equal(calls,1);now+=30_001;await assert.rejects(provider.sign(input),{code:'YXX_MEDIA_PROVIDER_UNAVAILABLE'});assert.equal(calls,2);}finally{await provider.close();}
});
test('oversized provider response is cancelled before full buffering',async()=>{
 let cancelled=false;const fetchImpl:typeof fetch=async()=>new Response(new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(H5_MEDIA_LIMITS.VOICE+1));},cancel(){cancelled=true;}}));
 const provider=createYxxH5MediaWeCom({accessTokenProvider:async()=> 'token',publicOrigin:'https://h5.example.test',corpId:'corp-test',agentId:'100',fetchImpl});
 try{await assert.rejects(provider.download({kind:'VOICE',serverId:'opaque',signal:signal()}),{code:'YXX_MEDIA_OVERSIZED'});assert.equal(cancelled,true);}finally{await provider.close();}
});
test('explicit FFmpeg port generates playable PCM and rejects actual recordings above 60 seconds',{skip:!process.env.H5_MEDIA_FFMPEG||!process.env.H5_MEDIA_FFPROBE?'NOT_RUN: explicit controlled FFmpeg pair unavailable':false},async()=>{
 const root=await mkdtemp(join(tmpdir(),'yxx-media-ffmpeg-'));await mkdir(join(root,'private'));const converter=createYxxH5MediaFFmpegTranscoder({ffmpegPath:resolve(process.env.H5_MEDIA_FFMPEG??''),ffprobePath:resolve(process.env.H5_MEDIA_FFPROBE??''),temporaryRoot:join(root,'private')});
 try{const pending=converter.normalize({bytes:wav(),kind:'VOICE',mime_type:'audio/wav',signal:signal()});await assert.rejects(converter.normalize({bytes:wav(),kind:'VOICE',mime_type:'audio/wav',signal:signal()}),{code:'YXX_MEDIA_BUSY'});const result=await pending;assert.equal(result.mime_type,'audio/wav');assert.ok(result.duration_ms>=399&&result.duration_ms<=401);assert.equal(result.bytes.toString('ascii',8,12),'WAVE');result.bytes.fill(0);assert.equal((await readdir(join(root,'private'))).length,0);
  const amr=Buffer.concat([Buffer.from('#!AMR\n'),Buffer.from([4]),Buffer.alloc(12)]),native=await converter.normalize({bytes:amr,kind:'VOICE',mime_type:'audio/amr',signal:signal()});assert.equal(native.mime_type,'audio/wav');assert.equal(native.bytes.toString('ascii',8,12),'WAVE');assert.ok(native.duration_ms>=20&&native.duration_ms<=21);native.bytes.fill(0);
  const synthetic=join(root,'synthetic-input.mp4'),generated=spawnSync(resolve(process.env.H5_MEDIA_FFMPEG??''),['-nostdin','-v','error','-f','lavfi','-i','color=c=black:s=64x48:r=10','-t','0.5','-threads','1','-c:v','libx264','-pix_fmt','yuv420p',synthetic],{windowsHide:true,timeout:10_000,maxBuffer:64*1024});assert.equal(generated.status,0);const video=await converter.normalize({bytes:await readFile(synthetic),kind:'VIDEO',mime_type:'video/mp4',signal:signal()});assert.equal(video.mime_type,'video/mp4');assert.equal(video.bytes.toString('ascii',4,8),'ftyp');assert.ok(video.duration_ms>=400&&video.duration_ms<=600);video.bytes.fill(0);
  const mobile=await converter.normalize({bytes:await readFile(synthetic),kind:'VIDEO',mime_type:'video/mp4',signal:signal(),performanceEnabled:true,maxOutputBytes:H5_MEDIA_LIMITS.playableVideo});assert.ok(mobile.bytes.length<=H5_MEDIA_LIMITS.playableVideo);const mobileFile=join(root,'mobile.mp4');await writeFile(mobileFile,mobile.bytes);const mobileProbe=spawnSync(resolve(process.env.H5_MEDIA_FFPROBE??''),['-v','error','-show_entries','stream=width,height,r_frame_rate','-of','json',mobileFile],{windowsHide:true,timeout:5000,maxBuffer:64*1024});assert.equal(mobileProbe.status,0);const mobileInfo:unknown=JSON.parse(mobileProbe.stdout.toString());assert.ok(mobileInfo&&typeof mobileInfo==='object'&&'streams' in mobileInfo&&Array.isArray(mobileInfo.streams));const mobileStream:unknown=mobileInfo.streams[0];assert.ok(mobileStream&&typeof mobileStream==='object'&&'width' in mobileStream&&'height' in mobileStream&&'r_frame_rate' in mobileStream);assert.ok(Number(mobileStream.width)<=720&&Number(mobileStream.height)<=720);assert.equal(mobileStream.r_frame_rate,'24/1');mobile.bytes.fill(0);
  const thumbnail=converter.thumbnail;assert.ok(thumbnail);const preview=await thumbnail({bytes:PNG,mime_type:'image/png',signal:signal()});assert.equal(preview.mime_type,'image/jpeg');assert.ok(preview.bytes.length<=H5_MEDIA_LIMITS.thumbnail);assert.equal(inspectMedia(preview.bytes,'IMAGE','image/jpeg'),null);preview.bytes.fill(0);
  const largeImage=join(root,'synthetic-large.png'),imageGenerated=spawnSync(resolve(process.env.H5_MEDIA_FFMPEG??''),['-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=2000x1600:r=1','-frames:v','1','-c:v','png','-threads','1',largeImage],{windowsHide:true,timeout:10_000,maxBuffer:64*1024});assert.equal(imageGenerated.status,0);const largePreview=await thumbnail({bytes:await readFile(largeImage),mime_type:'image/png',signal:signal()});assert.ok(largePreview.bytes.length<=H5_MEDIA_LIMITS.thumbnail);const previewFile=join(root,'preview.jpg');await writeFile(previewFile,largePreview.bytes);const imageProbe=spawnSync(resolve(process.env.H5_MEDIA_FFPROBE??''),['-v','error','-show_entries','stream=width,height','-of','json',previewFile],{windowsHide:true,timeout:5000,maxBuffer:64*1024});assert.equal(imageProbe.status,0);const imageInfo:unknown=JSON.parse(imageProbe.stdout.toString());assert.ok(imageInfo&&typeof imageInfo==='object'&&'streams' in imageInfo&&Array.isArray(imageInfo.streams));const imageStream:unknown=imageInfo.streams[0];assert.ok(imageStream&&typeof imageStream==='object'&&'width' in imageStream&&'height' in imageStream);assert.ok(Number(imageStream.width)<=960&&Number(imageStream.height)<=960);largePreview.bytes.fill(0);
  await assert.rejects(converter.normalize({bytes:wav(61_000),kind:'VOICE',mime_type:'audio/wav',signal:signal()}),{code:'YXX_MEDIA_DURATION_EXCEEDED'});assert.deepEqual(converter.ownedResourceState(),{active:0,processes:0,temporary_files:0});
 }finally{await converter.close();await rm(root,{recursive:true,force:true});}
});
