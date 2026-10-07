import type {Readable} from 'node:stream';
export type AttachmentReason = 'STORAGE_UNAVAILABLE'|'EXPIRED'|'MISSING'|'OVERSIZED'|'UNSUPPORTED'|'UNTRUSTED'|'INTEGRITY_FAILED'|'BUSY';
export interface AttachmentMetadata {ref:string;display_name:string;mime_type:string;byte_size:number;available:boolean;reason:AttachmentReason|null}
export interface AttachmentPage {available:boolean;reason:AttachmentReason|null;items:AttachmentMetadata[];truncated:boolean}
/** Trusted server manifest only; these fields never go to a browser. */
export interface StoredAttachment {ref:string;source_intake_id:string;source_message_id:string;media_ref:string;mime_type:string;byte_size:number;sha256:string;retention_until_epoch_ms:string;scan_status:'PASSED'|'PENDING'|'REJECTED';classification:'INTERNAL'|'SENSITIVE_INTERNAL'|'PATIENT_SENSITIVE'|'SECRET'}
export interface AttachmentLease {stream:Readable;close():Promise<void>}
export interface AttachmentStore {entries():Promise<readonly StoredAttachment[]>;open(ref:string,signal:AbortSignal):Promise<AttachmentLease>;close():Promise<void>;ownedResourceState():{active:number;handles:number;plaintext_bytes:number}}
