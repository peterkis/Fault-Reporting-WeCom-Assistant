import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeWebReport,decodeWebUrge,decodeWebMedia,decodeMemberProgress,decodeMemberProgressResult,decodeMemberProgressReceipt} from '../src/workbench-web-report-browser-contracts.mjs';
import {normalizeWorkbenchMemberProgress} from '../src/workbench-web-report.mjs';
import {decodeReminderPage} from '../src/workbench-reminder-browser-contracts.mjs';
const ticketId='2b1f2c30-a051-4a44-8a2a-dc4b6467d7b1',commandId='1b1f2c30-a051-4a44-8a2a-dc4b6467d7b1';
const when='2026-10-20 12:30:00',epoch=String(Date.parse(when.replace(' ','T')+'+08:00'));
const progress={summary:'正在更换网线',estimated_at:null,estimated_epoch_ms:null,version:7,updated_at:when,updated_epoch_ms:epoch};
const urge={active:true,count:1,last_urged_at:when};
const media={media_ref:commandId,kind:'VOICE',mime_type:'audio/amr',byte_size:210,duration_ms:1200,playback_status:'PENDING',playback_mime_type:null};
const view={schema_version:1,applicable:true,item:{kind:'ticket',id:ticketId},ticket_id:ticketId,ticket_version:7,contact_requested:false,can_publish_progress:true,public_progress:progress,urge,evaluation:null,media_available:true,media:[media]};
const result={ok:true,replayed:false,client_command_id:commandId,ticket_id:ticketId,ticket_version:7,public_progress:progress};

test('H5 admin closed view preserves authorized identity and pending original recording without a fabricated playable URL',()=>{
 const decoded=decodeWebReport(view,{kind:'ticket',id:ticketId});assert.equal(decoded.media[0]?.playback_status,'PENDING');assert.equal(decoded.media[0]?.playback_mime_type,null);assert.equal(decoded.public_progress?.summary,progress.summary);
 for(const changed of [{...view,item:{kind:'ticket',id:commandId}},{...view,internal_note:'private'},{...view,media:[media,media]},{...view,media_available:false},{...view,ticket_version:null},{...view,applicable:false}])assert.throws(()=>decodeWebReport(changed,{kind:'ticket',id:ticketId}));
});
test('H5 admin media rejects executable MIME, cross-kind playback, oversized and coercible metadata',()=>{
 assert.equal(decodeWebMedia(media).kind,'VOICE');
 for(const changed of [{...media,mime_type:'image/svg+xml'},{...media,kind:'IMAGE'},{...media,byte_size:20*1024*1024+1},{...media,playback_status:['PENDING']},{...media,playback_status:'READY'},{...media,kind:['VOICE']},{...media,duration_ms:60_001},{...media,download_url:'https://other.example.test'}])assert.throws(()=>decodeWebMedia(changed));
});
test('H5 admin current-round urgency fails closed for zero-count active or arbitrary calendar facts',()=>{
 assert.deepEqual(decodeWebUrge(urge),urge);assert.deepEqual(decodeWebUrge({active:false,count:0,last_urged_at:null}),{active:false,count:0,last_urged_at:null});
 for(const changed of [{...urge,count:0},{...urge,count:'1'},{...urge,last_urged_at:null},{...urge,last_urged_at:'2026-02-29 12:30:00'},{...urge,can_urge:true}])assert.throws(()=>decodeWebUrge(changed));
});
test('H5 admin public progress validates Shanghai local and physical timestamps together',()=>{
 assert.deepEqual(decodeMemberProgress(progress),progress);assert.equal(decodeMemberProgress({...progress,updated_epoch_ms:String(BigInt(epoch)+567n)}).updated_epoch_ms,String(BigInt(epoch)+567n));
 for(const changed of [{...progress,updated_epoch_ms:String(BigInt(epoch)+1000n)},{...progress,estimated_epoch_ms:epoch},{...progress,estimated_at:when},{...progress,updated_at:'2026-04-31 12:30:00'},{...progress,summary:'  '}])assert.throws(()=>decodeMemberProgress(changed));
});
test('H5 admin exact result and read-only receipt bind the original command and submitted version',()=>{
 const expected={ticketId,commandId,input:{client_command_id:commandId,expected_version:6,summary:progress.summary,estimated_at:null}};
 assert.deepEqual(decodeMemberProgressResult(result,expected),result);
 for(const changed of [{...result,client_command_id:ticketId},{...result,ticket_version:8},{...result,public_progress:{...progress,summary:'different'}},{...result,replayed:'true'}])assert.throws(()=>decodeMemberProgressResult(changed,expected));
 const unknown={state:'UNKNOWN',client_command_id:commandId,ticket_id:ticketId};assert.deepEqual(decodeMemberProgressReceipt(unknown,expected),unknown);
 assert.equal(decodeMemberProgressReceipt({state:'COMMITTED',client_command_id:commandId,ticket_id:ticketId,result},expected).state,'COMMITTED');
 for(const changed of [{...unknown,summary:'retained private body'},{...unknown,state:'FAILED'},{...unknown,client_command_id:ticketId}])assert.throws(()=>decodeMemberProgressReceipt(changed,expected));
});
test('H5 admin public progress input remains a narrow separate summary and explicit nullable ETA',()=>{
 const input={client_command_id:commandId,expected_version:6,summary:'  已联系维修方  ',estimated_at:null};assert.deepEqual(normalizeWorkbenchMemberProgress(input),{...input,summary:'已联系维修方'});
 for(const changed of [{...input,internal_note:'must remain internal'},{...input,expected_version:'6'},{...input,summary:'x'.repeat(1001)},{...input,summary:''},{...input,estimated_at:'2026-02-29 13:00:00'},{...input,summary:'private\u0000body'}])assert.throws(()=>normalizeWorkbenchMemberProgress(changed));
});
test('H5 staff urge reminder is ticket-only and contains no report body or material identifiers',()=>{
 const row={reminder_id:'a'.repeat(64),event_id:'1',reason:'RELATED_REPORT_URGE',canonical_item:{kind:'ticket',id:ticketId},source_key:'b'.repeat(64),source_revision:'1',occurred_at:when};
 const page={schema_version:1,items:[row],as_of_event_id:'1',baseline_token:'opaque_baseline',next_cursor:null,reset_required:false};assert.equal(decodeReminderPage(page).items[0]?.reason,'RELATED_REPORT_URGE');
 for(const changed of [{...row,body:'private'},{...row,canonical_item:{...row.canonical_item,kind:'review'}},{...row,reason:['RELATED_REPORT_URGE']}])assert.throws(()=>decodeReminderPage({...page,items:[changed]}));
});
