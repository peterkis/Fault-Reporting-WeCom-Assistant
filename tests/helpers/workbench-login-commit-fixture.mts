import {launchSystemBrowser} from './p2-006-browser-harness.mjs';

/** Test-only native login boundary: real server logout/cleanup run, while the old
 * realm stays available for original late-response and decrypt assertions.
 * Actual QR document navigation is independently exercised by browser/native E2E.
 */
export async function launchWithHeldLoginCommit(options:Parameters<typeof launchSystemBrowser>[0]){
  const browser=await launchSystemBrowser(options);
  if(!browser)throw Error('BROWSER_REQUIRED');
  try{
    await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__heldLoginRequests=0;window.workbenchDesktop={version:1,getState:async()=>({version:1,visible:true,focused:true,locked:false,suspended:false,remindersEnabled:false,revision:0}),onState:()=>()=>{},updateContext:async()=>{},setReminders:async()=>false,showReminder:async()=>false,clearReminders:async()=>{},onReminderClick:()=>()=>{},requestLogin:async()=>{window.__heldLoginRequests++;}};})()`});
    await browser.command('Page.reload');await browser.waitFor('typeof window.workbenchDesktop?.requestLogin==="function"');return browser;
  }catch(error){try{await browser.close();}catch(cleanup){throw new AggregateError([error,cleanup]);}throw error;}
}
