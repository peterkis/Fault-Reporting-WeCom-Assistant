import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,link,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {createWorkbenchAttachmentStore} from '../src/workbench-attachment-store.mjs';
import type {StoredAttachment} from '../contracts/workbench_attachment_contracts.js';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
async function withSavedAsset(run:(store:ReturnType<typeof createWorkbenchAttachmentStore>,root:string,asset:StoredAttachment,key:Buffer)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'t16-bound-')),key=randomBytes(32),ref=randomUUID();
  const asset:StoredAttachment={ref,source_intake_id:randomUUID(),source_message_id:'126',media_ref:'wmr_'+'d'.repeat(32),mime_type:'image/png',byte_size:PNG.length,sha256:createHash('sha256').update(PNG).digest('hex'),retention_until_epoch_ms:String(Date.now()+60_000),scan_status:'PASSED',classification:'INTERNAL'};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(asset)));const ciphertext=Buffer.concat([cipher.update(PNG),cipher.final()]);
  await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,assets:[asset]}));await writeFile(join(root,ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),ciphertext]));
  const store=createWorkbenchAttachmentStore({root,key});try{await run(store,root,asset,key);}finally{await store.close();key.fill(0);await rm(root,{recursive:true,force:true});}
}
test('trusted saved encrypted screenshot opens as actual authenticated bytes and releases its lease',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t16-store-')),key=randomBytes(32),ref=randomUUID();
  const record:StoredAttachment={ref,source_intake_id:randomUUID(),source_message_id:'123',media_ref:'wmr_'+'a'.repeat(32),mime_type:'image/png',byte_size:PNG.length,sha256:createHash('sha256').update(PNG).digest('hex'),retention_until_epoch_ms:String(Date.now()+60_000),scan_status:'PASSED',classification:'INTERNAL'};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(record)));
  const ciphertext=Buffer.concat([cipher.update(PNG),cipher.final()]);
  await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,assets:[record]}));
  await writeFile(join(root,ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),ciphertext]));
  const store=createWorkbenchAttachmentStore({root,key});
  try{const lease=await store.open(ref,new AbortController().signal),chunks:Buffer[]=[];
    for await(const chunk of lease.stream)chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks),PNG);await lease.close();
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  }finally{await store.close();key.fill(0);await rm(root,{recursive:true,force:true});}
});
test('private file reads reject hard links, junction roots and traversal without retaining owned handles',async()=>{
  await withSavedAsset(async(store,root,asset,key)=>{
    await assert.rejects(store.open('../manifest.json',new AbortController().signal),{code:'ATTACHMENT_NOT_FOUND'});
    const alias=join(root,'linked.asset');await link(join(root,asset.ref+'.asset'),alias);
    try{await assert.rejects(store.open(asset.ref,new AbortController().signal),{code:'ATTACHMENT_STORAGE_UNAVAILABLE'});}finally{await unlink(alias);}
    const junction=root+'-junction';await symlink(root,junction,'junction');const redirected=createWorkbenchAttachmentStore({root:junction,key});
    try{await assert.rejects(redirected.entries(),{code:'ATTACHMENT_STORAGE_UNAVAILABLE'});await assert.rejects(redirected.open(asset.ref,new AbortController().signal),{code:'ATTACHMENT_STORAGE_UNAVAILABLE'});assert.deepEqual(redirected.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});}
    finally{await redirected.close();await unlink(junction);}
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  });
});
test('authenticated HTML claiming image MIME is refused before any readable content is released',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t16-format-')),key=randomBytes(32),ref=randomUUID(),bytes=Buffer.from('<html><script>globalThis.t16Canary=1</script></html>');
  const asset:StoredAttachment={ref,source_intake_id:randomUUID(),source_message_id:'124',media_ref:'wmr_'+'b'.repeat(32),mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),retention_until_epoch_ms:String(Date.now()+60_000),scan_status:'PASSED',classification:'INTERNAL'};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(asset)));const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,assets:[asset]}));await writeFile(join(root,ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),ciphertext]));
  const store=createWorkbenchAttachmentStore({root,key});
  try{await assert.rejects(store.open(ref,new AbortController().signal),{code:'ATTACHMENT_UNSUPPORTED'});assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});}
  finally{await store.close();key.fill(0);await rm(root,{recursive:true,force:true});}
});
test('single-reader cancellation cannot close a later independent authorized read',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t16-cancel-')),key=randomBytes(32),ref=randomUUID();
  const asset:StoredAttachment={ref,source_intake_id:randomUUID(),source_message_id:'125',media_ref:'wmr_'+'c'.repeat(32),mime_type:'image/png',byte_size:PNG.length,sha256:createHash('sha256').update(PNG).digest('hex'),retention_until_epoch_ms:String(Date.now()+60_000),scan_status:'PASSED',classification:'INTERNAL'};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(asset)));const ciphertext=Buffer.concat([cipher.update(PNG),cipher.final()]);
  await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,assets:[asset]}));await writeFile(join(root,ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),ciphertext]));
  const store=createWorkbenchAttachmentStore({root,key}),previous=new AbortController();
  try{const first=await store.open(ref,previous.signal);await assert.rejects(store.open(ref,new AbortController().signal),{code:'ATTACHMENT_BUSY'});await first.close();
    const next=await store.open(ref,new AbortController().signal);previous.abort();await new Promise(r=>setImmediate(r));
    assert.equal(store.ownedResourceState().active,1);const chunks:Buffer[]=[];for await(const chunk of next.stream)chunks.push(Buffer.from(chunk));assert.deepEqual(Buffer.concat(chunks),PNG);await next.close();
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  }finally{await store.close();key.fill(0);await rm(root,{recursive:true,force:true});}
});
test('actual disk size is bounded even when trusted metadata declares a small image',async()=>{
  await withSavedAsset(async(store,root,asset)=>{
    await writeFile(join(root,asset.ref+'.asset'),Buffer.alloc(10*1024*1024+29));
    await assert.rejects(store.open(asset.ref,new AbortController().signal),{code:'ATTACHMENT_OVERSIZED'});
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  });
});
test('authenticated malformed PNG CRC and forged JPEG framing remain unavailable',async()=>{
  await withSavedAsset(async(store,root,asset,key)=>{
    const crcBroken=Buffer.from(PNG);crcBroken[crcBroken.length-1]=(crcBroken[crcBroken.length-1]??0)^1;
    for(const [bytes,mime_type] of [[crcBroken,'image/png'],[Buffer.concat([Buffer.from([255,216,255]),Buffer.from('<script>t16Canary=1</script>'),Buffer.from([255,217])]),'image/jpeg']] as const){
      const changed={...asset,mime_type,byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(changed)));const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
      await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,assets:[changed]}));await writeFile(join(root,asset.ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),ciphertext]));
      await assert.rejects(store.open(asset.ref,new AbortController().signal),{code:'ATTACHMENT_UNSUPPORTED'});
    }
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  });
});
