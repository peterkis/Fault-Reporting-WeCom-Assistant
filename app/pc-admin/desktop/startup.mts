import type {StartupBridge,StartupFailure,StartupSignal,StartupState} from './policy.mjs';
import {createFramePlayback,FRAME_COUNT,FRAME_RATE} from './frame-playback.mjs';
import type {FramePlaybackSnapshot} from './frame-playback.mjs';

interface DecodedPixelFrame {
  pixels: ImageData | null;
  close(): void;
}

declare global {interface Window {desktopStartup:StartupBridge}}
const canvas=document.getElementById('startup-canvas');
if(!(canvas instanceof HTMLCanvasElement))throw Error('STARTUP_CANVAS_DOCUMENT_INVALID');
let context:CanvasRenderingContext2D|null=null;
const FRAME_SIZE = 540;
const PIXEL_BYTES = FRAME_SIZE * FRAME_SIZE * 4;
// These WebIDL settings are supported by the pinned Chromium but are absent from the TS DOM declarations.
const rgbaContext: CanvasRenderingContext2DSettings & {colorType: 'unorm8'} = {
  alpha: false, colorSpace: 'srgb', colorType: 'unorm8'
};
const FRAME_STRIDE = FRAME_SIZE * 4;
const frameCopy: VideoFrameCopyToOptions = {
  format: 'RGBA',
  colorSpace: 'srgb',
  rect: {x: 0, y: 0, width: FRAME_SIZE, height: FRAME_SIZE},
  layout: [{offset: 0, stride: FRAME_STRIDE}]
};
const freePixels: ImageData[] = [];
let allocatedSlots = 0;
try {
  context = canvas.getContext('2d', {...rgbaContext, willReadFrequently: false, desynchronized: true});
} catch { /* Report the bounded canvas failure once the bridge is ready. */ }
const status=document.querySelector('.startup-status'),message=document.querySelector('[data-message]'),detail=document.querySelector('[data-detail]'),code=document.querySelector('[data-code]');
let current:StartupState|null=null,disposed=false,failed:StartupFailure|null=null,firstFrame=false,reduced=false,released=false;
let player:ReturnType<typeof createFramePlayback<DecodedPixelFrame>>|null=null,staticFrame:DecodedPixelFrame|null=null,staticRequested=false,staticDrawn=false;
let decodeInFlight: Promise<DecodedPixelFrame> | null = null;
let raf=0,fadeDeadline:number|undefined,releasingGeneration:number|undefined,reportedCycle=0,metadata=false;
let lastWatch=performance.now(),withoutFrame=0,withoutProgress=0,lastDrawCount=0,stalled=false;
let lastHeartbeat=performance.now(),reportedDrawCount=0;
let recorded:FramePlaybackSnapshot|null=null,recordedActive=false;
const setData=(key:string,value:string)=>{if(document.body.dataset[key]!==value)document.body.dataset[key]=value;};
for(const [key,value] of Object.entries({frameIndex:'-1',drawCount:'0',cycleCount:'0',activeMs:'0',firstCycleActiveMs:'',residentFrames:'0',residentFrameIndexes:'',inFlight:'0',decodingFrame:'',maxResidentFrames:'0',maxInFlight:'0'}))setData(key,value);
class FrameFailure extends Error {constructor(readonly reason:'frame-load-failed'|'frame-decode-failed'|'canvas-unavailable'){super(reason);}}
const emit=(value:StartupSignal)=>{if(!disposed)void window.desktopStartup.event(value).catch(()=>{});};
const playable=()=>!!current?.active&&!current.releasing&&!document.hidden&&!failed&&!disposed;
const diagnostics=(reason:StartupFailure|'reduced-motion')=>{
  status?.removeAttribute('hidden');
  if(message)message.textContent=reason==='reduced-motion'?'已手动选择静态启动画面':'启动画面暂时无法播放';
  if(detail)detail.textContent=reason==='reduced-motion'?'正在准备登录界面。':'正在继续准备登录，稍后将显示登录页或连接恢复选项。';
  if(code)code.textContent=reason==='reduced-motion'?'MANUAL_REDUCED_MOTION':('STARTUP_'+reason.replaceAll('-','_').toUpperCase());
};
const stopFrames=()=>{cancelAnimationFrame(raf);raf=0;player?.pause();if(player)record(player.snapshot(),true);setData('playback','paused');};
const disposeFrames=()=>{stopFrames();player?.dispose();staticFrame?.close();staticFrame=null;freePixels.length=0;};
const fail=(reason:StartupFailure)=>{
  if(disposed||failed||current?.releasing)return;
  failed=reason;disposeFrames();document.body.dataset.failed='true';document.body.dataset.startupFailure=reason;
  diagnostics(reason);emit({version:1,type:'failed',reason});
};
function takePixels(): ImageData {
  const free = freePixels.pop();
  if (free) return free;
  if (allocatedSlots >= 3) throw new FrameFailure('frame-decode-failed');
  const pixels = new ImageData(new Uint8ClampedArray(PIXEL_BYTES), FRAME_SIZE, FRAME_SIZE, {colorSpace: 'srgb'});
  allocatedSlots++;
  return pixels;
}

function returnPixels(pixels: ImageData): void {
  if (!disposed && !failed) freePixels.push(pixels);
}

async function decodeFramePixels(index: number): Promise<DecodedPixelFrame> {
  if (disposed || failed || typeof VideoFrame !== 'function' || typeof VideoFrame.prototype.copyTo !== 'function') {
    throw new FrameFailure('frame-decode-failed');
  }
  const modeAtRequest = reduced;
  const image = new Image();
  image.decoding = 'async';
  let pixels: ImageData | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new FrameFailure('frame-load-failed'));
      image.src = 'startup-frames/' + String(index).padStart(3, '0') + '.webp';
    });
    try {
      await image.decode();
    } catch {
      throw new FrameFailure('frame-decode-failed');
    }
    if (disposed || failed || reduced !== modeAtRequest) throw new FrameFailure('frame-decode-failed');
    if (image.naturalWidth !== FRAME_SIZE || image.naturalHeight !== FRAME_SIZE) {
      throw new FrameFailure('frame-decode-failed');
    }
    pixels = takePixels();
    const source = new VideoFrame(image, {timestamp: Math.round(index * 1_000_000 / FRAME_RATE)});
    try {
      if (source.codedWidth !== FRAME_SIZE || source.codedHeight !== FRAME_SIZE
        || source.displayWidth !== FRAME_SIZE || source.displayHeight !== FRAME_SIZE) {
        throw new FrameFailure('frame-decode-failed');
      }
      const layout = await source.copyTo(pixels.data, frameCopy);
      const plane = layout[0];
      if (layout.length !== 1 || plane?.offset !== 0 || plane.stride !== FRAME_STRIDE) {
        throw new FrameFailure('frame-decode-failed');
      }
    } finally {
      source.close();
    }
    if (disposed || failed || reduced !== modeAtRequest) throw new FrameFailure('frame-decode-failed');
  } catch (error) {
    if (pixels) returnPixels(pixels);
    throw error;
  } finally {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
  }
  const frame: DecodedPixelFrame = {
    pixels,
    close() {
      const owned = this.pixels;
      if (!owned) return;
      this.pixels = null;
      returnPixels(owned);
    }
  };
  return frame;
}

function loadFrame(index: number): Promise<DecodedPixelFrame> {
  if (decodeInFlight) {
    // Wait for the disposed player's decode before the static request can lease a slot.
    return decodeInFlight.then(() => loadFrame(index), () => loadFrame(index));
  }
  const pending = decodeFramePixels(index);
  decodeInFlight = pending;
  const clear = () => {
    if (decodeInFlight === pending) decodeInFlight = null;
  };
  void pending.then(clear, clear);
  return pending;
}

function draw(frame: DecodedPixelFrame): void {
  try {
    if (!context || context.isContextLost() || !frame.pixels) throw new FrameFailure('canvas-unavailable');
    context.putImageData(frame.pixels, 0, 0);
  } catch {
    throw new FrameFailure('canvas-unavailable');
  }
}
const showFirstFrame=()=>{
  if(firstFrame||disposed||failed)return;firstFrame=true;document.body.dataset.firstFrame='true';
  if(!metadata){metadata=true;document.body.dataset.metadata='true';emit({version:1,type:'metadata',duration:FRAME_COUNT/FRAME_RATE,width:540,height:540});}
  emit({version:1,type:'first-frame'});
};
const record=(snapshot:FramePlaybackSnapshot,force=false)=>{
  const active=playable();
  if(!force&&recorded&&recordedActive===active&&recorded.drawCount===snapshot.drawCount&&recorded.cycleCount===snapshot.cycleCount&&recorded.waiting===snapshot.waiting&&recorded.disposed===snapshot.disposed)return;
  recorded=snapshot;recordedActive=active;
  const values={frameIndex:String(snapshot.currentFrame),drawCount:String(snapshot.drawCount),cycleCount:String(snapshot.cycleCount),activeMs:String(snapshot.activeMs),firstCycleActiveMs:snapshot.firstCycleActiveMs===null?'':String(snapshot.firstCycleActiveMs),residentFrames:String(snapshot.residentFrames.length),residentFrameIndexes:snapshot.residentFrames.join(','),inFlight:String(snapshot.inFlight===null?0:1),decodingFrame:snapshot.inFlight===null?'':String(snapshot.inFlight),maxResidentFrames:String(snapshot.maxResidentFrames),maxInFlight:String(snapshot.maxInFlight),playback:!active||snapshot.disposed?'paused':snapshot.waiting||snapshot.currentFrame<0?'waiting':'playing'};
  for(const [key,value] of Object.entries(values))setData(key,value);
};
const initialize=()=>{
  if(!context){fail('canvas-unavailable');return;}
  if(reduced){
    if(staticRequested)return;staticRequested=true;
    setData('inFlight','1');setData('decodingFrame','30');setData('maxInFlight','1');
    void loadFrame(30).then(frame=>{setData('inFlight','0');setData('decodingFrame','');if(disposed||failed||current?.releasing){frame.close();return;}staticFrame=frame;setData('residentFrames','1');setData('residentFrameIndexes','30');setData('maxResidentFrames','1');sync();}).catch(error=>fail(error instanceof FrameFailure?error.reason:'frame-decode-failed'));
  }else if(!player){
    player=createFramePlayback({loadFrame,drawFrame:frame=>draw(frame),onSignal:signal=>{
      if(signal==='first-frame')showFirstFrame();
      else if(signal==='playing'){stalled=false;emit({version:1,type:'playing'});}
      else if(signal==='waiting')emit({version:1,type:'waiting'});
      // Cycle signals are sent after tick returns so current navigation receipts
      // can be retried on a later genuine cycle if native visibility rejected one.
    },onError:error=>fail(error instanceof FrameFailure?error.reason:'frame-decode-failed')});
    record(player.snapshot());
  }
};
const tick=(now:number)=>{
  raf=0;if(!playable())return;
  if(reduced){
    if(staticFrame&&!staticDrawn){try{draw(staticFrame);}catch{fail('canvas-unavailable');return;}staticDrawn=true;showFirstFrame();document.body.dataset.frameIndex='30';document.body.dataset.drawCount='1';document.body.dataset.cycleCount='0';document.body.dataset.playback='paused';emit({version:1,type:'reduced-motion'});}
    return;
  }
  if(player){
    const snapshot=player.tick(now,true);record(snapshot);
    if(!failed&&snapshot.cycleCount>reportedCycle){reportedCycle=snapshot.cycleCount;if(!current?.firstPlaybackComplete)emit({version:1,type:'first-cycle-complete'});}
    if(snapshot.drawCount>lastDrawCount){withoutProgress=0;lastDrawCount=snapshot.drawCount;if(stalled){stalled=false;emit({version:1,type:'playing'});}}
  }
  if(playable())raf=requestAnimationFrame(tick);
};
function sync(){
  lastWatch=performance.now();
  if(!playable()){stopFrames();return;}
  initialize();if(!failed&&!raf&&(!reduced||staticFrame&&!staticDrawn))raf=requestAnimationFrame(tick);
}
const release=(generation:number)=>{
  if(released||disposed||!current?.releasing||current.generation!==generation)return;released=true;
  clearTimeout(fadeDeadline);stopFrames();emit({version:1,type:'released',generation});
};
document.body.addEventListener('transitionend',event=>{if(event.target===document.body&&event.propertyName==='opacity'&&releasingGeneration!==undefined&&Number(getComputedStyle(document.body).opacity)<.001)release(releasingGeneration);});
const render=(state:StartupState)=>{
  if(disposed)return;current=state;document.body.dataset.firstPlaybackComplete=String(state.firstPlaybackComplete);
  // Only the explicit desktop flag chooses a static frame. System media queries
  // neither pause the default sequence nor bypass its complete first cycle.
  if(state.reducedMotion&&!reduced){reduced=true;player?.dispose();player=null;stopFrames();document.body.dataset.reducedMotion='true';diagnostics('reduced-motion');}
  if(state.failure&&!failed){failed=state.failure;disposeFrames();document.body.dataset.failed='true';document.body.dataset.startupFailure=state.failure;diagnostics(state.failure);}
  if(!state.releasing){clearTimeout(fadeDeadline);delete document.body.dataset.releasing;releasingGeneration=undefined;released=false;}
  if(state.releasing&&!document.body.dataset.releasing){
    const generation=state.generation;releasingGeneration=generation;document.body.dataset.releasing='true';stopFrames();
    if(reduced)release(generation);
    // A lost fade receipt can only clear an already-open gate; never complete frames.
    else fadeDeadline=window.setTimeout(()=>release(generation),320);
  }
  sync();
};
let received=false;
const unsubscribe=window.desktopStartup.onState(state=>{received=true;render(state);});
void window.desktopStartup.state().then(state=>{if(!received)render(state);}).catch(()=>fail('overlay-load-failed'));
const visibilityChanged=()=>{emit({version:1,type:'visibility',visible:!document.hidden});sync();};
document.addEventListener('visibilitychange',visibilityChanged);visibilityChanged();
const contextLost=()=>fail('canvas-unavailable');canvas.addEventListener('contextlost',contextLost);
const watchdog=window.setInterval(()=>{
  const now=performance.now(),delta=Math.min(1000,Math.max(0,now-lastWatch));lastWatch=now;
  if(!playable())return;
  if(!firstFrame)withoutFrame+=delta;
  if(!reduced)withoutProgress+=delta;
  if(!reduced&&lastDrawCount>reportedDrawCount&&now-lastHeartbeat>=1000){
    reportedDrawCount=lastDrawCount;lastHeartbeat=now;emit({version:1,type:'progress',drawCount:lastDrawCount});
  }
  if(firstFrame&&!reduced&&!stalled&&withoutProgress>=2000){stalled=true;emit({version:1,type:'stalled'});}
  if(withoutFrame>=8000)fail('first-frame-timeout');else if(!reduced&&withoutProgress>=8000)fail('playback-stalled');
},250);
window.addEventListener('pagehide',()=>{disposed=true;disposeFrames();clearInterval(watchdog);clearTimeout(fadeDeadline);unsubscribe();document.removeEventListener('visibilitychange',visibilityChanged);canvas.removeEventListener('contextlost',contextLost);},{once:true});
