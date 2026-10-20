import {createContext,useContext} from 'react';
import type{Bootstrap}from './api/types';
export const SessionContext=createContext<Bootstrap|null>(null);
export function useSession():Bootstrap{const session=useContext(SessionContext);if(!session)throw new Error('Authenticated member session required');return session;}
