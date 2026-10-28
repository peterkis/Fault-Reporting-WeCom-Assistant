import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {withT16Fixture,T16_PNG} from './helpers/wbint-t16-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
async function clickReadyDownload(browser:Browser){
  if(!await browser.evaluate("Boolean(document.querySelector('.detail-media-dialog'))")){
    await browser.waitFor("document.querySelector('.detail-media-card')?.disabled===false");
    await browser.evaluate("document.querySelector('.detail-media-card').click()");
  }
  await browser.waitFor("Boolean(document.querySelector('.detail-media-dialog'))&&document.querySelector('.media-download')?.disabled===false");
  assert.equal(await browser.evaluate("(()=>{const button=document.querySelector('.media-download');if(!button||button.disabled)return false;button.click();return true;})()"),true,'the intended download button must be enabled and clicked');
}
test('production bundle displays a real authorized attachment and downloads actual stored bytes',async t=>{
  await withT16Fixture(async({origin,browserCookie,tickets,asset,save,pool,runtime,cookie})=>{
    const ticket=tickets[0];assert.ok(ticket);
    const shell=await fetch(origin+'/workbench/app/',{headers:{cookie}}),policy=shell.headers.get('content-security-policy')??'';assert.match(policy,/img-src 'self' blob:;/u);assert.match(policy,/media-src 'none';/u);assert.doesNotMatch(policy,/unsafe-inline|unsafe-eval/u);await shell.arrayBuffer();
    const directory=join(tmpdir(),'web01-ui-'+randomUUID()),downloads=await mkdtemp(join(tmpdir(),'t16-download-'));await mkdir(directory);
    let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,error:unknown;
    try{
      assert.equal(typeof browserCookie.url,'string');
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1920,height:1080,cookies:[{...browserCookie,url:browserCookie.url as string}]});
      assert.ok(browser,'owned browser must launch');
      await browser.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
      await browser.evaluate("(()=>{window.t16Urls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);window.t16Urls.add(url);return url;};URL.revokeObjectURL=url=>{window.t16Urls.delete(url);revoke(url);};return true;})()");
      await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
      await browser.waitFor("document.querySelector('.attachment-section h4')?.textContent==='附件 1'");
      await browser.waitFor("document.querySelector('.detail-media-card img')?.naturalWidth>0");
      await clickReadyDownload(browser);
      await browser.waitFor("document.querySelector('[data-toast-source=attachments]')?.textContent.includes('已交给浏览器下载')");
      let bytes:Buffer|undefined;const deadline=Date.now()+5000;
      while(Date.now()<deadline){try{bytes=await readFile(join(downloads,'report-attachment.png'));break;}catch{await new Promise(r=>setTimeout(r,25));}}
      assert.ok(bytes,'browser must persist the actual downloaded file');assert.deepEqual(bytes,T16_PNG);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      const shot=await browser.screenshot();assert.equal(typeof shot,'string');const pixels=Buffer.from(shot as string,'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,pixels);
      const pngShot={file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')};
      const data=await browser.evaluate("(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const context=canvas.getContext('2d');context.fillStyle='#5f7ee8';context.fillRect(0,0,2,2);return canvas.toDataURL('image/jpeg',0.8);})()");assert.equal(typeof data,'string');
      const jpeg=Buffer.from((data as string).split(',')[1]??'','base64'),jpegAsset={...asset,mime_type:'image/jpeg',byte_size:jpeg.length,sha256:createHash('sha256').update(jpeg).digest('hex')};await save([jpegAsset],jpeg);
      const registered=await fetch(origin+'/api/workbench/items/ticket/'+ticket.ticket.id+'/attachments',{headers:{cookie}});assert.equal(registered.status,200);assert.equal((await registered.json() as {items:{available:boolean}[]}).items[0]?.available,true,'a real browser-encoded JPEG must be supported');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:1080,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.media-refresh'))"),false);
      const oldDocument=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${oldDocument}&&document.querySelector('.detail-media-card img')?.naturalWidth>0`);
      await browser.evaluate("(()=>{window.t16Urls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);window.t16Urls.add(url);return url;};URL.revokeObjectURL=url=>{window.t16Urls.delete(url);revoke(url);};})()");
      await clickReadyDownload(browser);await browser.waitFor("document.querySelector('[data-toast-source=attachments]')?.textContent.includes('已交给浏览器下载')");
      let savedJpeg:Buffer|undefined;const jpegDeadline=Date.now()+5000;while(Date.now()<jpegDeadline){try{savedJpeg=await readFile(join(downloads,'report-attachment.jpg'));break;}catch{await new Promise(r=>setTimeout(r,25));}}
      assert.deepEqual(savedJpeg,jpeg);assert.ok(Number(await browser.evaluate('window.t16Urls.size'))<=2,'only the thumbnail and current preview remain');assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      const narrowPixels=Buffer.from(await browser.screenshot(),'base64'),narrowFile=join(directory,'new-detail-900.png');await writeFile(narrowFile,narrowPixels);
      const locker=await pool.connect(),target:{arrivals:number;finished:boolean;disconnected:boolean;response?:import('node:http').ServerResponse}={arrivals:0,finished:false,disconnected:false};let disconnected=false;
      const observe=(request:import('node:http').IncomingMessage,response:import('node:http').ServerResponse)=>{const url=new URL(request.url??'/',origin);if(request.method==='GET'&&url.pathname==='/api/attachments/'+asset.ref&&url.searchParams.get('kind')==='ticket'&&url.searchParams.get('id')===ticket.ticket.id){target.arrivals++;target.response=response;response.once('finish',()=>{target.finished=true;});response.once('close',()=>{target.disconnected=!response.writableEnded;});}};runtime.server.on('request',observe);
      try{await locker.query('BEGIN');const lockerPid=(await locker.query<{pid:number}>('SELECT pg_backend_pid()::integer AS pid')).rows[0]?.pid;assert.ok(lockerPid);
        await locker.query('LOCK TABLE intake.service_intake_message IN ACCESS EXCLUSIVE MODE');
        t.diagnostic('T16_TARGET_DOWNLOAD '+JSON.stringify({stage:'before-click',locker_pid:lockerPid,button:await browser.evaluate("(()=>{const button=document.querySelector('.media-download');return{exists:Boolean(button),disabled:button?.disabled??null};})()")}));
        await clickReadyDownload(browser);
        const blockedDeadline=Date.now()+5000;let blocked=false,waiterCount=0,targetPid:number|undefined;let lockEvidence:{pid:number;state:string;wait_event_type:string|null;wait_event:string|null;blocked_by_locker:boolean;source_query:boolean;query_sha256:string}[]=[];
        while(Date.now()<blockedDeadline){
          const observed=await pool.query<{pid:number;state:string;wait_event_type:string|null;wait_event:string|null;query:string;blockers:number[]}>(`SELECT activity.pid,activity.state,activity.wait_event_type,activity.wait_event,activity.query,pg_blocking_pids(activity.pid) AS blockers
            FROM pg_stat_activity activity WHERE activity.datname=current_database() AND EXISTS(SELECT 1 FROM pg_locks waiting
              WHERE waiting.pid=activity.pid AND waiting.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                AND waiting.relation='intake.service_intake_message'::regclass AND NOT waiting.granted) ORDER BY activity.pid`);
          waiterCount=observed.rows.length;lockEvidence=observed.rows.map(row=>({pid:row.pid,state:row.state,wait_event_type:row.wait_event_type,wait_event:row.wait_event,blocked_by_locker:row.blockers.includes(lockerPid),source_query:row.query.trimStart().startsWith('SELECT a.ref,'),query_sha256:createHash('sha256').update(row.query).digest('hex')}));
          const sourceWaiters=lockEvidence.filter(row=>row.source_query&&row.blocked_by_locker&&row.state==='active'&&row.wait_event_type==='Lock'&&row.wait_event==='relation');
          blocked=target.arrivals===1&&!target.finished&&!target.disconnected&&sourceWaiters.length===1;targetPid=blocked?sourceWaiters[0]?.pid:undefined;if(blocked)break;await new Promise(r=>setTimeout(r,25));
        }
        t.diagnostic('T16_TARGET_DOWNLOAD '+JSON.stringify({stage:'blocked',locker_pid:lockerPid,target_pid:targetPid??null,target_arrivals:target.arrivals,target_finished:target.finished,relation_waiter_count:waiterCount,blocked,waiters:lockEvidence}));
        assert.equal(blocked,true,'the actual attachment request must wait on its source relation held by this locker');assert.equal(target.arrivals,1);assert.equal(target.finished,false);assert.equal(target.disconnected,false);assert.ok(target.response);assert.equal(target.response.destroyed,false);assert.equal(target.response.headersSent,false,'the blocked read must not have emitted attachment headers or body');
        await browser.evaluate("document.querySelector('[aria-label=\"关闭附件预览\"]')?.click()");assert.equal(await browser.evaluate("(()=>{const button=document.querySelector('button[aria-label=\"关闭详情\"]');if(!button||button.disabled)return false;button.click();return true;})()"),true);await browser.waitFor("!document.querySelector('#detail-title')",{timeoutMs:5000});const closedDeadline=Date.now()+5000;while(!target.disconnected&&Date.now()<closedDeadline)await new Promise(r=>setTimeout(r,25));disconnected=target.disconnected;
        t.diagnostic('T16_TARGET_DOWNLOAD '+JSON.stringify({stage:'closed',target_arrivals:target.arrivals,target_finished:target.finished,disconnected,headers_sent:target.response.headersSent,writable_ended:target.response.writableEnded,destroyed:target.response.destroyed}));
        assert.equal(disconnected,true,'leaving the detail must abort its unfinished download');assert.equal(target.finished,false);assert.equal(target.response.writableEnded,false);assert.equal(target.response.destroyed,true);assert.equal(await browser.evaluate('window.t16Urls.size'),0);
      }finally{await locker.query('ROLLBACK');locker.release();runtime.server.off('request',observe);}
      assert.deepEqual((await readdir(downloads)).sort(),['report-attachment.jpg','report-attachment.png']);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_AUTHENTICATED_FILE',screenshots:[pngShot,{file:narrowFile,width:narrowPixels.readUInt32BE(16),height:narrowPixels.readUInt32BE(20),sha256:createHash('sha256').update(narrowPixels).digest('hex')}],downloads:[{mime_type:'image/png',byte_size:bytes.length,sha256:asset.sha256},{mime_type:'image/jpeg',byte_size:jpeg.length,sha256:jpegAsset.sha256}],unmount_aborted:disconnected,blob_urls:0}));
    }catch(failure){error=failure;try{if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await rm(downloads,{recursive:true,force:true});}],error);
  });
});
type T16Fixture=Parameters<Parameters<typeof withT16Fixture>[0]>[0];
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function withAttachmentBrowser(f:T16Fixture,run:(browser:Browser,directory:string)=>Promise<void>,reviewId?:string){
  const ticket=f.tickets[0];assert.ok(ticket);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,error:unknown;
  try{const cookie=f.browserCookie;assert.equal(typeof cookie.url,'string');browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/'+(reviewId?'review/'+reviewId:'ticket/'+ticket.ticket.id)+'?detail=page',width:1920,height:1080,cookies:[{...cookie,url:cookie.url as string}]});assert.ok(browser);await browser.waitFor("Boolean(document.querySelector('.attachment-section'))");await run(browser,directory);}
  catch(failure){error=failure;try{if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
}
async function shot(browser:Browser,directory:string){const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,pixels);console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_AUTHENTICATED_FILE',screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));}
const reread="[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='重试读取附件')?.click()";
const download="document.querySelector('.detail-media-card')?.click()";
const disabled="document.querySelector('.detail-media-card')?.disabled===true && [...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='重试读取附件')?.disabled===false";
test('production attachment UI reports disabled storage without reading it',async()=>{
  await withT16Fixture(async f=>withAttachmentBrowser(f,async(browser,directory)=>{
    const shell=await fetch(f.origin+'/workbench/app/',{headers:{cookie:f.cookie}});assert.doesNotMatch(shell.headers.get('content-security-policy')??'',/blob:|unsafe-inline|unsafe-eval/u);await shell.arrayBuffer();
    const hint='.attachment-unavailable-hint[aria-label="附件暂不可用"]';
    await browser.waitFor(`document.querySelector(${JSON.stringify(hint)})?.checkVisibility()===true`);
    await browser.evaluate(`document.querySelector(${JSON.stringify(hint)}).scrollIntoView({block:'center'})`);
    const point:unknown=await browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(hint)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    assert.ok(point&&typeof point==='object'&&'x' in point&&'y' in point&&typeof point.x==='number'&&typeof point.y==='number');
    await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1,pointerType:'mouse'});await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
    await browser.waitFor("[...document.querySelectorAll('[role=tooltip]')].some(node=>node.checkVisibility()&&node.textContent.includes('附件存储暂不可用'))");
    assert.deepEqual(f.reads,{entries:0,opens:0});assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-media-card'))"),false);await shot(browser,directory);
  }),{enabled:false});
});
test('real expiry, missing, oversized and HTML attachments stay unavailable and inactive identity clears the page',async()=>{
  await withT16Fixture(async f=>withAttachmentBrowser(f,async(browser,directory)=>{
    await browser.waitFor("document.querySelector('.detail-media-card')?.disabled===false");
    await f.save([{...f.asset,retention_until_epoch_ms:String(Date.now()-1)}]);await browser.evaluate(download);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('附件已超过保留期限') && "+disabled);
    await f.save([f.asset]);await unlink(join(f.root,f.asset.ref+'.asset'));await browser.evaluate(reread);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('已保存文件缺失') && "+disabled);
    await f.save([{...f.asset,byte_size:10*1024*1024+1}]);await browser.evaluate(reread);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('附件超过10 MiB限制') && "+disabled);
    const html=Buffer.from('<script>window.t16Canary=1</script>');await f.save([{...f.asset,byte_size:html.length,sha256:createHash('sha256').update(html).digest('hex')}],html);await browser.evaluate(reread);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('此文件格式不可用') && "+disabled);
    assert.equal(await browser.evaluate('typeof window.t16Canary'),'undefined');assert.equal(await browser.evaluate("document.querySelectorAll('.attachment-section iframe,.attachment-section object,.attachment-section script').length"),0);await shot(browser,directory);
    await f.save([f.asset]);await browser.evaluate(reread);await browser.waitFor("document.querySelector('.detail-media-card')?.disabled===false");
    await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[f.principals[0]?.id]);await browser.evaluate(download);await browser.waitFor("!document.querySelector('#detail-title') && !document.querySelector('.attachment-section') && !document.querySelector('.sidebar')");assert.equal(await browser.evaluate("document.body.textContent.includes('报修附件.png')"),false);
  }));
});
test('real parent scope loss fences cached detail and attachment download authority together',async()=>{
  await withT16Fixture(async f=>withAttachmentBrowser(f,async(browser,directory)=>{
    await browser.waitFor("document.querySelector('.detail-media-card')?.disabled===false");const principal=f.principals[0];assert.ok(principal);
    await f.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principal.id]);await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principal.id]);await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);const opens=f.reads.opens;
    await browser.evaluate(download);await browser.waitFor("!document.querySelector('#detail-title') && !document.querySelector('.attachment-section')");assert.equal(f.reads.opens,opens,'lost parent authority must not reopen saved bytes');assert.equal(await browser.evaluate("document.body.textContent.includes('报修附件.png')"),false);await shot(browser,directory);
  }));
});

test('attachment READ loss also clears the requested Review alias of its canonical Ticket',async()=>{
  await withT16Fixture(async f=>{
    const ticket=f.tickets[0],principal=f.principals[0];assert.ok(ticket&&principal);
    const review=(await f.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE linked_ticket_id=$1::uuid',[ticket.ticket.id])).rows[0];assert.ok(review);
    const response=await fetch(f.origin+'/api/workbench/items/review/'+review.id,{headers:{cookie:f.cookie}});assert.equal(response.status,200);
    const detail=await response.json() as {item:{kind:string;id:string};requested_item:{kind:string;id:string}};
    assert.deepEqual({kind:detail.item.kind,id:detail.item.id},{kind:'ticket',id:ticket.ticket.id});assert.deepEqual(detail.requested_item,{kind:'review',id:review.id});
    await withAttachmentBrowser(f,async browser=>{
      await browser.waitFor("document.querySelector('.detail-media-card img')?.naturalWidth>0");
      await f.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principal.id]);await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principal.id]);await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);
      await browser.evaluate(download);await browser.waitFor("!document.querySelector('#detail-title')&&!document.querySelector('.attachment-section')");
      assert.equal(await browser.evaluate("document.body.textContent.includes('仅供内部的合成处理记录')"),false);
    },review.id);
  },{manualReviewEnabled:true});
});
