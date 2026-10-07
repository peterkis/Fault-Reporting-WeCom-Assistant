import {create} from 'zustand';
interface UiState {sidebarCollapsed:boolean;sessionExpired:boolean;toggleSidebar:()=>void;expireSession:()=>void;reset:()=>void}
// UI state only. Auth, cards, statuses and future command results belong to the API/Query.
export const useUiStore=create<UiState>()(set=>({sidebarCollapsed:false,sessionExpired:false,
  toggleSidebar:()=>set(s=>({sidebarCollapsed:!s.sidebarCollapsed})),
  // A presentation fence raised only by a real HTTP 401; never an identity/role source.
  expireSession:()=>set({sidebarCollapsed:false,sessionExpired:true}),
  reset:()=>set({sidebarCollapsed:false,sessionExpired:false})}));
