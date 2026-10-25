import {create} from 'zustand';
interface UiState {sidebarCollapsed:boolean;sessionError:401|403|null;sessionClosedNotice:string|null;toggleSidebar:()=>void;failSession:(status:401|403)=>void;closeSession:(notice:string)=>void;reset:()=>void}
// UI state only. Auth, cards, statuses and future command results belong to the API/Query.
export const useUiStore=create<UiState>()(set=>({sidebarCollapsed:false,sessionError:null,sessionClosedNotice:null,
  toggleSidebar:()=>set(s=>({sidebarCollapsed:!s.sidebarCollapsed})),
  // A presentation fence raised only by a real HTTP authorization failure.
  failSession:status=>set({sidebarCollapsed:false,sessionError:status,sessionClosedNotice:null}),
  closeSession:notice=>set({sidebarCollapsed:false,sessionError:null,sessionClosedNotice:notice}),
  reset:()=>set({sidebarCollapsed:false,sessionError:null,sessionClosedNotice:null})}));
