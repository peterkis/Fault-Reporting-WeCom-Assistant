import {OnlineColleaguesView} from '../../design/components/OnlineColleagues/OnlineColleagues';
import {useOnlineColleagues} from './presence-store';

/** Card 31 F3: subscribes to the online store; hidden whenever presence is unavailable (offline, disconnected, hidden, disabled). */
export function OnlineColleagues({collapsed}:{collapsed:boolean}){
  const view=useOnlineColleagues();
  return view?<OnlineColleaguesView view={view} collapsed={collapsed}/>:null;
}
