import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {withT16Fixture,T16_PNG} from './helpers/wbint-t16-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
test('production bundle displays a real authorized attachment and downloads actual stored bytes',async()=>{
  await withT16Fixture(async({origin,browserCookie,tickets,asset})=>{
    const ticket=tickets[0];assert.ok(ticket);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID()),downloads=await mkdtemp(join(tmpdir(),'t16-download-'));await mkdir(directory);
    let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.ticket.id+'?detail=page',width:1920,height:1080,cookies:[browserCookie]});
      await browser.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
      await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
      assert.equal(await browser.evaluate("document.querySelector('.attachment-section h3')?.textContent"),'报修附件');
      await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('报修附件.png')");
      await browser.evaluate("[...document.querySelectorAll('.attachment-section button')].find(button=>button.textContent==='下载')?.click()");
      await browser.waitFor("document.querySelector('.attachment-section')?.textContent.includes('已交给浏览器下载')");
      let bytes:Buffer|undefined;const deadline=Date.now()+5000;
      while(Date.now()<deadline){try{bytes=await readFile(join(downloads,'report-attachment.png'));break;}catch{await new Promise(r=>setTimeout(r,25));}}
      assert.ok(bytes,'browser must persist the actual downloaded file');assert.deepEqual(bytes,T16_PNG);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      const shot=await browser.screenshot();assert.equal(typeof shot,'string');const pixels=Buffer.from(shot as string,'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,pixels);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_AUTHENTICATED_FILE',screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}],download:{byte_size:bytes.length,sha256:asset.sha256}}));
    }catch(failure){error=failure;if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await rm(downloads,{recursive:true,force:true});}],error);
  });
});
