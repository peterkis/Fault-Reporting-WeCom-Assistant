import { EXTERNAL_TICKET_STATUS } from './p1-005-pilot-ticket-core.mjs';
import { failP2016,guardP2016,publicP2016,limitP2016,cursorP2016,decodeCursorP2016,localP2016,textHashP2016 } from './p2-016-domain-contracts.mjs';
const MILESTONES=Object.freeze({'ticket.created':'工单已受理','ticket.queued':'等待受理','ticket.accepted':'已接单',
  'ticket.started':'正在处理','ticket.resumed':'已恢复处理','ticket.waiting_requester':'等待您补充信息',
  'ticket.waiting_vendor':'已联系厂商协助','ticket.resolved':'已处理，等待确认','ticket.closed':'工单已关闭',
  'ticket.reopened':'已重新受理','ticket.cancelled':'工单已撤销'});
export function createP2016ReporterTimeline({pool,access,enabled=false}) {
  async function scope(sessionToken,publicRef) {guardP2016(enabled);return access.authenticate(sessionToken,{publicRef});}
  return Object.freeze({
    async bootstrap({sessionToken}) {const s=await scope(sessionToken,null);return publicP2016({public_ref:s.public_ref,identity_mode:'BOUND_ACCESS_SESSION',read_only:true});},
    async detail({sessionToken,publicRef}) {
      const s=await scope(sessionToken,publicRef);
      const q=await pool.query('SELECT ticket_no,request_type,status,version,created_at,updated_at FROM pilot_ticket.ticket WHERE id=$1::uuid',[s.ticket_id]);
      if(q.rowCount!==1)failP2016('REPORTER_UNAUTHENTICATED',401);const t=q.rows[0];
      return publicP2016({public_ref:publicRef,ticket_no:t.ticket_no,suffix:t.ticket_no.slice(-4),
        title:t.request_type==='SERVICE_REQUEST'?'信息服务申请':'信息系统故障报修',external_status:EXTERNAL_TICKET_STATUS[t.status],
        created_at:localP2016(t.created_at),updated_at:localP2016(t.updated_at),version:t.version,
        guidance:'如未解决，请在企业微信机器人单聊中回复。'});
    },
    async timeline({sessionToken,publicRef,cursor=null,limit}) {
      const s=await scope(sessionToken,publicRef),n=limitP2016(limit,100);
      const c=cursor?decodeCursorP2016(cursor,['ref','at','ordinal']):null;
      if(c&&(c.ref!==publicRef||!Number.isInteger(c.ordinal)||c.ordinal<1))failP2016('CURSOR_INVALID');
      const q=await pool.query(`SELECT event_id::text,event_type,event_ordinal,created_at FROM pilot_ticket.ticket_event
        WHERE ticket_id=$1::uuid AND event_type=ANY($2::text[]) AND ($3::timestamp without time zone IS NULL
          OR (created_at,event_ordinal)>($3::timestamp without time zone,$4::integer))
        ORDER BY created_at,event_ordinal,event_id LIMIT $5`,[s.ticket_id,Object.keys(MILESTONES),c?localP2016(c.at):null,c?.ordinal??0,n+1]);
      const rows=q.rows.slice(0,n),last=rows.at(-1);
      await pool.query(`INSERT INTO pilot_ticket.reporter_access_event(ticket_id,session_id,event_type,reason_code)
        VALUES($1::uuid,$2::uuid,'TIMELINE_READ','SAFE_MILESTONES_ONLY')`,[s.ticket_id,s.session_id]);
      await pool.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
        UPDATE pilot_ticket.reporter_access_session SET last_seen_epoch_ms=stamp.epoch,
        last_seen_at=platform.local_from_epoch_ms(stamp.epoch) FROM stamp WHERE session_id=$1::uuid`,[s.session_id]);
      return publicP2016({items:rows.map(r=>({ref:textHashP2016(r.event_id).slice(0,32),text:MILESTONES[r.event_type],
        occurred_at:localP2016(r.created_at),source_rank:0,source_ordinal:r.event_ordinal})),
        next_cursor:q.rows.length>n?cursorP2016({ref:publicRef,at:last.created_at,ordinal:last.event_ordinal}):null});
    },
  });
}
