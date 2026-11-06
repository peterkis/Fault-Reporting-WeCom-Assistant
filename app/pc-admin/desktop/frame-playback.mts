export const FRAME_COUNT=68;
export const FRAME_RATE=30;
export const FRAME_DURATION_MS=1000/FRAME_RATE;
export const CYCLE_DURATION_MS=1000*FRAME_COUNT/FRAME_RATE;

export interface FramePlaybackSnapshot {
  currentFrame:number;drawCount:number;cycleCount:number;firstCycleComplete:boolean;
  firstCycleActiveMs:number|null;activeMs:number;residentFrames:readonly number[];
  inFlight:number|null;maxResidentFrames:number;maxInFlight:number;disposed:boolean;waiting:boolean;
}
interface Frame {close():void}
interface FramePlaybackOptions<T extends Frame> {
  loadFrame(index:number):Promise<T>;
  drawFrame(frame:T,index:number):void;
  onSignal?(signal:'first-frame'|'playing'|'waiting'|'first-cycle-complete'):void;
  onError?(error:unknown):void;
}

/** One sequential decoder and a current/next/two-ahead window; no DOM or clock timers. */
export function createFramePlayback<T extends Frame>(options:FramePlaybackOptions<T>){
  const frames=new Map<number,T>();
  let currentFrame=-1,drawCount=0,cycleCount=0,firstCycleComplete=false,firstCycleActiveMs:number|null=null;
  let activeMs=0,heldMs=0,budgetMs=0,lastTick:number|null=null,inFlight:number|null=null,maxResidentFrames=0,maxInFlight=0;
  let disposed=false,waiting=false,playing=false,cycleSettled=false;
  const snapshot=():FramePlaybackSnapshot=>({currentFrame,drawCount,cycleCount,firstCycleComplete,firstCycleActiveMs,activeMs,residentFrames:[...frames.keys()],inFlight,maxResidentFrames,maxInFlight,disposed,waiting});
  const close=(frame:T)=>{try{frame.close();}catch{/* Continue releasing the other owned frames. */}};
  const pause=()=>{lastTick=null;budgetMs=Math.min(budgetMs,heldMs,FRAME_DURATION_MS);playing=false;};
  const dispose=()=>{if(disposed)return;disposed=true;pause();for(const frame of frames.values())close(frame);frames.clear();};
  const fail=(error:unknown)=>{if(disposed)return;dispose();options.onError?.(error);};
  const pump=()=>{
    if(disposed||inFlight!==null)return;
    const first=currentFrame<0?0:currentFrame;
    const wanted=Array.from({length:3},(_unused,offset)=>(first+offset)%FRAME_COUNT);
    const index=wanted.find(value=>!frames.has(value));
    if(index===undefined)return;
    inFlight=index;maxInFlight=Math.max(maxInFlight,1);
    let decoding:Promise<T>;
    try{decoding=options.loadFrame(index);}catch(error){inFlight=null;fail(error);return;}
    void decoding.then(frame=>{
      inFlight=null;
      if(disposed){close(frame);return;}
      frames.set(index,frame);maxResidentFrames=Math.max(maxResidentFrames,frames.size);pump();
    }).catch(error=>{inFlight=null;fail(error);});
  };
  const tick=(now:number,active:boolean):FramePlaybackSnapshot=>{
    if(!Number.isFinite(now)||now<0)throw Error('FRAME_CLOCK_INVALID');
    if(disposed)return snapshot();
    if(!active){pause();return snapshot();}
    const delta=lastTick===null?0:Math.max(0,now-lastTick);lastTick=now;
    if(currentFrame>=0){activeMs+=delta;heldMs+=delta;budgetMs+=delta;}
    // Keep the small steady-state rAF phase remainder. A decoder wait, pause or
    // long callback gap must never leave a debt that races through later frames.
    if(delta>=FRAME_DURATION_MS*2||waiting)budgetMs=Math.min(budgetMs,FRAME_DURATION_MS);
    // rAF timestamps can be quantized to 0.1ms; this tolerance applies only to
    // normal deadlines, leaving the final dwell and source-duration checks strict.
    if(currentFrame>=0&&budgetMs+0.2<FRAME_DURATION_MS)return snapshot();
    if(currentFrame===FRAME_COUNT-1&&!cycleSettled){
      if(heldMs+0.000001<FRAME_DURATION_MS||!firstCycleComplete&&activeMs<CYCLE_DURATION_MS)return snapshot();
      cycleSettled=true;cycleCount++;
      if(!firstCycleComplete){firstCycleComplete=true;firstCycleActiveMs=activeMs;options.onSignal?.('first-cycle-complete');}
    }
    const next=(currentFrame+1)%FRAME_COUNT,frame=frames.get(next);
    if(!frame){budgetMs=Math.min(budgetMs,FRAME_DURATION_MS);if(!waiting){waiting=true;playing=false;options.onSignal?.('waiting');}pump();return snapshot();}
    try{options.drawFrame(frame,next);}catch(error){fail(error);return snapshot();}
    const previous=currentFrame;currentFrame=next;drawCount++;heldMs=0;budgetMs=waiting||previous<0?0:budgetMs-FRAME_DURATION_MS;cycleSettled=false;
    if(previous>=0){const old=frames.get(previous);if(old)close(old);frames.delete(previous);}
    if(drawCount===1)options.onSignal?.('first-frame');
    waiting=false;if(!playing){playing=true;options.onSignal?.('playing');}
    pump();return snapshot();
  };
  pump();
  return {tick,pause,dispose,snapshot};
}
