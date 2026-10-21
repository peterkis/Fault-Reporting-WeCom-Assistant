/** Recheck at the click too: a draft or command may start after the error rendered. */
export function hasProtectedInput():boolean{return document.documentElement.dataset.h5Draft==='true'||document.documentElement.dataset.h5DetailDraft==='true'||document.documentElement.dataset.h5CommandPending==='true';}
export function reloadIfSafe():void{if(!hasProtectedInput())location.reload();}
