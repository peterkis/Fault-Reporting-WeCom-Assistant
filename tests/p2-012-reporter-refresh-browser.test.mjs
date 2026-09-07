import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';

test('Reporter browser retries incomplete ETag render after transient timeline failure for milestone addition and removal', {timeout:60000}, async()=>{
  const assets=new Map(await Promise.all(['index.html','reporter.js','reporter.css'].map(async name=>[name,await readFile(new URL('../web/p2-reporter/'+name,import.meta.url),'utf8')])));
  let version=1, milestones=[], failTimeline=false, timelineRequests=0;
  const detailHeaders=[];
  const server=createServer((req,res)=>{
    const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.url==='/api/reporter/bootstrap')return json({public_ref:'synthetic-ref'});
    if(req.url==='/api/reporter/tickets/synthetic-ref'){
      const etag='"synthetic-'+version+'"';detailHeaders.push(req.headers['if-none-match']??null);
      if(req.headers['if-none-match']===etag){res.writeHead(304);return res.end();}
      res.setHeader('etag',etag);return json({title:'合成报修',ticket_no:'SYNTHETIC-001',suffix:'0001',external_status:'处理中',created_at:'2026-09-08 00:00:00',updated_at:'2026-09-08 00:00:00',incident_milestones:milestones});
    }
    if(req.url==='/api/reporter/tickets/synthetic-ref/timeline'){
      timelineRequests++;if(failTimeline){failTimeline=false;return json({},503);}
      return json({items:[{text:'合成处理记录',occurred_at:'2026-09-08 00:00:00'}],next_cursor:null});
    }
    const name=req.url==='/reporter/'?'index.html':req.url?.split('/').at(-1);
    if(!assets.has(name)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
    // Capture the real production polling callback so failures/retries are deterministic.
    res.end(name==='index.html'?assets.get(name).replace('<script type="module"','<script>window.setInterval=(fn)=>{window.pollReporter=fn;return 1;};</script><script type="module"'):assets.get(name));
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await launchSystemBrowser({url:'http://127.0.0.1:'+server.address().port+'/reporter/',width:390,height:844});
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
