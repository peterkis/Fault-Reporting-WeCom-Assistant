import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT10Browser,fillWaiting} from './helpers/t10-browser-fixture.mjs';

test('production current handler explicitly waits for a vendor and resumes with internal reasons and the original responsibility',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context,2),target=context.tickets[0];assert.ok(target);const before=await http.start(target.ticket.id);
    const responsibility=await (await http.get('/api/tickets/'+target.ticket.id+'/responsibility')).json() as unknown;
    await withT10Browser(context,target.ticket.id,2,'T10_VENDOR_RESUME_REAL_ACTIONS',async(browser,capture)=>{
      await browser.evaluate("(()=>{const original=fetch;globalThis.__t10Posts=[];globalThis.fetch=async(path,options)=>{if(options?.method==='POST'){const row={path:String(path),body:JSON.parse(options.body),status:null};globalThis.__t10Posts.push(row);const result=await original(path,options);row.status=result.status;return result;}return original(path,options);};})()");
      for(const [action,label,state] of [['wait-vendor','等待厂商','WAITING_VENDOR'],['resume','恢复处理','IN_PROGRESS']] as const){
        const button='button[data-action="'+action+'"]',form='form[aria-label="'+label+'"]';
        await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(button)}))&&!document.querySelector(${JSON.stringify(button)}).disabled`);
        await browser.evaluate(`document.querySelector(${JSON.stringify(button)}).click()`);await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(form)}))`);
        await browser.evaluate(fillWaiting(form+' textarea[aria-label="等待原因"]','INTERNAL_T10_BROWSER_VENDOR：'+label+'合成原因。'));
        await browser.waitFor(`!document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(form+' button[type="submit"]')}).click()`);
        await browser.waitFor(`globalThis.__t10Posts.some(row=>row.path.endsWith('/'+${JSON.stringify(action)})&&row.status===200)`);
        const after=await http.detail(target.ticket.id);assert.equal(after.status,state);assert.equal(after.assignee_id,before.assignee_id);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.deepEqual(after.handling_cycle,before.handling_cycle);
        assert.deepEqual(await (await http.get('/api/tickets/'+target.ticket.id+'/responsibility')).json(),responsibility);
      }
      const posts=await browser.evaluate('globalThis.__t10Posts') as {path:string;body:Record<string,unknown>}[];assert.equal(posts.length,2);assert.notEqual(posts[0]?.body.client_command_id,posts[1]?.body.client_command_id);
      for(const post of posts){assert.equal(post.body.external_visible,false);assert.deepEqual(Object.keys(post.body).sort(),['client_command_id','expected_version','external_visible','note','reason_code']);}
      await capture('new-detail-vendor-resumed.png');
    });
  });
});
