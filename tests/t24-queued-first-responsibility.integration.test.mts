import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';

function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
type PhysicalIds={messages:string[];outboxes:string[];deliveries:string[];bindings:string[];rounds:string[];attempts:string[];grants:string[]};
type Source={source_intake_id:string;source_channel:string;source_provider:string;source_chat_type:string;source_bot_id:string;reporter_wecom_userid:string;retained:boolean;inbox_matches:boolean;journey_id:string|null;journey_origin_intake_id:string|null};
type FirstBasis={id:string;cycle_no:number;source_intake_id:string;first_responsibility_event_id:string;first_responsibility_principal_id:string;first_responsibility_team_id:string;event_type:string;new_status:string};
type Intent={message_id:string;outbox_id:string;delivery_id:string;notification_binding_id:string;round_key:string;ticket_event_id:string;recipient_binding_hash:string;notification_type:string;destination_type:string;node:string;original_destination:boolean;queued_card:boolean;direct_card:boolean;status:string;attempt_count:number;side_effect_state:string;sent_at:null|string};

test('a real T06 queued assignment creates exactly one durable FIRST intent for the original single-chat reporter without accepting or sending',{timeout:240000},async()=>{
  await withT24Fixture(async context=>{
    const id=context.ticketId,path='/api/tickets/'+id,admin=context.principals[0],target=context.principals[1];
    const adminCookie=context.cookies[0],handlerCookie=context.cookies[2];assert.ok(admin&&target&&adminCookie&&handlerCookie);
    const get=async(route:string,cookie=adminCookie)=>{
      const response=await fetch(context.origin+route,{headers:{cookie}});assert.equal(response.status,200,'public GET '+route);
      return object(await response.json());
    };
    const bootstrap=await get('/api/lifecycle/bootstrap'),handler=await get('/api/lifecycle/bootstrap',handlerCookie);
    assert.equal(bootstrap.principal_id,admin.id);assert.ok(Array.isArray(bootstrap.roles)&&bootstrap.roles.includes('ADMIN'));
    assert.equal(handler.principal_id,target.id);assert.ok(Array.isArray(handler.roles)&&handler.roles.includes('HANDLER'));
    assert.equal(bootstrap.ticket_assignment_enabled,true);assert.equal(bootstrap.ticket_round_notifications_enabled,true);
    assert.equal(typeof bootstrap.csrf_token,'string');assert.equal(typeof bootstrap.csrf_token==='string'&&bootstrap.csrf_token.length>=16,true);
    const before=await get(path);assert.equal(before.status,'QUEUED');assert.equal(before.assignee_id,null);
    assert.ok(Array.isArray(before.allowed_actions)&&before.allowed_actions.includes('assign'));
    assert.equal(typeof before.version,'number');assert.ok(typeof before.version==='number'&&Number.isInteger(before.version)&&before.version>=1);
    assert.ok(before.handling_cycle===null||before.handling_cycle===undefined||object(before.handling_cycle).first_responsibility_event_id===null);
    const targets=await get(path+'/assignment-targets?resolver_team_id=PILOT_IT');
    assert.equal(targets.resolver_team_id,'PILOT_IT');assert.ok(rows(targets.resolver_teams).some(team=>team.team_id==='PILOT_IT'));
    assert.ok(rows(targets.items).some(person=>person.principal_id===target.id),'the HANDLER is an effective member of the selected group');
    const readSource=async()=>{
      const result=await context.pool.query<Source>(`SELECT t.source_intake_id::text,i.source_channel,i.source_provider,i.source_chat_type,
        i.source_bot_id,i.reporter_wecom_userid,i.retention_until>platform.local_now() AS retained,
        (m.provider=i.source_provider AND m.bot_id=i.source_bot_id AND m.sender_user_id=i.reporter_wecom_userid AND m.chat_type=i.source_chat_type) AS inbox_matches,
        j.id::text AS journey_id,j.origin_intake_id::text AS journey_origin_intake_id
        FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id
        JOIN channel.message_inbox m ON m.id=i.primary_message_id
        LEFT JOIN intake.contact_journey j ON j.origin_intake_id=i.id OR j.linked_ticket_id=t.id WHERE t.id=$1::uuid`,[id]);
      assert.equal(result.rowCount,1);const source=result.rows[0];assert.ok(source);return source;
    };
    const source=await readSource();assert.equal(source.source_intake_id,before.intake_id);
    assert.equal(source.source_channel,'WECOM_DIRECT');assert.equal(source.source_provider,'WECOM_AIBOT');assert.equal(source.source_chat_type,'single');
    assert.equal(source.retained,true);assert.equal(source.inbox_matches,true);assert.ok(source.source_bot_id&&source.reporter_wecom_userid);
    if(source.journey_id!==null)assert.equal(source.journey_origin_intake_id,source.source_intake_id);
    const originalRecipientHash=createHash('sha256').update(JSON.stringify([source.source_provider,source.source_bot_id,source.reporter_wecom_userid])).digest('hex');
    // Full-table identities include any legacy or orphan intent outside the 041 join.
    const physical=async()=>{
      const result=await context.pool.query<PhysicalIds>(`SELECT
        ARRAY(SELECT id::text FROM communication.message ORDER BY id::text) AS messages,
        ARRAY(SELECT id::text FROM communication.outbox ORDER BY id::text) AS outboxes,
        ARRAY(SELECT id::text FROM communication.delivery ORDER BY id::text) AS deliveries,
        ARRAY(SELECT id::text FROM communication.ticket_notification_binding ORDER BY id::text) AS bindings,
        ARRAY(SELECT cycle_id::text||':'||node||':'||recipient_binding_hash||':'||destination_type FROM communication.ticket_round_notification_binding ORDER BY 1) AS rounds,
        ARRAY(SELECT id::text FROM communication.delivery_attempt ORDER BY id::text) AS attempts,
        ARRAY(SELECT grant_id::text FROM pilot_ticket.reporter_access_grant ORDER BY grant_id::text) AS grants`);
      const snapshot=result.rows[0];assert.ok(snapshot);return snapshot;
    };
    const baseline=await physical();
    const command={client_command_id:randomUUID(),expected_version:before.version,reason_code:'T24_QUEUED_FIRST',target_principal_id:target.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
    const response=await fetch(context.origin+path+'/assign',{method:'POST',headers:{cookie:adminCookie,origin:context.origin,
      'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"'+before.version+'"'},body:JSON.stringify(command)});
    assert.equal(response.status,200,'real T06 assignment must succeed before FIRST is evaluated');
    const assigned=object(await response.json());assert.equal(assigned.ok,true);assert.equal(assigned.ticket_id,id);
    assert.equal(assigned.communication_choice,'RETAIN_CURRENT');assert.deepEqual(assigned.conversations,[]);assert.equal(assigned.control_event_id,null);
    const queued=await get(path);assert.equal(queued.status,'QUEUED');assert.equal(queued.assignee_id,target.id);assert.equal(queued.resolver_team_id,'PILOT_IT');
    assert.equal(queued.version,assigned.ticket_version);assert.equal(queued.intake_id,source.source_intake_id);
    const cycle=object(queued.handling_cycle),ackCycle=object(assigned.handling_cycle);
    assert.deepEqual(Object.keys(ackCycle).sort(),['cycle_no','first_responsibility_event_id','id']);
    assert.deepEqual(Object.keys(cycle).sort(),['cycle_no','first_responsibility_event_id','id','staff_completion_event_id']);
    assert.equal(cycle.cycle_no,1);
    for(const field of ['id','cycle_no','first_responsibility_event_id'] as const)assert.equal(ackCycle[field],cycle[field]);
    assert.equal(cycle.staff_completion_event_id,null);
    assert.equal(cycle.first_responsibility_event_id,assigned.ticket_event_id);
    const events=rows((await get(path+'/events')).items),firstEvent=events.find(event=>event.event_id===assigned.ticket_event_id);assert.ok(firstEvent);
    assert.equal(firstEvent.event_type,'ticket.assignment_transferred');
    assert.equal(events.some(event=>event.event_type==='ticket.accepted'||event.event_type==='ticket.started'),false);
    const basis=(await context.pool.query<FirstBasis>(`SELECT c.id::text,c.cycle_no,c.source_intake_id::text,c.first_responsibility_event_id::text,
      c.first_responsibility_principal_id::text,c.first_responsibility_team_id,e.event_type,e.new_status
      FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_handling_cycle c ON c.ticket_id=t.id AND c.id=t.current_handling_cycle_id
      JOIN pilot_ticket.ticket_event e ON e.ticket_id=c.ticket_id AND e.event_id=c.first_responsibility_event_id WHERE t.id=$1::uuid`,[id])).rows[0];
    assert.ok(basis);assert.deepEqual(basis,{id:cycle.id,cycle_no:1,source_intake_id:source.source_intake_id,
      first_responsibility_event_id:assigned.ticket_event_id,first_responsibility_principal_id:target.id,first_responsibility_team_id:'PILOT_IT',event_type:'ticket.assignment_transferred',new_status:'QUEUED'});

    await context.runtime.roundNotifications.runOnce();
    const deliveries=await get(path+'/deliveries'),items=rows(deliveries.items);
    assert.equal(items.length,1,'the QUEUED assignment basis must expose one actual FIRST Delivery');const delivery=items[0];assert.ok(delivery);
    assert.deepEqual({node:delivery.node,cycle_no:delivery.cycle_no,destination_type:delivery.destination_type,status:delivery.status,
      attempt_count:delivery.attempt_count,side_effect_state:delivery.side_effect_state,sent_at:delivery.sent_at},
    {node:'FIRST_RESPONSIBILITY',cycle_no:1,destination_type:'PERSON',status:'PENDING',attempt_count:0,side_effect_state:'NOT_ATTEMPTED',sent_at:null});
    const chain=await context.pool.query<Intent>(`SELECT m.id::text AS message_id,o.id::text AS outbox_id,d.id::text AS delivery_id,
      b.id::text AS notification_binding_id,r.cycle_id::text||':'||r.node||':'||r.recipient_binding_hash||':'||r.destination_type AS round_key,
      b.ticket_event_id::text,b.recipient_binding_hash,b.notification_type,b.destination_type,r.node,
      (d.provider=$3 AND d.channel_account_id=$4 AND d.target_id=$5 AND d.target_type='PERSON') AS original_destination,
      (m.content->>'status'='QUEUED') AS queued_card,(m.content->>'source'='DIRECT') AS direct_card,
      d.status,d.attempt_count,d.side_effect_state,d.sent_at
      FROM communication.ticket_round_notification_binding r JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id
      JOIN communication.message m ON m.id=b.message_id JOIN communication.outbox o ON o.id=b.outbox_id AND o.message_id=m.id
      JOIN communication.delivery d ON d.id=b.delivery_id AND d.outbox_id=o.id
      WHERE r.ticket_id=$1::uuid AND r.cycle_id=$2::uuid AND r.node='FIRST_RESPONSIBILITY' AND r.destination_type='PERSON'
        AND b.ticket_id=r.ticket_id AND b.recipient_binding_hash=r.recipient_binding_hash AND b.destination_type=r.destination_type`,
    [id,cycle.id,source.source_provider,source.source_bot_id,source.reporter_wecom_userid]);
    assert.equal(chain.rowCount,1);const intent=chain.rows[0];assert.ok(intent);
    assert.equal(intent.delivery_id,delivery.delivery_id);assert.equal(intent.ticket_event_id,basis.first_responsibility_event_id);
    assert.equal(intent.recipient_binding_hash,originalRecipientHash);assert.equal(intent.notification_type,'TICKET_ACCEPTED');
    assert.equal(intent.destination_type,'PERSON');assert.equal(intent.node,'FIRST_RESPONSIBILITY');assert.equal(intent.original_destination,true);
    assert.equal(intent.queued_card,true,'persisted safe status must describe QUEUED rather than accepting the Ticket');assert.equal(intent.direct_card,true);
    assert.equal(intent.status,'PENDING');assert.equal(intent.attempt_count,0);assert.equal(intent.side_effect_state,'NOT_ATTEMPTED');assert.equal(intent.sent_at,null);
    const after=await physical();
    for(const [table,intentId] of [['messages',intent.message_id],['outboxes',intent.outbox_id],['deliveries',intent.delivery_id],['bindings',intent.notification_binding_id],['rounds',intent.round_key]] as const){
      assert.equal(baseline[table].includes(intentId),false);assert.deepEqual(after[table],[...baseline[table],intentId].sort(),table+' must add only this one physical intent');
    }
    assert.deepEqual(after.attempts,baseline.attempts,'no Sender attempt');assert.deepEqual(after.grants,baseline.grants,'MEMBER_REQUIRED creates no legacy grant');
    await context.runtime.roundNotifications.runOnce();
    assert.deepEqual(await get(path+'/deliveries'),deliveries);assert.deepEqual(await physical(),after,'replay cannot add an unbound or legacy intent');
    const unchanged=await get(path);assert.equal(unchanged.status,'QUEUED');assert.equal(unchanged.version,queued.version);
    assert.equal(unchanged.assignee_id,target.id);assert.deepEqual(unchanged.handling_cycle,cycle);assert.deepEqual(await readSource(),source);
    assert.equal(JSON.stringify(deliveries).includes(source.source_bot_id),false);assert.equal(JSON.stringify(deliveries).includes(source.reporter_wecom_userid),false);
  },{ticketAssignmentEnabled:true});
});
