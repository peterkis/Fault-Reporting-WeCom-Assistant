import { createContactJourneyStore,resolveDirectJourneyAssociation } from './p2-015-contact-journey.mjs';
import { projectContactJourney } from './p2-015-projections.mjs';
import { routeRuleFailure } from './p2-015-decision-router.mjs';
import { freezePublic,safeHash } from './p2-015-domain-contracts.mjs';
import { failP2016 } from './p2-016-domain-contracts.mjs';

// Only a unique, unexpired, same-provider/bot/reporter guided candidate can attach automatically.
// Existing legs are immutable bindings; ambiguous candidates go to human review, never newest-journey guessing.
export function createP2016GuidedJourneyStore({now=()=>String(Date.now())}={}){
  const original=createContactJourneyStore();
  const publicJourney=(row,association=null)=>freezePublic({...projectContactJourney(row),association_outcome:association});
  return Object.freeze({
    async ensureJourney({transaction:tx,input}){
      if(input.entry_mode!=='DIRECT_ORGANIC')return original.ensureJourney({transaction:tx,input});
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['P2016_GUIDED:'+input.reporter_identity_hash]);
      const bound=await tx.query(`SELECT j.* FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
        WHERE l.source_intake_id=$1::uuid AND j.reporter_identity_hash=$2 FOR UPDATE OF j`,[input.origin_intake_id,input.reporter_identity_hash]);
      if(bound.rowCount)return publicJourney(bound.rows[0]);
      if(input.session_id){
        const direct=await tx.query(`SELECT j.* FROM intake.contact_journey j
          JOIN intake.channel_leg l ON l.journey_id=j.id JOIN conversation.session s ON s.id=l.conversation_session_id
          WHERE s.id=$1::uuid AND s.status<>'ENDED' AND l.leg_type='DIRECT_GUIDED' AND l.status='OPEN'
            AND j.reporter_identity_hash=$2 AND j.status IN ('OPEN','WAITING_DESCRIPTION')
          ORDER BY j.id LIMIT 2 FOR UPDATE OF j`,[input.session_id,input.reporter_identity_hash]);
        if(direct.rowCount===1)return publicJourney(direct.rows[0],'LINK');
        if(direct.rowCount>1){const created=await original.ensureJourney({transaction:tx,input});return freezePublic({...created,association_outcome:'ASK_USER_TO_SELECT'});}
      }
      const candidates=await original.listEligibleGuided({transaction:tx,reporter_identity_hash:input.reporter_identity_hash,now_epoch_ms:now(),limit:10});
      const association=resolveDirectJourneyAssociation({guided_candidates:candidates});
      if(association.outcome==='LINK'){
        const issued=await tx.query(`SELECT 1 FROM intake.continuation_ref WHERE journey_id=$1::uuid
          AND purpose='GROUP_TO_DIRECT_GUIDANCE' AND state='ISSUED' AND expires_epoch_ms>$2::bigint`,[association.journey_id,now()]);
        if(!issued.rowCount){
          // A consumed ref cannot be rebound to an unrelated direct leg. Same open Session was handled above.
          const created=await original.ensureJourney({transaction:tx,input});return freezePublic({...created,association_outcome:'ASK_USER_TO_SELECT'});
        }
        const q=await tx.query(`SELECT j.* FROM intake.contact_journey j WHERE j.id=$1::uuid AND j.reporter_identity_hash=$2
          AND j.status IN ('OPEN','WAITING_DESCRIPTION') FOR UPDATE`,[association.journey_id,input.reporter_identity_hash]);
        if(q.rowCount!==1)failP2016('GUIDED_ASSOCIATION_CONFLICT',409);return publicJourney(q.rows[0],'LINK');
      }
      const created=await original.ensureJourney({transaction:tx,input});
      return freezePublic({...created,association_outcome:association.outcome});
    },
    async ensureLeg({transaction:tx,input}){
      const q=await tx.query('SELECT origin_intake_id::text,reporter_identity_hash FROM intake.contact_journey WHERE id=$1::uuid FOR UPDATE',[input.journey_id]);
      if(q.rowCount!==1||q.rows[0].reporter_identity_hash!==input.reporter_identity_hash)failP2016('GUIDED_ASSOCIATION_CONFLICT',409);
      const guided=input.leg_type==='DIRECT_ORGANIC'&&q.rows[0].origin_intake_id!==input.source_intake_id;
      const leg=await original.ensureLeg({transaction:tx,input:{...input,...(guided?{leg_type:'DIRECT_GUIDED'}:{})}});
      if(guided&&!leg.replayed){
        const binding=await tx.query(`UPDATE intake.continuation_ref SET state='BOUND',target_leg_id=$2::uuid,row_version=row_version+1,
          updated_at=GREATEST(created_at,platform.local_now()) WHERE journey_id=$1::uuid AND purpose='GROUP_TO_DIRECT_GUIDANCE'
          AND reporter_binding_hash=$3 AND state='ISSUED' AND expires_epoch_ms>$4::bigint RETURNING id`,[input.journey_id,leg.id,input.reporter_identity_hash,now()]);
        if(binding.rowCount!==1){
          const existing=await tx.query(`SELECT 1 FROM intake.continuation_ref r JOIN intake.channel_leg l ON l.id=r.target_leg_id
            WHERE r.journey_id=$1::uuid AND r.state='BOUND' AND r.reporter_binding_hash=$2
              AND l.conversation_session_id=$3::uuid AND l.status='OPEN'`,[input.journey_id,input.reporter_identity_hash,input.conversation_session_id??null]);
          if(existing.rowCount!==1)failP2016('GUIDED_ASSOCIATION_CONFLICT',409);
        }
      }
      return leg;
    },
  });
}
export async function p2016AssociationDecision({transaction,journey,routeContext}){
  const pending=await transaction.query(`SELECT 1 FROM intake.manual_review_item WHERE service_intake_id=$1::uuid
    AND review_reason_code='MULTIPLE_GUIDED_JOURNEYS' AND status='PENDING' LIMIT 1`,[routeContext.service_intake_id]);
  if(journey.association_outcome!=='ASK_USER_TO_SELECT'&&!pending.rowCount)return null;
  const fallback=routeRuleFailure(routeContext),result={...fallback,reason_code:'MULTIPLE_GUIDED_JOURNEYS',unknown_fields:['journey_selection']};
  return freezePublic({...result,result_hash:safeHash(result)});
}
