import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHash,createCipheriv} from 'node:crypto';
import {createWorkbenchAttachmentStore} from '../../app/server/src/workbench-attachment-store.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../../app/server/src/p2-016-runtime.mjs';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import type {StoredAttachment,AttachmentStore} from '../../contracts/workbench_attachment_contracts.js';
export const T16_PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
interface Base {pool:PostgresPool;tickets:{ticket:{id:string};intake:{intakeId:string;messageId:string}}[];principals:{id:string}[];outsider:{id:string};runtime:P2016EnabledRuntime;origin:string}
interface Fixture extends Base {store:AttachmentStore;reads:{entries:number;opens:number};asset:StoredAttachment;root:string;key:Buffer;cookie:string;outsiderCookie:string;browserCookie:{name:string;value:string;url:string|undefined;httpOnly:true;secure:boolean;sameSite:'Strict';expires:number};save:(assets:StoredAttachment[],bytes?:Buffer)=>Promise<void>}
export async function withT16Fixture(run:(fixture:Fixture)=>Promise<void>,{enabled=true,storage=true,manualReviewEnabled=false,employeeReadEnabled=false,decorateStore=(store:AttachmentStore)=>store}:{enabled?:boolean;storage?:boolean;manualReviewEnabled?:boolean;employeeReadEnabled?:boolean;decorateStore?:(store:AttachmentStore,save:Fixture['save'],asset:StoredAttachment)=>AttachmentStore}={}) {
  await withWeb01Fixture(async(f:Base)=>{
    await f.runtime.stop();
    const root=await mkdtemp(join(tmpdir(),'t16-assets-')),key=randomBytes(32),selected=f.tickets[0];if(!selected)throw Error('T16_TICKET_REQUIRED');
    const asset:StoredAttachment={ref:randomUUID(),source_intake_id:selected.intake.intakeId,source_message_id:selected.intake.messageId,media_ref:'wmr_'+'a'.repeat(32),mime_type:'image/png',byte_size:T16_PNG.length,sha256:createHash('sha256').update(T16_PNG).digest('hex'),retention_until_epoch_ms:String(Date.now()+300_000),scan_status:'PASSED',classification:'INTERNAL'};
    const save=async(assets:StoredAttachment[],bytes:Buffer=T16_PNG)=>{
      for(const record of assets){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(record)));const content=Buffer.concat([cipher.update(bytes),cipher.final()]);await writeFile(join(root,record.ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),content]));}
      await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,assets}));
    };
    await f.pool.query("UPDATE channel.message_inbox SET msg_type='image',normalized_message=jsonb_build_object('content',jsonb_build_array(jsonb_build_object('kind','media','media',jsonb_build_object('type','image','source_index',0,'download_ref',$2::text))),'quote',NULL) WHERE id=$1::bigint",[asset.source_message_id,asset.media_ref]);
    await save([asset]);const store=createWorkbenchAttachmentStore({root,key}),reads={entries:0,opens:0};
    const observed:AttachmentStore={...store,entries:()=>{reads.entries++;return store.entries();},open:(ref,signal)=>{reads.opens++;return store.open(ref,signal);}};
    const options={pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id],externalSendEnabled:false,workbenchMediaEmployeeReadEnabled:employeeReadEnabled,workbenchManualReviewEnabled:manualReviewEnabled,workbenchAttachmentsEnabled:enabled,attachmentStore:storage?decorateStore(observed,save,asset):null};
    const runtime=createP2016Runtime(options);
    try{const started=await runtime.start(),[first,other]=started.cookies??[];if(!first||!other)throw Error('T16_AUTH_REQUIRED');
      await run({...f,runtime,store,reads,asset,root,key,save,cookie:first.name+'='+first.value,outsiderCookie:other.name+'='+other.value,browserCookie:first});
    }finally{await runtime.stop();await store.close();key.fill(0);if(runtime.server.listening)throw Error('T16_SERVER_NOT_CLOSED');
      const state=store.ownedResourceState();if(state.active||state.handles||state.plaintext_bytes)throw Error('T16_STORE_RESIDUAL');await rm(root,{recursive:true,force:true});}
  });
}
