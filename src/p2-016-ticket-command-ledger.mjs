import { failP2016,hashP2016,publicP2016,transactionP2016,P2016_ERROR_CODES } from './p2-016-domain-contracts.mjs';
import { WorkbenchError } from './p2-006-workbench-query.mjs';

export function createP2016CommandLedger({pool}) {
  return Object.freeze({
    async execute({command,authorize,run}) {
      return transactionP2016(pool,async tx=>{
        // Authorization precedes every receipt lookup, including a replay.
        const context=await authorize(tx);
        const scope='P2_016:'+context.principal.principal_id;
        const hash=hashP2016(command);
        await tx.query(`INSERT INTO pilot_ticket.ticket_command_receipt(command_scope,client_command_id,command_hash,
          command_type,ticket_id,review_id,conversation_session_id,actor_principal_id,expected_ticket_version,expected_session_version)
          VALUES($1,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10::bigint)
          ON CONFLICT(command_scope,client_command_id) DO NOTHING`,
        [scope,command.client_command_id,hash,command.action,command.ticket_id??null,command.review_id??null,
          command.session_id??null,context.principal.principal_id,command.expected_version??null,command.expected_session_row_version??null]);
        const selected=await tx.query(`SELECT id::text,command_hash,state,result_snapshot,error_code,retryable
          FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE`,[scope,command.client_command_id]);
        const receipt=selected.rows[0];
        if(receipt.command_hash!==hash)failP2016('COMMAND_CONFLICT',409);
        if(receipt.state==='COMMITTED')return publicP2016({...receipt.result_snapshot,replayed:true});
        if(receipt.state==='FAILED')return publicP2016({ok:false,error:{code:receipt.error_code,retryable:receipt.retryable},replayed:true});
        await tx.query('SAVEPOINT p2016_business');
        try {
          const result=publicP2016(await run(tx,context));
          if(result.ok!==true)failP2016('ACTION_FAILED',409);
          await tx.query(`UPDATE pilot_ticket.ticket_command_receipt SET state='COMMITTED',result_snapshot=$2::jsonb,
            result_ticket_version=$3,result_ticket_event_id=$4::uuid,result_control_event_id=$5::uuid,
            updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid`,
          [receipt.id,JSON.stringify(result),result.ticket_version??null,result.ticket_event_id??null,result.control_event_id??null]);
          await tx.query('RELEASE SAVEPOINT p2016_business');
          return publicP2016({...result,replayed:false});
        } catch(error) {
          await tx.query('ROLLBACK TO SAVEPOINT p2016_business');
          const known=(error instanceof WorkbenchError&&P2016_ERROR_CODES.includes(error.code)) || ['TICKET_VERSION_CONFLICT','INVALID_STATE_TRANSITION','FORBIDDEN'].includes(error?.code);
          const code=['P2_015_COMMAND_CONFLICT','P2_015_VERSION_CONFLICT'].includes(error?.code)
            ? 'P2_016_VERSION_CONFLICT' : known?error.code:'P2_016_ACTION_FAILED';
          await tx.query(`UPDATE pilot_ticket.ticket_command_receipt SET state='FAILED',error_code=$2,retryable=false,
            updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid`,[receipt.id,code]);
          return publicP2016({ok:false,error:{code,retryable:false},replayed:false});
        }
      });
    },
  });
}
