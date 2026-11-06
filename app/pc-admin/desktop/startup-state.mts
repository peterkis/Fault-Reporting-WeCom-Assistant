import type {StartupFailure,StartupSignal,StartupState} from './policy.mjs';

export interface StartupModel {
  generation:number;
  phase:'covering'|'releasing'|'released';
  active:boolean;
  video:'pending'|'playing'|'waiting'|'failed'|'reduced-motion';
  firstFrame:boolean;
  firstPlaybackComplete:boolean;
  scene:StartupState['scene'];
  failure:StartupFailure|null;
}
export type StartupEvent=
  | {type:'navigation';generation:number}
  | {type:'scene';generation:number;scene:Exclude<StartupState['scene'],'loading'>}
  | {type:'active';active:boolean}
  | {type:'video';signal:StartupSignal};

export function initialStartup():StartupModel {
  return {generation:0,phase:'covering',active:false,video:'pending',firstFrame:false,firstPlaybackComplete:false,scene:'loading',failure:null};
}

/** Media completion is never inferred from a clock, navigation or DOM readiness. */
export function transitionStartup(state:StartupModel,event:StartupEvent):StartupModel {
  let next={...state};
  if(event.type==='navigation'){
    if(!Number.isSafeInteger(event.generation)||event.generation<=state.generation)return state;
    next.generation=event.generation;next.scene='loading';
    if(state.phase==='releasing')next.phase='covering';
  }else if(event.type==='active'){
    next.active=event.active;
    if(!event.active&&state.phase==='releasing')next.phase='covering';
  }else if(event.type==='scene'){
    if(event.generation!==state.generation)return state;
    next.scene=event.scene;
  }else{
    const signal=event.signal;
    if(signal.type==='released'){
      if(state.phase!=='releasing'||signal.generation!==state.generation)return state;
      next.phase='released';
    }else if(state.phase==='released')return state;
    else if(signal.type==='failed'){
      next.video='failed';next.failure=signal.reason;
    }else if(signal.type==='reduced-motion')next.video='reduced-motion';
    else if(state.video!=='failed'&&state.video!=='reduced-motion'){
      if(signal.type==='first-frame')next.firstFrame=true;
      else if(signal.type==='playing')next.video='playing';
      else if(signal.type==='waiting'||signal.type==='stalled')next.video='waiting';
      else if(signal.type==='first-ended'&&state.active&&state.firstFrame&&state.video!=='pending')next.firstPlaybackComplete=true;
    }
  }
  if(next.phase==='covering'&&next.active&&next.scene!=='loading'
    &&(next.firstPlaybackComplete||next.video==='failed'||next.video==='reduced-motion'))next.phase='releasing';
  return next;
}
