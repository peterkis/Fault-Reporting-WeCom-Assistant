import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import {createYxxH5Static} from '../app/server/src/yxx-h5-static.mjs';

test('Reporter browser retries incomplete ETag render after transient timeline failure for milestone addition and removal', {timeout:60000}, async()=>{
  const presentation=createYxxH5Static({enabled:true,reporter:{identityMode:'BOUND_ACCESS_SESSION',feedback:false}}),ref='S'.repeat(32);
  let version=1, milestones=[], failTimeline=false, timelineRequests=0;
  const detailHeaders=[];
  const server=createServer(async(req,res)=>{
    const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.url==='/api/reporter/bootstrap')return json({public_ref:ref});
    if(req.url==='/api/reporter/tickets/'+ref){
      const etag='"synthetic-'+version+'"';detailHeaders.push(req.headers['if-none-match']??null);
      if(req.headers['if-none-match']===etag){res.writeHead(304);return res.end();}
      res.setHeader('etag',etag);return json({public_ref:ref,version,title:'合成报修',ticket_no:'SYNTHETIC-001',suffix:'0001',external_status:'处理中',created_at:'2026-09-08 00:00:00',updated_at:'2026-09-08 00:00:00',guidance:'如未解决，请联系工作人员补充情况。',incident_milestones:milestones});
    }
    if(req.url==='/api/reporter/tickets/'+ref+'/timeline'){
      timelineRequests++;if(failTimeline){failTimeline=false;return json({},503);}
      return json({items:[{text:'合成处理记录',occurred_at:'2026-09-08 00:00:00'}],next_cursor:null});
    }
    if(req.url==='/reporter/')return presentation.page(res);
    if(await presentation.asset(new URL(req.url,'http://127.0.0.1'),res))return;
    res.writeHead(404);res.end();
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await launchSystemBrowser({url:'http://127.0.0.1:'+server.address().port+'/reporter/',width:390,height:844});
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.setInterval=(fn)=>{window.pollReporter=fn;return 1;};'});
    const beforeReload=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor('performance.timeOrigin!=='+beforeReload+'&&document.readyState==="complete"');
    await browser.waitFor("document.querySelector('#ticket').hidden===false&&typeof window.pollReporter==='function'");
    for(const added of [true,false]){
      const prior='"synthetic-'+version+'"';version++;
      milestones=added?[{text:'合成公共故障已关联',occurred_at:'2026-09-08 00:01:00'}]:[];
      failTimeline=true;const before=timelineRequests;
      await browser.evaluate('window.pollReporter()');
      assert.equal(await browser.evaluate("document.querySelector('#status').textContent.includes('重试')"),true);
      await browser.evaluate('window.pollReporter()');
      assert.deepEqual(detailHeaders.slice(-2),[prior,prior]);
      assert.equal(timelineRequests,before+2);
      assert.equal(await browser.evaluate("!!document.querySelector('#incident-milestones')"),added);
      assert.equal(await browser.evaluate("document.querySelector('#status').textContent.includes('已验证')"),true);
      await browser.evaluate('window.pollReporter()');
      assert.equal(detailHeaders.at(-1),'"synthetic-'+version+'"');
      assert.equal(timelineRequests,before+2,'successful render permits subsequent 304 without reloading timeline');
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
