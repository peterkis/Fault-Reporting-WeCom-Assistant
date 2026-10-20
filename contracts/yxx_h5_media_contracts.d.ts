import type {Readable} from 'node:stream';
export type H5MediaKind='VOICE'|'IMAGE'|'VIDEO';
export type H5MediaPlaybackStatus='READY'|'PENDING'|'UNAVAILABLE';
export interface H5MediaMetadata {media_ref:string;kind:H5MediaKind;mime_type:string;byte_size:number;duration_ms:number|null;playback_status:H5MediaPlaybackStatus;playback_mime_type:string|null}
export interface H5MediaReservationInput {schema_version:1;client_command_id:string;kind:H5MediaKind;mime_type:string;byte_size:number|null;duration_ms:number|null}
export interface H5MediaReservation {media_ref:string;kind:H5MediaKind;status:'RESERVED'|'WRITING'|'READY'|'BOUND'|'CANCELLED';expires_epoch_ms:string;replayed:boolean}
export type H5MediaVariant='ORIGINAL'|'PLAYABLE';
export interface H5MediaObject {media_ref:string;variant:H5MediaVariant;kind:H5MediaKind;mime_type:string;byte_size:number;sha256:string}
export interface H5MediaLease {asset:Readonly<H5MediaMetadata>;mime_type:string;byte_size:number;stream:Readable;close():Promise<void>}
export interface H5MediaPrivateStore {write(asset:H5MediaObject,bytes:Buffer,signal:AbortSignal):Promise<void>;read(asset:H5MediaObject,signal:AbortSignal):Promise<Buffer>;remove(ref:string,variant:H5MediaVariant):Promise<void>;close():Promise<void>;ownedResourceState():{active:number;handles:number;plaintext_bytes:number}}
export interface H5MediaTranscodeResult {bytes:Buffer;mime_type:string;duration_ms:number}
export interface H5MediaTranscoder {normalize(input:{bytes:Buffer;kind:Exclude<H5MediaKind,'IMAGE'>;mime_type:string;signal:AbortSignal}):Promise<H5MediaTranscodeResult>;close():Promise<void>;ownedResourceState():{active:number;processes:number;temporary_files:number}}
export interface H5MediaWeCom {sign(input:{url:string;type?:'CORPORATE'|'AGENT';signal:AbortSignal}):Promise<{corpId:string;agentId:string;timestamp:number;nonceStr:string;signature:string}>;download(input:{kind:H5MediaKind;serverId:string;signal:AbortSignal}):Promise<{bytes:Buffer;mime_type:string}>;close():Promise<void>}
