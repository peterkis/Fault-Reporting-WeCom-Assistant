import {createContext,useContext,useMemo,type ReactNode} from 'react';
import type {H5Profile} from '../../../contracts/yxx_h5_v2_contracts.js';
import type {Bootstrap} from './api/types';

export type SessionIdentity=Omit<Bootstrap,'h5'>&{h5:Omit<Bootstrap['h5'],'profile'>};
export interface SessionStatus {checking:boolean;writeReady:boolean;membershipRevision:string;refresh:()=>Promise<void>}
const IdentityContext=createContext<SessionIdentity|null>(null);
const ProfileContext=createContext<H5Profile|null>(null);
const StatusContext=createContext<SessionStatus|null>(null);
function required<T>(value:T|null):T{if(value===null)throw new Error('Authenticated member session required');return value;}
export function useIdentity():SessionIdentity{return required(useContext(IdentityContext));}
export function useProfile():H5Profile{return required(useContext(ProfileContext));}
export function useSessionStatus():SessionStatus{return required(useContext(StatusContext));}
/** Compatibility projection; focused children can subscribe to identity or profile alone. */
export function useSession():Bootstrap{const identity=useIdentity(),profile=useProfile(),{writeReady}=useSessionStatus();return useMemo(()=>({...identity,can_submit:identity.can_submit&&writeReady,can_supplement:identity.can_supplement&&writeReady,h5:{...identity.h5,profile,can_upload:identity.h5.can_upload&&writeReady,can_urge:identity.h5.can_urge&&writeReady,can_evaluate:identity.h5.can_evaluate&&writeReady}}),[identity,profile,writeReady]);}
export function SessionProvider({session,status,children}:{session:Bootstrap;status:SessionStatus;children:ReactNode}){
 const {profile,...capabilities}=session.h5;
 const identity=useMemo<SessionIdentity>(()=>({authenticated:session.authenticated,identity_mode:session.identity_mode,read_only:session.read_only,can_submit:session.can_submit,can_supplement:session.can_supplement,csrf_token:session.csrf_token,recovery_scope:session.recovery_scope,...(session.feedback_draft_recovery_enabled===undefined?{}:{feedback_draft_recovery_enabled:session.feedback_draft_recovery_enabled}),h5:capabilities}),[session.authenticated,session.identity_mode,session.read_only,session.can_submit,session.can_supplement,session.csrf_token,session.recovery_scope,session.feedback_draft_recovery_enabled,capabilities.can_upload,capabilities.can_urge,capabilities.can_evaluate,capabilities.can_view_department,capabilities.sdk,capabilities.support,capabilities.limits]);
 return <IdentityContext.Provider value={identity}><ProfileContext.Provider value={profile}><StatusContext.Provider value={status}>{children}</StatusContext.Provider></ProfileContext.Provider></IdentityContext.Provider>;
}
