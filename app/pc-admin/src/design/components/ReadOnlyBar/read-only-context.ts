import {createContext} from 'react';
/** Explains only controls their existing owner has already disabled. */
export const DisabledReasonContext=createContext<string|null>(null);
