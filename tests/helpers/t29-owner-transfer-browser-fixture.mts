import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ownerTransferHttp,text} from './t29-owner-transfer-http-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import type {Browser} from './wbint-t27-browser-fixture.mjs';
type Http=Parameters<Parameters<typeof ownerTransferHttp>[0]>[0];
export async function ownerTransferBrowser(run:(context:Http&{browser:Browser;incidentId:string;choose:(label:string,value:string)=>Promise<void>;capture:()=>Promise<void>})=>Promise<void>,options:{recovery?:boolean}={}){
  await ownerTransferHttp(async context=>{
    const incidentId=await context.confirm(),cookie=context.cookies[0];assert.ok(cookie);let browser:Browser|undefined,primaryError:unknown;
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    const capture=async()=>{assert.ok(browser);const png=await browser.screenshot();if(typeof png!=='string')throw Error('T29_PNG_REQUIRED');const snapshotDirectory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(snapshotDirectory);const bytes=Buffer.from(png,'base64'),file=join(snapshotDirectory,'new-detail-'+bytes.readUInt32BE(16)+'.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
    try{
      browser=await launchSystemBrowser({url:context.origin+'/workbench/app/',width:900,height:1080,cookies:[{name:text(cookie.name),value:text(cookie.value),url:text(cookie.url)}]});assert.ok(browser);await browser.command('Page.enable');
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const send=globalThis.fetch,documentId=crypto.randomUUID();let requestId=0;
        globalThis.__t29Document=documentId;globalThis.__t29Posts=[];globalThis.__t29Reads=[];globalThis.__t29Transport=[];
        const observe=(request,path,phase,extra={})=>globalThis.__t29Transport.push({document_id:documentId,request,path,phase,...extra});
        globalThis.fetch=async(path,options)=>{
          const value=String(path),request=++requestId,api=value.startsWith('/api/');
          const post=options?.method==='POST'?{path:value,body:options.body,status:null}:null;if(post)globalThis.__t29Posts.push(post);
          if(api){observe(request,value,'start');options?.signal?.addEventListener('abort',()=>observe(request,value,'abort'),{once:true});}
          try{const response=await send(path,options);if(post)post.status=response.status;
            if(api){globalThis.__t29Reads.push({path:value,status:response.status});observe(request,value,'response',{status:response.status});}return response;
          }catch(error){if(api)observe(request,value,'reject',{error_name:error?.name??'UNKNOWN'});throw error;}
        };
      })()`});
      await browser.command('Page.navigate',{url:context.origin+'/workbench/app/incidents/'+incidentId});
      await browser.waitFor(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))`);await browser.waitFor('Boolean(document.querySelector("select[aria-label=交接负责人]"))');
      if(options.recovery)await browser.waitFor('document.querySelector("[data-owner-transfer-draft]")?.textContent.includes("最长24小时")');
      const active=browser,choose=async(label:string,value:string)=>{await active.evaluate(`(()=>{const select=document.querySelector(${JSON.stringify('select[aria-label="'+label+'"]')});if(!select)throw Error('T29_SELECT_MISSING');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(value)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
      await run({...context,browser,incidentId,choose,capture});assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture();
      await writeFile(join(directory,'transport.json'),JSON.stringify(await browser.evaluate('({document_id:globalThis.__t29Document,events:globalThis.__t29Transport,post_count:globalThis.__t29Posts.length})')));
      console.log('T29_BROWSER_TRANSPORT '+JSON.stringify({file:join(directory,'transport.json')}));
    }catch(error){primaryError=error;if(browser)try{await capture();await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({url:location.pathname,text:document.body.innerText,document_id:globalThis.__t29Document,events:globalThis.__t29Transport,post_count:globalThis.__t29Posts.length})')));}catch(evidenceError){primaryError=new AggregateError([error,evidenceError],'T29_BROWSER_EVIDENCE_FAILURE');}}
    try{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primaryError);}finally{console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:'t29owner-production',screenshots}));}
  },options);
}
