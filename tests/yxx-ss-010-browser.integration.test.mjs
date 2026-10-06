import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {withSS009Database,closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import {runtimeFixture} from './helpers/yxx-ss-010-fixture.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {startLimitedRuntime} from '../src/yxx-limited-write-runner.mjs';
import {browser,post,eventually} from './helpers/yxx-ss-009-http-fixture.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';

test('SS011 single approved Reporter uses the real browser form supplement and logout',{timeout:90000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss010',run:async context=>{
    const setup=await runtimeFixture({...context,reporterAliases:['A']}),directory=mkdtempSync(path.join(tmpdir(),'ss011-browser-'));
    let fixture,runtime,tab,primaryError;
    try{
      fixture=await createYxxBrowserFixture({pool:context.pool,createApp:()=>createServer((request,response)=>{
        const url=new URL(request.url,'https://127.0.0.1');
        // The owned synthetic provider's UUID is translated to the limited role's A test code.
        if(url.pathname==='/wecom/yixiaoxiu/callback')url.searchParams.set('code','a');
        const outgoing=httpRequest({hostname:'127.0.0.1',port:setup.manifest.listen_port,path:url.pathname+url.search,method:request.method,headers:request.headers},incoming=>{
          response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
        });outgoing.on('error',()=>{response.writeHead(503);response.end();});request.pipe(outgoing);
      })});
      setup.manifest.public_origin=fixture.origin;
      runtime=await startLimitedRuntime({...setup,stateDirectory:directory,synthetic:true});
      context.observeResource('ss011_browser_process',()=>tab?.ownedResourceState().processes??0);
      context.observeResource('ss011_tls_listener',()=>fixture?.ownedResourceState().listeners??0);
      context.observeResource('ss011_roles',()=>[...runtime.children.values()].filter(child=>child.exitCode===null&&child.signalCode===null).length);
      tab=await fixture.launch({path:'/wecom/yixiaoxiu/',width:390,height:844});
      await tab.waitFor("document.querySelector('#home-view')?.hidden===false");
      await tab.evaluate("location.assign('/wecom/yixiaoxiu/reports/new')",{awaitPromise:false});
      await tab.waitFor("document.querySelector('#new-view')?.hidden===false");
      await tab.evaluate("document.querySelector('#description').value='系统不行';document.querySelector('#location-unknown').checked=true;document.querySelector('#submit-report').click()");
      await tab.waitFor("/^\\/wecom\\/yixiaoxiu\\/reports\\/[A-Za-z0-9_-]{32}$/.test(location.pathname)");
      await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('补充')");
      await tab.evaluate("document.querySelector('#supplement-text').value='这个问题一直没处理我要投诉';document.querySelector('#submit-supplement').click()");
      await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('人工')");
      const ref=await tab.evaluate('location.pathname.split("/").at(-1)');
      assert.equal(await tab.evaluate("fetch('/api/yixiaoxiu/requests/"+ref+"').then(r=>r.status)"),200);
      await tab.evaluate("document.querySelector('#logout').click()");
      await tab.waitFor("document.querySelector('#logout')?.hidden===true");
      assert.equal(await tab.evaluate("fetch('/api/yixiaoxiu/requests/"+ref+"').then(r=>r.status)"),401);
    }catch(error){primaryError=error;}finally{
      await closeSS009Resources([()=>tab?.close(),()=>fixture?.close(),()=>runtime?.stop(),()=>rmSync(directory,{recursive:true,force:true})],primaryError);
    }
  }});
});

test('SS010 AC093 real browser limited roles complete supplement review and safe member feedback',{timeout:180000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss010',run:async context=>{
    const setup=await runtimeFixture(context);let fixture,runtime,tab,primaryError;
    const screenshots=[];
    try{
      fixture=await createYxxBrowserFixture({pool:context.pool,createApp:()=>createServer((request,response)=>{
        const outgoing=httpRequest({hostname:'127.0.0.1',port:setup.manifest.listen_port,path:request.url,method:request.method,headers:request.headers},incoming=>{
          response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
        });outgoing.on('error',()=>{response.writeHead(503);response.end();});request.pipe(outgoing);
      })});
      setup.manifest.public_origin=fixture.origin;
      runtime=await startLimitedRuntime({...setup,stateDirectory:path.join(tmpdir(),'ss010-browser-'+randomUUID()),synthetic:true});
      tab=await fixture.launch({path:'/wecom/yixiaoxiu/',width:390,height:844});
      await tab.waitFor("document.querySelector('#home-view')?.hidden===false");
      await tab.evaluate("location.assign('/wecom/yixiaoxiu/reports/new')",{awaitPromise:false});
      await tab.waitFor("document.querySelector('#new-view')?.hidden===false");
      await tab.evaluate("document.querySelector('#description').value='系统不行';document.querySelector('#location-unknown').checked=true;document.querySelector('#submit-report').click()");
      await tab.waitFor("/^\\/wecom\\/yixiaoxiu\\/reports\\/[A-Za-z0-9_-]{32}$/.test(location.pathname)");
      await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('补充')");
      await tab.evaluate("document.querySelector('#supplement-text').value='这个问题一直没处理我要投诉';document.querySelector('#submit-supplement').click()");
      await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('人工')");
      const ref=await tab.evaluate('location.pathname.split("/").at(-1)');
      const review=await eventually(async()=>(await context.pool.query('SELECT r.id::text,r.row_version::text FROM intake.manual_review_item r JOIN intake.web_request_binding b ON b.intake_id=r.service_intake_id WHERE b.request_ref=$1',[ref])).rows[0]);
      const rawStaff=browser({address:()=>({port:runtime.port})},runtime.cookies[0]);
      const staff={request:(url,options={})=>rawStaff.request(url,{...options,headers:{...options.headers,host:'127.0.0.1:'+runtime.port,origin:'http://127.0.0.1:'+runtime.port}})};
      const csrf=(await staff.request('/api/lifecycle/bootstrap')).json().csrf_token;
      const result=await staff.request('/api/manual-reviews/'+review.id+'/resolve',post({client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'SS010_SYNTHETIC'},csrf));
      assert.equal(result.status,200,result.text);
      await tab.evaluate('location.reload()',{awaitPromise:false});await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('已生成工单')");
      const screenshotDirectory=join(tmpdir(),'ss010-ui-'+randomUUID());mkdirSync(screenshotDirectory,{recursive:true});
      for(const [width,height] of [[390,844],[1440,900]]){
        await tab.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
        assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
        const data=Buffer.from(await tab.screenshot(),'base64'),file=join(screenshotDirectory,randomUUID()+'.png');writeFileSync(file,data);
        screenshots.push({file,width,height,sha256:createHash('sha256').update(data).digest('hex')});
      }
      assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM intake.web_submission')).rows[0].n,2);
      context.observeResource('ss010_browser_process',()=>tab?.ownedResourceState().processes??0);
      context.observeResource('ss010_tls_listener',()=>fixture?.ownedResourceState().listeners??0);
      context.observeResource('ss010_roles',()=>[...runtime.children.values()].filter(child=>child.exitCode===null&&child.signalCode===null).length);
    }catch(error){primaryError=error;}finally{await closeSS009Resources([()=>tab?.close(),()=>fixture?.close(),()=>runtime?.stop()],primaryError);}
    t.diagnostic('SS010_BROWSER '+JSON.stringify({...g2EvidenceTime(),candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,screenshots,real_browser:true,real_postgres:true,external_network_calls:0}));
  }});
});
