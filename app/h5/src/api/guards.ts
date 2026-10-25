import type {LocalDateTime,EpochMs} from '../../../../contracts/yxx_self_service_contracts.js';

export type Guard<T>=(value:unknown)=>value is T;
export type Decoder<T>=(value:unknown)=>T;
export class InvalidResponse extends Error {constructor(){super('INVALID_RESPONSE');this.name='InvalidResponse';}}
export function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export const text=(value:unknown):value is string=>typeof value==='string';
export const boolean=(value:unknown):value is boolean=>typeof value==='boolean';
export const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export const nullable=<T>(guard:Guard<T>)=>(value:unknown):value is T|null=>value===null||guard(value);
export const array=<T>(guard:Guard<T>)=>(value:unknown):value is T[]=>Array.isArray(value)&&value.every(guard);
export const optional=<T>(value:unknown,guard:Guard<T>)=>value===undefined||guard(value);
export const date=(value:unknown):value is LocalDateTime=>text(value)&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
export const epoch=(value:unknown):value is EpochMs=>text(value)&&/^\d+$/.test(value);
export function decode<T>(guard:Guard<T>):Decoder<T>{return value=>{if(!guard(value))throw new InvalidResponse();return value;};}
