import type {Readable} from 'node:stream';
export type H5MediaKind='VOICE'|'IMAGE'|'VIDEO';
export type H5MediaPlaybackStatus='READY'|'PENDING'|'UNAVAILABLE';
export interface H5MediaMetadata {media_ref:string;kind:H5MediaKind;mime_type:string;byte_size:number;duration_ms:number|null;playback_status:H5MediaPlaybackStatus;playback_mime_type:string|null}
export interface H5MediaConversionFailure {code:string;stage:'PLAYABLE'|'THUMBNAIL';at:string}
export interface H5MediaStaffMetadata extends H5MediaMetadata {conversion_error?:H5MediaConversionFailure|null;thumbnail?:{status:H5MediaPlaybackStatus;mime_type:string|null;byte_size:number|null}}
/** New page projection only. The closed legacy metadata shape stays unchanged. */
export interface H5MediaPreviewMetadata extends H5MediaMetadata {thumbnail_status:H5MediaPlaybackStatus;thumbnail_mime_type:string|null;thumbnail_byte_size:number|null}
export interface H5MediaReservationInput {schema_version:1;client_command_id:string;kind:H5MediaKind;mime_type:string;byte_size:number|null;duration_ms:number|null}
export interface H5MediaReservation {media_ref:string;kind:H5MediaKind;status:'RESERVED'|'WRITING'|'READY'|'BOUND'|'CANCELLED';expires_epoch_ms:string;replayed:boolean}
export type H5MediaVariant='ORIGINAL'|'PLAYABLE'|'THUMBNAIL';
export interface H5MediaObject {media_ref:string;variant:H5MediaVariant;kind:H5MediaKind;mime_type:string;byte_size:number;sha256:string}
/** Inclusive, already resolved against the authenticated representation length. */
export interface H5MediaByteRange {start:number;end:number}
export interface H5MediaDescription {asset:Readonly<H5MediaMetadata>;mime_type:string;byte_size:number;sha256:string;variant:H5MediaVariant}
export interface H5MediaLease {asset:Readonly<H5MediaMetadata>;mime_type:string;byte_size:number;total_byte_size:number;range:H5MediaByteRange|null;signal:AbortSignal;stream:Readable;close():Promise<void>}
/** One request-local, employee-authorized metadata snapshot; never cached or reused. */
export interface H5MediaEmployeeRead {description:Readonly<H5MediaDescription>;open(range?:H5MediaByteRange):Promise<H5MediaLease>;close():Promise<void>}
export interface H5MediaPrivateStore {write(asset:H5MediaObject,bytes:Buffer,signal:AbortSignal):Promise<void>;read(asset:H5MediaObject,signal:AbortSignal):Promise<Buffer>;remove(ref:string,variant:H5MediaVariant):Promise<void>;close():Promise<void>;ownedResourceState():{active:number;handles:number;plaintext_bytes:number}}
export interface H5MediaTranscodeResult {bytes:Buffer;mime_type:string;duration_ms:number}
export interface H5MediaThumbnailResult {bytes:Buffer;mime_type:'image/jpeg'}
export interface H5MediaTranscoder {normalize(input:{bytes:Buffer;kind:Exclude<H5MediaKind,'IMAGE'>;mime_type:string;signal:AbortSignal;performanceEnabled?:boolean;preserveQuality?:boolean;maxOutputBytes?:number}):Promise<H5MediaTranscodeResult>;compressImage?(input:{bytes:Buffer;mime_type:string;signal:AbortSignal;maxOutputBytes:number}):Promise<{bytes:Buffer;mime_type:'image/webp'}>;thumbnail?(input:{bytes:Buffer;mime_type:string;signal:AbortSignal;kind?:'IMAGE'|'VIDEO'}):Promise<H5MediaThumbnailResult>;close():Promise<void>;ownedResourceState():{active:number;processes:number;temporary_files:number}}
export interface H5MediaWeCom {sign(input:{url:string;type?:'CORPORATE'|'AGENT';signal:AbortSignal}):Promise<{corpId:string;agentId:string;timestamp:number;nonceStr:string;signature:string}>;download(input:{kind:H5MediaKind;serverId:string;signal:AbortSignal}):Promise<{bytes:Buffer;mime_type:string}>;close():Promise<void>}
