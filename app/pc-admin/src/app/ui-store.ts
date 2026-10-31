import {create} from 'zustand';
interface UiState {sidebarCollapsed:boolean;settingsOpen:boolean;openSettings:()=>void;closeSettings:()=>void;sessionError:401|403|null;sessionClosedNotice:string|null;loginAfterLogout:boolean;finishLogout:(notice:string)=>void;toggleSidebar:()=>void;failSession:(status:401|403)=>void;closeSession:(notice:string)=>void;reset:()=>void}
// UI state only. Auth, cards, statuses and future command results belong to the API/Query.
export const useUiStore=create<UiState>()(set=>({sidebarCollapsed:false,settingsOpen:false,sessionError:null,sessionClosedNotice:null,loginAfterLogout:false,
  openSettings:()=>set({settingsOpen:true}),closeSettings:()=>set({settingsOpen:false}),
  toggleSidebar:()=>set(s=>({sidebarCollapsed:!s.sidebarCollapsed})),
  // A presentation fence raised only by a real HTTP authorization failure.
  failSession:status=>set({sidebarCollapsed:false,settingsOpen:false,sessionError:status,sessionClosedNotice:null,loginAfterLogout:false}),
  closeSession:notice=>set({sidebarCollapsed:false,settingsOpen:false,sessionError:null,sessionClosedNotice:notice,loginAfterLogout:false}),
  finishLogout:notice=>set({sidebarCollapsed:false,settingsOpen:false,sessionError:null,sessionClosedNotice:notice,loginAfterLogout:true}),
  reset:()=>set({sidebarCollapsed:false,settingsOpen:false,sessionError:null,sessionClosedNotice:null,loginAfterLogout:false})}));
