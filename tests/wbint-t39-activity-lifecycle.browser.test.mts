import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {WorkbenchActivityView} from '../contracts/workbench_activity_contracts.js';

type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {origin:string;backendOrigin:string;certificateSpki:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];principals:{id:string}[];pool:PostgresPool;runtime:{observability:{metrics:()=>Promise<{sse_clients:number}>}}}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function people(origin:string,cookie:string,id:string){const response=await fetch(origin+'/api/workbench/items/ticket/'+id+'/activity',{headers:{cookie}});assert.equal(response.status,200);return (await response.json() as WorkbenchActivityView).people;}
async function waitPeople(origin:string,cookie:string,id:string,present:boolean){const until=Date.now()+20000;do{if((await people(origin,cookie,id)).some(person=>person.display_name==='林舟')===present)return;await delay(100);}while(Date.now()<until);assert.fail('current colleague presence did not reach '+present);}
const network={latency:0,downloadThroughput:-1,uploadThroughput:-1};

test('production list preloads do not view; real detail shows safe peers and offline/unmount stop presence',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5]?.ticket,actor=browserCookies[0],peer=cookies[2];assert.ok(ticket&&actor&&peer);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:[actor]});assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector(".board"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      const preload=await browser.evaluate(`fetch('/api/workbench/items/ticket/${ticket.id}').then(response=>response.status)`);assert.equal(preload,200);
      await delay(5500);assert.deepEqual(await people(origin,peer,ticket.id),[],'a real preload without a detail DOM does not register viewing');
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+ticket.id+'?detail=page'});
      await browser.waitFor('Boolean(document.querySelector(".detail-body"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await waitPeople(origin,peer,ticket.id,true);
      const capability=await(await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:peer}})).json() as {csrf_token:string};
      const renewal=await fetch(origin+'/api/workbench/activity',{method:'POST',headers:{cookie:peer,origin,'content-type':'application/json','x-csrf-token':capability.csrf_token},body:JSON.stringify({schema_version:1,browser_id:randomUUID(),action:'RENEW',target:{kind:'ticket',id:ticket.id},visible:true,active:true,mode:'VIEWING',field:null})});assert.equal(renewal.status,200);await renewal.arrayBuffer();
      await browser.waitFor('document.querySelector("[data-workbench-activity]")?.textContent.includes("陈悦正在查看")');
      const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
      for(const width of [900,1920]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true);
        const image=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-'+width+'.png');await writeFile(file,image);screenshots.push({file,width:image.readUInt32BE(16),height:image.readUInt32BE(20),sha256:createHash('sha256').update(image).digest('hex')});
      }
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',activity_safe_peer:true,screenshots}));
      assert.equal((await runtime.observability.metrics()).sse_clients,1);
      await browser.command('Network.emulateNetworkConditions',{offline:true,...network});
      await browser.waitFor('navigator.onLine===false&&!document.querySelector("[data-workbench-activity]")');
      await waitPeople(origin,peer,ticket.id,false);
      await browser.command('Network.emulateNetworkConditions',{offline:false,...network});
      await browser.waitFor('navigator.onLine===true&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await waitPeople(origin,peer,ticket.id,true);
      await browser.command('Page.navigate',{url:origin+'/workbench/app/'});
      await browser.waitFor('Boolean(document.querySelector(".board"))&&!document.querySelector(".detail-body")');
      await waitPeople(origin,peer,ticket.id,false);
    }catch(failure){error=failure;console.log('T39_LIFECYCLE_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,visible:document.visibilityState,online:navigator.onLine})'):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});

test('current READ revocation clears production activity and cannot restore the prior colleague lease',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,principals,pool}:Fixture)=>{
    const ticket=tickets[5]?.ticket,actor=browserCookies[0],viewer=cookies[2],principal=principals[0];assert.ok(ticket&&actor&&viewer&&principal);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.id+'?detail=page',width:1280,height:900,cookies:[actor]});assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector(".detail-body"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');await waitPeople(origin,viewer,ticket.id,true);
      await pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principal.id]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principal.id]);await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);
      await waitPeople(origin,viewer,ticket.id,false);
      await browser.waitFor('!document.querySelector(".detail-body")&&!document.querySelector("[data-workbench-activity]")');
      const denied=await browser.evaluate(`fetch('/api/workbench/items/ticket/${ticket.id}').then(response=>response.status)`);assert.equal(denied,404);
      assert.deepEqual(await people(origin,viewer,ticket.id),[]);
    }catch(failure){error=failure;console.log('T39_REVOKE_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});

test('successful real session logout removes the production activity view and makes old credentials unusable',async()=>{
  await withWeb01Fixture(async({origin,backendOrigin,certificateSpki,browserCookies,cookies,tickets}:Fixture)=>{
    const ticket=tickets[5]?.ticket,oldCookie=cookies[0];assert.ok(ticket&&oldCookie);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticket.id+'?detail=page',width:1280,height:900,cookies:browserCookies,certificateSpki});assert.ok(browser);
      await browser.waitFor('Boolean(document.querySelector(".detail-body"))&&document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
      await browser.waitFor('Boolean(document.querySelector("[data-action=logout-workbench]"))');
      await browser.evaluate('document.querySelector("[data-action=logout-workbench]").click()');
      await browser.waitFor('!document.querySelector(".detail-body")&&!document.querySelector("[data-workbench-activity]")&&document.body.innerText.includes("已退出")');
      const denied=await fetch(backendOrigin+'/api/lifecycle/bootstrap',{headers:{cookie:oldCookie}});assert.equal(denied.status,401);await denied.arrayBuffer();
    }catch(failure){error=failure;console.log('T39_LOGOUT_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,realWorkbenchAuthentication:true});
});
