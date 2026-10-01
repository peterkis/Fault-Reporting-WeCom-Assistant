import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, statSync, accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';

export const systemBrowserCandidates = Object.freeze([
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]);
export function findSystemBrowser({ executable = process.env.TS_MIGRATION_BROWSER_EXECUTABLE, candidates = systemBrowserCandidates } = {}) {
  if (executable !== undefined) {
    if (!isAbsolute(executable) || !existsSync(executable) || !statSync(executable).isFile()) throw new Error('P2_006_EXPLICIT_BROWSER_INVALID');
    try { accessSync(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK); }
    catch { throw new Error('P2_006_EXPLICIT_BROWSER_INVALID'); }
    return executable;
  }
  const available = candidates.find(p => { try { return statSync(p).isFile(); } catch { return false; } });
  if (!available) throw new Error('P2_006_SYSTEM_EDGE_OR_CHROME_REQUIRED');
  return available;
}
const delay=milliseconds=>new Promise(resolveDelay=>setTimeout(resolveDelay,milliseconds));
async function waitFor(fn,{timeoutMs=30000,intervalMs=50,signal}={}){
  const deadline=Date.now()+timeoutMs;let lastError;
  while(Date.now()<deadline){
    signal?.throwIfAborted();
    try{const value=await fn();if(value)return value;}catch(error){lastError=error;}
    signal?.throwIfAborted();await delay(intervalMs);
  }
  throw lastError??new Error('P2_006_BROWSER_WAIT_TIMEOUT');
}

// The caller declares legitimate same-origin redirects. Never select an unrelated
// page merely because it is the first target returned by the owned DevTools port.
export function selectBrowserTarget(values,{url,redirectPaths=[]}){
  const expected=new URL(url);
  assert.ok(Array.isArray(redirectPaths)&&redirectPaths.length<=4&&redirectPaths.every(p=>
    typeof p==='string'&&p.startsWith('/')&&new URL(p,expected).origin===expected.origin&&new URL(p,expected).pathname===p));
  const paths=new Set([expected.pathname,...redirectPaths]);
  const matching=values.filter(value=>{
    if(value.type!=='page'||!value.webSocketDebuggerUrl)return false;
    try{const target=new URL(value.url);return target.origin===expected.origin&&paths.has(target.pathname);}catch{return false;}
  });
  if(matching.length>1)throw new Error('P2_006_BROWSER_TARGET_AMBIGUOUS');
  return matching[0]??null;
}

// Execute every owned cleanup step and retain the original failure alongside
// cleanup failures. This helper does not treat a cleanup exception as success.
export async function closeBrowserTestResources(closers,primaryError=null){
  const errors=primaryError?[primaryError]:[];
  for(const close of closers){try{await close();}catch(error){errors.push(error);}}
  if(errors.length===1)throw errors[0];
  if(errors.length>1)throw new AggregateError(errors,'P2_006_BROWSER_TEST_AND_CLEANUP_FAILED');
}

export async function launchSystemBrowser({url,width,height,cookies=[],redirectPaths=[],signal,certificateSpki=null}){
  assert.ok(certificateSpki===null||typeof certificateSpki==='string'&&/^[A-Za-z0-9+/]{43}=$/u.test(certificateSpki));
  selectBrowserTarget([],{url,redirectPaths});
  const executable=findSystemBrowser(),profile=await mkdtemp(join(tmpdir(),'p2-006-browser-'));
  const child=spawn(executable,[
    '--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run',
    '--disable-default-apps','--disable-extensions','--disable-gpu','--disable-background-networking',
    ...(certificateSpki?[`--ignore-certificate-errors-spki-list=${certificateSpki}`]:[]),
    `--window-size=${width},${height}`,url,
  ],{stdio:'ignore',windowsHide:true});
  let socket=null,sequence=0,closePromise=null,launchError=null;
  child.on('error',()=>{launchError=new Error('P2_006_BROWSER_LAUNCH_FAILED');});
  const pending=new Map();
  const rejectPending=()=>{for(const request of pending.values()){
    clearTimeout(request.timer);request.reject(new Error('P2_006_BROWSER_DISCONNECTED'));
  }pending.clear();};
  function command(method,params={},sessionId=null){
    const id=++sequence;
    return new Promise((resolveCommand,reject)=>{
      if(socket?.readyState!==WebSocket.OPEN){reject(new Error('P2_006_BROWSER_DISCONNECTED'));return;}
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('P2_006_BROWSER_COMMAND_TIMEOUT'));},10000);
      pending.set(id,{resolve:resolveCommand,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  async function dispose(){
    // Browser.close normally tears down CDP before replying; that disconnect is expected.
    if(socket?.readyState===WebSocket.OPEN)await command('Browser.close').catch(()=>{});
    if(socket&&socket.readyState!==WebSocket.CLOSED){try{socket.close();}catch{/* kill owned process below */}}
    rejectPending();
    async function waitForExit(){
      if(child.exitCode!==null||child.signalCode!==null)return;
      await new Promise(resolveExit=>{
        const finish=()=>{clearTimeout(timer);child.removeListener('exit',finish);resolveExit();};
        const timer=setTimeout(finish,2000);child.once('exit',finish);
      });
    }
    // Let Browser.close finish flushing its owned profile before forcing a process exit.
    await waitForExit();
    if(child.exitCode===null&&child.signalCode===null){
      child.kill('SIGKILL');
      await waitForExit();
    }
    if(child.exitCode===null&&child.signalCode===null&&!launchError)throw new Error('P2_006_BROWSER_PROCESS_NOT_STOPPED');
    const resolvedProfile=resolve(profile),owned=relative(resolve(tmpdir()),resolvedProfile);
    assert.ok(!isAbsolute(owned)&&/^p2-006-browser-[a-zA-Z0-9]+$/u.test(owned));
    await waitFor(async()=>{
      try{await rm(resolvedProfile,{recursive:true,force:true,maxRetries:3,retryDelay:100});return true;}
      catch(error){if(!['EBUSY','EPERM','ENOTEMPTY'].includes(error?.code))throw error;return false;}
    },{timeoutMs:8000,intervalMs:100});
    // Process exit and profile removal do not prove the asynchronous CDP close
    // has completed. Keep cleanup observers honest, including on a timeout.
    if(socket)await waitFor(()=>{
      if(socket.readyState!==WebSocket.CLOSED)throw new Error('P2_006_BROWSER_SOCKET_NOT_CLOSED');
      return true;
    },{timeoutMs:10000});
  }
  function close(){closePromise??=dispose();return closePromise;}
  const startupSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  try{
    const active=await waitFor(async()=>{
      if(launchError)throw launchError;
      const file=join(profile,'DevToolsActivePort');if(!existsSync(file))return null;
      const [value]=(await readFile(file,'utf8')).trim().split(/\r?\n/u);return /^[0-9]+$/u.test(value)?Number(value):null;
    },{signal:startupSignal});
    const target=await waitFor(async()=>{
      const response=await fetch(`http://127.0.0.1:${active}/json/list`,{signal:startupSignal});
      return selectBrowserTarget(await response.json(),{url,redirectPaths});
    },{signal:startupSignal});
    socket=new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('close',rejectPending);socket.addEventListener('error',rejectPending);
    await new Promise((resolveOpen,reject)=>{
      const done=fn=>event=>{socket.removeEventListener('open',opened);socket.removeEventListener('error',errored);startupSignal.removeEventListener('abort',aborted);fn(event);};
      const opened=done(resolveOpen),errored=done(()=>reject(new Error('P2_006_BROWSER_CONNECT_FAILED'))),aborted=done(()=>reject(startupSignal.reason));
      socket.addEventListener('open',opened,{once:true});socket.addEventListener('error',errored,{once:true});startupSignal.addEventListener('abort',aborted,{once:true});
      if(startupSignal.aborted)aborted();
    });
    socket.addEventListener('message',event=>{
      const message=JSON.parse(String(event.data));if(!message.id||!pending.has(message.id))return;
      const request=pending.get(message.id);pending.delete(message.id);clearTimeout(request.timer);
      if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
    });
    await command('Runtime.enable');
    if(cookies.length){
      assert.ok(Array.isArray(cookies)&&cookies.length<=4&&cookies.every(cookie=>new URL(cookie.url).origin===new URL(url).origin));
      await command('Network.enable');await command('Network.setCookies',{cookies});await command('Page.reload');
    }
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    async function evaluate(expression,{awaitPromise=true}={}){
      const result=await command('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.text??'P2_006_BROWSER_EVALUATION_FAILED');
      return result.result.value;
    }
    const expectedDocument=new URL(url),documentPaths=new Set([expectedDocument.pathname,...redirectPaths]);
    await waitFor(async()=>{
      const documentState=await evaluate('({href:location.href,readyState:document.readyState})');
      if(!documentState||typeof documentState.href!=='string'||!['interactive','complete'].includes(documentState.readyState))return false;
      const documentUrl=new URL(documentState.href);
      return documentUrl.origin===expectedDocument.origin&&documentPaths.has(documentUrl.pathname);
    },{signal:startupSignal});
    async function pressTab(){
      for(const type of ['rawKeyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
    }
    return Object.freeze({executable,evaluate,pressTab,command,
      ownedResourceState:()=>({processes:child.exitCode===null&&child.signalCode===null?1:0,profiles:existsSync(profile)?1:0,commandTimers:pending.size,sockets:socket?.readyState===WebSocket.CLOSED?0:1}),
      setTimezone:timezoneId=>command('Emulation.setTimezoneOverride',{timezoneId}),
      screenshot:async()=>(await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,
      waitFor:(expression,options)=>waitFor(()=>evaluate(expression),options),close});
  }catch(error){await closeBrowserTestResources([close],error);}
}
