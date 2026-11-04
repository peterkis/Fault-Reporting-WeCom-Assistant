import type {WorkbenchDetail} from '../../../api/client';

export function recordKind(record:Pick<WorkbenchDetail['records'][number],'type'|'old_status'|'new_status'|'text'|'audience'>):'status'|'note'|'report'|'event'{
  const note=Boolean(record.text?.trim()&&(record.audience==='INTERNAL'||record.audience==='EXTERNAL'));
  // Ticket notes also carry the current status; that field is not a transition.
  if(record.type==='ticket.note_added')return note?'note':'event';
  if(record.old_status&&record.new_status&&record.old_status!==record.new_status)return 'status';
  if(note)return 'note';
  return record.audience==='REPORT'?'report':'event';
}
