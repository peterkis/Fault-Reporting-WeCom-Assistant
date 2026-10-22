import {readDecoders} from './read-decode';
import {actionDecoders} from './action-decode';
import type {EndpointResponseMap} from './types';
import type {Decoder} from './guards';

export {InvalidResponse,record} from './guards';
export type {Guard,Decoder} from './guards';
/** Compatibility surface for tooling; protected reads import read-decode directly. */
export const decoders={...readDecoders,...actionDecoders} satisfies {[K in keyof EndpointResponseMap]:Decoder<EndpointResponseMap[K]>};
