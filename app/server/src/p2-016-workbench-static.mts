import type {ServerResponse} from 'node:http';

const destinations:Readonly<Record<string,string>>=Object.freeze({
  '/workbench':'/workbench/app/','/workbench/':'/workbench/app/',
  '/workbench/lifecycle':'/workbench/app/','/workbench/incidents':'/workbench/app/incidents/candidates',
});
/** Only the P2-016 assembly that mounts the formal PC frontend installs these aliases. */
export function createP2016WorkbenchStatic({enabled=false}:{enabled?:boolean}={}){
  if(typeof enabled!=='boolean')throw new TypeError('Static handler configuration is invalid.');
  return async(pathname:string,response:ServerResponse)=>{
    const location=destinations[pathname];if(!enabled||!location)return false;
    response.writeHead(302,{location,'cache-control':'no-store'});response.end();return true;
  };
}
