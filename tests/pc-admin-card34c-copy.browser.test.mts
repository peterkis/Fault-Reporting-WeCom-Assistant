import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT43Fixture,text} from './helpers/t43-full-service-fixture.mjs';
import {start,launch,close} from './helpers/t43-service-actions.mjs';
import type {Browser} from './helpers/t43-service-actions.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';

// Card 34C: the copy on the board and the detail drawer, as rendered, carries none of the banned technical words
// (docs/ui/design-system.md 6.15), and a saved draft reads 「草稿已保存」 with its 24-hour hint on hover.
const BANNED=/UUID|(?<![A-Za-z])ID(?![A-Za-z])|版本|核验|副本|加密|投影|快照|读取范围|读权限|契约|幂等|命令/u;
test('Card 34C rendered copy: board and detail drawer show no banned technical words; the saved draft hint',{timeout:600000},()=>withT43Fixture(async f=>{
 const directory=process.env.CARD34_EVIDENCE_DIR??join(tmpdir(),'card34c-'+randomUUID());await mkdir(directory,{recursive:true});
 const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
 const ticket=await start(f,await f.manualReport('卡34C 合成：打印机无法打印（合成）')),id=text(ticket.id);
 let browser:Browser|undefined,error:unknown;
 try{
  browser=await launch(f,'/workbench/app/');const b=browser;
  await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const shot=async(name:string)=>{await waitForAnimationsSettled(b);const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name),bytes);screenshots.push({file:name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  const visible=async()=>text(await b.evaluate('document.body.innerText'));
  await b.waitFor("Boolean(document.querySelector('[data-ticket-id],.ticket-card'))");await waitForAnimationsSettled(b);
  assert.doesNotMatch(await visible(),BANNED,'the board shows no banned word');
  await shot('board-1440.png');
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id});
  await b.waitFor("Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.ds-detail-footer textarea'))");await waitForAnimationsSettled(b);
  assert.doesNotMatch(await visible(),BANNED,'the detail drawer shows no banned word');
  await clickWorkbenchControl(b,'.ds-detail-footer textarea');await b.command('Input.insertText',{text:'卡34C 合成草稿（合成）'});
  await b.waitFor("document.querySelector('[data-draft-status]')?.getAttribute('aria-label')?.startsWith('草稿已保存')");
  // Codex review: the limit is in the status's accessible text too, not only in the hover title.
  assert.equal(await b.evaluate("document.querySelector('[data-draft-status]').getAttribute('aria-label')"),'草稿已保存。仅保存在这台电脑；从第一次保存起最多保留 24 小时，到期后不再恢复。','the status announces the limit');
  assert.equal(await b.evaluate("document.querySelector('[data-draft-status]').getAttribute('title')"),'仅保存在这台电脑；从第一次保存起最多保留 24 小时，到期后不再恢复。','the saved draft explains where and how long on hover');
  assert.doesNotMatch(await visible(),BANNED,'the saved draft shows no banned word');
  await shot('detail-1440-draft-saved.png');
 }catch(caught){error=caught;}
 finally{
  await writeFile(join(directory,'receipt-34c-copy.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,screenshots},null,2));
  await close(browser,error);
 }
}));
