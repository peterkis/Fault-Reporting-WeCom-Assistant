// Proposed destination: tests/workbench-detail-media.browser.test.mts.
// Requires DetailRestructureFixture.privateRoot/key and optional actorAvatarsEnabled/compressionEnabled.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import type {DetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createYxxH5Media} from '../app/server/src/yxx-h5-media.mjs';
import {createYxxH5MediaPrivateStore} from '../app/server/src/yxx-h5-media-store.mjs';
import {transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import type {YxxMemberScope} from '../app/server/src/yxx-self-service-authorization.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const storageMessage='附件存储暂不可用，当前无法读取原始文件。';
const storageHint='.attachment-unavailable-hint[aria-label="附件暂不可用"]';
const conversionHint='.attachment-unavailable-hint[aria-label="附件转换异常"]';
const visibleTooltip=(text:string)=>`[...document.querySelectorAll('[role=tooltip]')].some(node=>{const r=node.getBoundingClientRect();return node.textContent.includes(${JSON.stringify(text)})&&node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})`;

async function point(browser:Browser,selector:string){
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);
  const value:unknown=await browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  assert.ok(value&&typeof value==='object'&&'x' in value&&'y' in value&&typeof value.x==='number'&&typeof value.y==='number');return {x:value.x,y:value.y};
}
async function tooltipByPointerAndKeyboard(browser:Browser,selector:string,text:string,details:readonly string[]=[]){
  assert.equal(await browser.evaluate(visibleTooltip(text)),false,'tooltip text is not visibly present at rest');
  // Establish pointer modality before entering the trigger; a real mouse crosses
  // the page, while a first CDP teleport fires pointerenter before pointermove.
  await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1,pointerType:'mouse'});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(browser,selector)});
  await browser.waitFor(visibleTooltip(text));
  for(const detail of details)assert.equal(await browser.evaluate(visibleTooltip(detail)),true,'the hovered tooltip includes the actual conversion diagnostic');
  await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
  await browser.waitFor('!('+visibleTooltip(text)+')');
  // Put focus immediately before the trigger, then use a real keyboard Tab.
  await browser.evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)}),controls=[...document.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(node=>node.checkVisibility()&&!node.disabled&&node.tabIndex>=0),index=controls.indexOf(target);if(index<1)throw Error('TOOLTIP_KEYBOARD_PREDECESSOR_MISSING');controls[index-1].focus();})()`);
  await browser.pressTab();
  await browser.waitFor(`document.activeElement===document.querySelector(${JSON.stringify(selector)})&&(${visibleTooltip(text)})`);
  for(const detail of details)assert.equal(await browser.evaluate(visibleTooltip(detail)),true,'the keyboard tooltip includes the actual conversion diagnostic');
  await browser.pressTab();await browser.waitFor('!('+visibleTooltip(text)+')');
}
async function assertGeometry(browser:Browser,width:number){
  await browser.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await browser.evaluate(`(()=>{
    const fields=[...document.querySelectorAll('.detail-properties .property-field')],field=label=>fields.find(node=>node.querySelector('dt').textContent.trim()===label),box=label=>field(label).getBoundingClientRect();
    const location=box('位置'),phone=box('联系电话'),time=box('报修时间'),name=field('报修人');
    const noOverflow=document.documentElement.scrollWidth<=innerWidth&&fields.every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&node.scrollWidth<=node.clientWidth+1;});
    const placement=${width}>=960?phone.left>=location.right&&Math.abs(phone.top-location.top)<=1&&Math.abs(phone.left-time.left)<=1&&phone.bottom<=time.top+1:location.bottom<=phone.top+1&&phone.bottom<=time.top+1;
    return noOverflow&&placement&&!name.querySelector('.reporter-phone')&&document.querySelectorAll('.reporter-phone').length===1;
  })()`),true,`actual location/phone/report-time geometry and overflow at ${width}px`);
  assert.equal(await browser.evaluate("document.querySelector('.activity-title').textContent.trim()"),'处理记录','the detail heading has no loaded-count suffix');
}
async function failedOriginal(f:DetailRestructureFixture,intakeId:string){
  const row=(await f.pool.query<{scope_hash:string;corp:string;app:string;submission_id:string;request_ref:string;retention:string}>(`SELECT b.canonical_reporter_binding AS scope_hash,b.source_corp_scope AS corp,b.source_app_scope AS app,i.primary_web_submission_id::text AS submission_id,b.request_ref,b.retention_until_epoch_ms::text AS retention FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.intake_id=$1::uuid`,[intakeId])).rows[0];assert.ok(row);assert.match(row.scope_hash,/^[a-f0-9]{64}$/u);
  const scope:YxxMemberScope={scopeHash:row.scope_hash as YxxMemberScope['scopeHash'],sourceCorpScope:row.corp,sourceAppScope:row.app,proofRef:'synthetic-detail-media'};
  let attempts=0;const store=createYxxH5MediaPrivateStore({root:f.privateRoot,key:f.key}),media=createYxxH5Media({pool:f.pool,store,enabled:true,compressionEnabled:true,transcoder:{normalize:async()=>{throw Error('UNUSED_SYNTHETIC_NORMALIZER');},compressImage:async()=>{attempts++;throw Error('SYNTHETIC_IMAGE_CONVERSION_FAILED');},close:async()=>{},ownedResourceState:()=>({active:0,processes:0,temporary_files:0})}});
  try{
    const allow=async()=>{},reserved=await media.reserve({scope,input:{schema_version:1,client_command_id:randomUUID(),kind:'IMAGE',mime_type:'image/png',byte_size:PNG.length,duration_ms:null},verifyCurrentWrite:allow});
    await media.upload({scope,ref:reserved.media_ref,body:Readable.from([PNG]),verifyCurrentWrite:allow});
    await transactionP2016(f.pool,transaction=>media.claimInTransaction({transaction,scope,refs:[reserved.media_ref],intakeId,submissionId:row.submission_id,requestRef:row.request_ref,retentionUntilEpochMs:row.retention}));
    assert.deepEqual(await media.processNextTranscode(),{processed:true});assert.equal(attempts,1,'the real conversion worker path actually failed');
    const metadata=(await media.listForIntake({intakeId,verifyCurrentRead:allow}))[0];assert.ok(metadata);assert.equal(metadata.playback_status,'UNAVAILABLE');assert.ok(metadata.conversion_error);
    assert.equal(metadata.conversion_error.stage,'PLAYABLE');assert.match(metadata.conversion_error.at,/^\d{4}-\d{2}-\d{2} /u);
    const lease=await media.readForIntake({intakeId,ref:reserved.media_ref,verifyCurrentRead:allow,variant:'ORIGINAL'}),chunks:Buffer[]=[];
    try{for await(const chunk of lease.stream)chunks.push(Buffer.from(chunk));assert.deepEqual(Buffer.concat(chunks),PNG);}finally{await lease.close();}
    return {ref:reserved.media_ref,error:metadata.conversion_error};
  }finally{await media.close();assert.deepEqual(media.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});}
}

test('detail phone geometry, storage tooltip, cached avatars and failed-conversion originals remain usable',{timeout:240_000},()=>withDetailRestructureFixture(async f=>{
  const first=f.tickets[0],missing=f.tickets[1],principal=f.principals[0],cookie=f.browserCookies[0];assert.ok(first&&missing&&principal&&cookie?.url);
  const http=await t11Http(f);await http.start(first.ticket.id);
  const avatar=await sharp({create:{width:64,height:64,channels:3,background:'#2970a3'}}).webp().toBuffer();
  const identity=(await f.pool.query<{wecom_user_id:string}>('SELECT wecom_user_id FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[principal.id])).rows[0];assert.ok(identity);
  await f.pool.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO workbench.actor_avatar_cache(principal_id,identity_hash,status,avatar_bytes,avatar_sha256,error_code,attempted_epoch_ms,expires_epoch_ms) SELECT $1::uuid,$2,'READY',$3,$4,NULL,epoch,epoch+600000 FROM stamp`,[principal.id,hash(identity.wecom_user_id),avatar,hash(avatar)]);
  const avatarResponse=await http.get('/api/workbench/items/ticket/'+first.ticket.id+'/actor-avatars/'+principal.id);assert.equal(avatarResponse.status,200);assert.equal(avatarResponse.headers.get('content-type'),'image/webp');assert.deepEqual(Buffer.from(await avatarResponse.arrayBuffer()),avatar);
  const directory=join(tmpdir(),'detail-media-browser-'+randomUUID()),downloads=join(directory,'downloads');await mkdir(downloads,{recursive:true});
  let browser:Browser|undefined,failure:unknown;const screenshots:{width:number;file:string;sha256:string}[]=[];
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const active=browser;
    await browser.command('Page.enable');await browser.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__detailMediaDocument=location.pathname;globalThis.__detailMediaReads=[];globalThis.fetch=async(url,options)=>{const parsed=new URL(String(url),location.href);if((options?.method??'GET')==='GET'&&/^\\/api\\/tickets\\/[0-9a-f-]+\\/reporter-contact$/.test(parsed.pathname))return new Response(JSON.stringify({contact:{mobile:'13800000000'}}),{headers:{'content-type':'application/json'}});const response=await original(url,options);if(parsed.pathname.includes('/actor-avatars/')||parsed.pathname.includes('/web-report/media/'))globalThis.__detailMediaReads.push({path:parsed.pathname,variant:parsed.searchParams.get('variant'),status:response.status});return response;};})()`});
    const navigate=async(id:string)=>{await active.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id+'?detail=page'});await active.waitFor(`location.pathname.endsWith(${JSON.stringify(id)})&&globalThis.__detailMediaDocument===location.pathname&&document.querySelector('.reporter-phone')?.textContent==='138-0000-0000'&&!document.querySelector('.report-materials .detail-loading')&&Boolean(document.querySelector('.activity-title'))`);};
    await navigate(first.ticket.id);
    await browser.waitFor("[...document.querySelectorAll('.record-avatar img')].some(img=>img.checkVisibility({checkOpacity:true})&&img.complete&&img.naturalWidth===64)");
    assert.equal(await browser.evaluate(`globalThis.__detailMediaReads.filter(row=>row.path.endsWith('/actor-avatars/'+${JSON.stringify(principal.id)})).length`),1,'multiple records for the same actor share one avatar read');
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.record-avatar img')].filter(img=>img.complete&&img.naturalWidth>0).every(img=>img.src.startsWith('blob:'))"),true,'the browser consumes the authenticated same-origin image bytes');
    for(const width of [1280,960,390]){await assertGeometry(browser,width);const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'detail-media-'+width+'.png');await writeFile(file,pixels);screenshots.push({width,file,sha256:hash(pixels)});}
    await browser.command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await navigate(missing.ticket.id);
    await browser.waitFor("globalThis.__detailMediaReads.some(row=>row.path.includes('/actor-avatars/')&&row.status===204)");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.detail-record')].some(row=>{const fallback=row.querySelector('.record-avatar [data-slot=avatar-fallback]'),name=row.querySelector('.record-name');return fallback?.checkVisibility({checkOpacity:true})&&fallback.textContent===Array.from(name.textContent)[0]&&!row.querySelector('.record-avatar img');})"),true,'missing cached image visibly falls back to the actor initial');
    await navigate(f.botTicketId);await browser.waitFor(`document.querySelector(${JSON.stringify(storageHint)})?.checkVisibility()===true`);
    assert.equal(await browser.evaluate("document.querySelector('.detail-attachments h4>span').textContent"),'0');
    assert.equal(await browser.evaluate(`(()=>{const hint=document.querySelector(${JSON.stringify(storageHint)}),count=hint.closest('h4').querySelector(':scope>span'),h=hint.getBoundingClientRect(),c=count.getBoundingClientRect();return !!hint.querySelector('svg.lucide-cloud-off')&&h.left>=c.right&&h.left-c.right<=20&&Math.abs((h.top+h.height/2)-(c.top+c.height/2))<=4;})()`),true,'CloudOff is immediately right of the zero count');
    assert.equal(await browser.evaluate(`!!document.querySelector('.detail-attachments .media-empty')||document.querySelector('.detail-attachments').innerText.includes(${JSON.stringify(storageMessage)})`),false,'no permanent storage-error paragraph remains');
    await tooltipByPointerAndKeyboard(browser,storageHint,storageMessage);
    const failed=await failedOriginal(f,first.intake.intakeId);await navigate(first.ticket.id);
    await browser.waitFor("document.querySelector('.detail-media-card img')?.naturalWidth>0&&document.querySelector('[aria-label=\"附件转换异常\"]')?.checkVisibility()===true");
    assert.equal(await browser.evaluate("document.querySelector('.detail-attachments h4>span').textContent"),'1');
    await tooltipByPointerAndKeyboard(browser,conversionHint,'原始文件已保存',[failed.error.code,failed.error.at]);
    await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    await clickWorkbenchControl(browser,'.detail-media-card');await browser.waitFor("document.querySelector('.detail-media-dialog img')?.naturalWidth>0");
    await clickWorkbenchControl(browser,'.detail-media-dialog .media-download');
    const file=join(downloads,'report-material.png');let downloaded:Buffer|undefined;const deadline=Date.now()+5000;
    while(Date.now()<deadline){try{downloaded=await readFile(file);break;}catch{await delay(50);}}
    assert.deepEqual(downloaded,PNG,'browser download retains the exact original after conversion failure');
    assert.equal(await browser.evaluate(`(()=>{const reads=globalThis.__detailMediaReads.filter(row=>row.path.endsWith('/web-report/media/'+${JSON.stringify(failed.ref)}));return reads.length>=3&&reads.every(row=>row.variant==='ORIGINAL'&&row.status===200);})()`),true,'thumbnail, preview and download all request the retained ORIGINAL');
    await clickWorkbenchControl(browser,'[aria-label="关闭附件预览"]');
    console.log('DETAIL_MEDIA '+JSON.stringify({viewports:[1280,960,390],phone_geometry:true,tooltip_hover_and_keyboard:true,no_record_count:true,cached_avatar_image:true,missing_avatar_fallback:true,conversion_failure_recorded:true,original_preview:true,original_download_sha256:hash(PNG),screenshots}));
  }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({path:location.pathname,text:document.body.innerText,reads:globalThis.__detailMediaReads,tooltips:[...document.querySelectorAll("[role=tooltip]")].map(node=>({text:node.textContent,box:node.getBoundingClientRect().toJSON(),display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,opacity:getComputedStyle(node).opacity})),hints:[...document.querySelectorAll(".attachment-unavailable-hint")].map(node=>node.outerHTML)})')));}}catch(diagnostic){failure=new AggregateError([error,diagnostic]);}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{actorAvatarsEnabled:true,compressionEnabled:true}));
