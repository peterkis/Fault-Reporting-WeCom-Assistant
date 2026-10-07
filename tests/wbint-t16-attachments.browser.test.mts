import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {withT16Fixture,T16_PNG} from './helpers/wbint-t16-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
test('production bundle displays a real authorized attachment and downloads actual stored bytes',async()=>{
  await withT16Fixture(async({origin,browserCookie,tickets,asset,save,pool,runtime,cookie})=>{
    const ticket=tickets[0];assert.ok(ticket);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID()),downloads=await mkdtemp(join(tmpdir(),'t16-download-'));await mkdir(directory);
    let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,error:unknown;
    try{
      assert.equal(typeof browserCookie.url,'string');
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1920,height:1080,cookies:[{...browserCookie,url:browserCookie.url as string}]});
      assert.ok(browser,'owned browser must launch');
      await browser.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
      await browser.evaluate("(()=>{window.t16Urls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);window.t16Urls.add(url);return url;};URL.revokeObjectURL=url=>{window.t16Urls.delete(url);revoke(url);};return true;})()");
      await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
      assert.equal(await browser.evaluate("document.querySelector('.attachment-section h3')?.textContent"),'报修附件');
      await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('报修附件.png')");
      await browser.evaluate("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.click()");
      await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('已交给浏览器下载')");
      let bytes:Buffer|undefined;const deadline=Date.now()+5000;
      while(Date.now()<deadline){try{bytes=await readFile(join(downloads,'report-attachment.png'));break;}catch{await new Promise(r=>setTimeout(r,25));}}
      assert.ok(bytes,'browser must persist the actual downloaded file');assert.deepEqual(bytes,T16_PNG);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      const shot=await browser.screenshot();assert.equal(typeof shot,'string');const pixels=Buffer.from(shot as string,'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,pixels);
      const pngShot={file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')};
      const data=await browser.evaluate("(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const context=canvas.getContext('2d');context.fillStyle='#5f7ee8';context.fillRect(0,0,2,2);return canvas.toDataURL('image/jpeg',0.8);})()");assert.equal(typeof data,'string');
      const jpeg=Buffer.from((data as string).split(',')[1]??'','base64'),jpegAsset={...asset,mime_type:'image/jpeg',byte_size:jpeg.length,sha256:createHash('sha256').update(jpeg).digest('hex')};await save([jpegAsset],jpeg);
      const registered=await fetch(origin+'/api/workbench/items/ticket/'+ticket.ticket.id+'/attachments',{headers:{cookie}});assert.equal(registered.status,200);assert.equal((await registered.json() as {items:{available:boolean}[]}).items[0]?.available,true,'a real browser-encoded JPEG must be supported');
      await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:1080,deviceScaleFactor:1,mobile:false});
      await browser.evaluate("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='重新读取附件')?.click()");await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('报修附件.jpg')");
      await browser.evaluate("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.click()");await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('已交给浏览器下载')");
      let savedJpeg:Buffer|undefined;const jpegDeadline=Date.now()+5000;while(Date.now()<jpegDeadline){try{savedJpeg=await readFile(join(downloads,'report-attachment.jpg'));break;}catch{await new Promise(r=>setTimeout(r,25));}}
      assert.deepEqual(savedJpeg,jpeg);assert.equal(await browser.evaluate('window.t16Urls.size'),0);assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      const narrowPixels=Buffer.from(await browser.screenshot(),'base64'),narrowFile=join(directory,'new-detail-900.png');await writeFile(narrowFile,narrowPixels);
      const locker=await pool.connect();let disconnected=false;const observe=(request:import('node:http').IncomingMessage,response:import('node:http').ServerResponse)=>{if(request.url?.startsWith('/api/attachments/'))response.once('close',()=>{disconnected=true;});};runtime.server.on('request',observe);
      try{await locker.query('BEGIN');await locker.query('LOCK TABLE intake.service_intake_message IN ACCESS EXCLUSIVE MODE');await browser.evaluate("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.click()");
        const blockedDeadline=Date.now()+5000;let blocked=false;while(Date.now()<blockedDeadline){blocked=(await pool.query<{count:number}>("SELECT count(*)::integer AS count FROM pg_locks WHERE relation='intake.service_intake_message'::regclass AND NOT granted")).rows[0]?.count===1;if(blocked)break;await new Promise(r=>setTimeout(r,25));}assert.equal(blocked,true);
        await browser.evaluate("document.querySelector('button[aria-label=\"关闭详情\"]')?.click()");await browser.waitFor("!document.querySelector('#detail-title')");const closedDeadline=Date.now()+5000;while(!disconnected&&Date.now()<closedDeadline)await new Promise(r=>setTimeout(r,25));assert.equal(disconnected,true,'leaving the detail must abort its unfinished download');assert.equal(await browser.evaluate('window.t16Urls.size'),0);
      }finally{await locker.query('ROLLBACK');locker.release();runtime.server.off('request',observe);}
      assert.deepEqual((await readdir(downloads)).sort(),['report-attachment.jpg','report-attachment.png']);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_AUTHENTICATED_FILE',screenshots:[pngShot,{file:narrowFile,width:narrowPixels.readUInt32BE(16),height:narrowPixels.readUInt32BE(20),sha256:createHash('sha256').update(narrowPixels).digest('hex')}],downloads:[{mime_type:'image/png',byte_size:bytes.length,sha256:asset.sha256},{mime_type:'image/jpeg',byte_size:jpeg.length,sha256:jpegAsset.sha256}],unmount_aborted:disconnected,blob_urls:0}));
    }catch(failure){error=failure;if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await rm(downloads,{recursive:true,force:true});}],error);
  });
});
type T16Fixture=Parameters<Parameters<typeof withT16Fixture>[0]>[0];
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function withAttachmentBrowser(f:T16Fixture,run:(browser:Browser,directory:string)=>Promise<void>){
  const ticket=f.tickets[0];assert.ok(ticket);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,error:unknown;
  try{const cookie=f.browserCookie;assert.equal(typeof cookie.url,'string');browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1920,height:1080,cookies:[{...cookie,url:cookie.url as string}]});assert.ok(browser);await browser.waitFor("Boolean(document.querySelector('.attachment-section'))");await run(browser,directory);}
  catch(failure){error=failure;if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
}
async function shot(browser:Browser,directory:string){const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,pixels);console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_AUTHENTICATED_FILE',screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));}
const reread="[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='重新读取附件')?.click()";
const download="[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.click()";
const disabled="[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.disabled===true && [...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='重新读取附件')?.disabled===false";
test('production attachment UI reports disabled storage without reading it',async()=>{
  await withT16Fixture(async f=>withAttachmentBrowser(f,async(browser,directory)=>{
    await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('附件存储暂不可用')");assert.deepEqual(f.reads,{entries:0,opens:0});assert.equal(await browser.evaluate("[...document.querySelectorAll('.attachment-section button')].some(button=>button.textContent==='下载')"),false);await shot(browser,directory);
  }),{enabled:false});
});
test('real expiry, missing, oversized and HTML attachments stay unavailable and inactive identity clears the page',async()=>{
  await withT16Fixture(async f=>withAttachmentBrowser(f,async(browser,directory)=>{
    await browser.waitFor("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.disabled===false");
    await f.save([{...f.asset,retention_until_epoch_ms:String(Date.now()-1)}]);await browser.evaluate(download);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('附件已超过保留期限') && "+disabled);
    await f.save([f.asset]);await unlink(join(f.root,f.asset.ref+'.asset'));await browser.evaluate(reread);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('已保存文件缺失') && "+disabled);
    await f.save([{...f.asset,byte_size:10*1024*1024+1}]);await browser.evaluate(reread);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('附件超过10 MiB限制') && "+disabled);
    const html=Buffer.from('<script>window.t16Canary=1</script>');await f.save([{...f.asset,byte_size:html.length,sha256:createHash('sha256').update(html).digest('hex')}],html);await browser.evaluate(reread);await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('此文件格式不可用') && "+disabled);
    assert.equal(await browser.evaluate('typeof window.t16Canary'),'undefined');assert.equal(await browser.evaluate("document.querySelectorAll('.attachment-section iframe,.attachment-section object,.attachment-section script').length"),0);await shot(browser,directory);
    await f.save([f.asset]);await browser.evaluate(reread);await browser.waitFor("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.disabled===false");
    await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[f.principals[0]?.id]);await browser.evaluate(download);await browser.waitFor("!document.querySelector('#detail-title') && !document.querySelector('.attachment-section') && !document.querySelector('.sidebar')");assert.equal(await browser.evaluate("document.body.textContent.includes('报修附件.png')"),false);
  }));
});
test('real parent scope loss fences cached detail and attachment download authority together',async()=>{
  await withT16Fixture(async f=>withAttachmentBrowser(f,async(browser,directory)=>{
    await browser.waitFor("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.disabled===false");const principal=f.principals[0];assert.ok(principal);
    await f.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principal.id]);await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principal.id]);await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);const opens=f.reads.opens;
    await browser.evaluate(download);await browser.waitFor("!document.querySelector('#detail-title') && !document.querySelector('.attachment-section')");assert.equal(f.reads.opens,opens,'lost parent authority must not reopen saved bytes');assert.equal(await browser.evaluate("document.body.textContent.includes('报修附件.png')"),false);await shot(browser,directory);
  }));
});
