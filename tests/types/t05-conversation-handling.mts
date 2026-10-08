import {normalizeConversationHandlingCommand} from '../../src/workbench-ticket-conversation-handling.mjs';
import type {P2016ConversationHandlingCommand,P2016RelatedConversationPage,P2016ConversationHandlingAcknowledgement} from '../../contracts/p2_016_contracts.js';
declare const input:unknown;
const command=normalizeConversationHandlingCommand(input);
const choice:'TAKE_SELECTED'|'RETAIN_CURRENT'=command.communication_choice;void choice;
declare const body:P2016ConversationHandlingCommand;
// @ts-expect-error -- Browsers cannot select a new target or force Conversation transfer authority.
const forced:P2016ConversationHandlingCommand={...body,force:true};void forced;
// @ts-expect-error -- Write versions are bounded numbers while query BIGINT versions remain exact strings.
const wrongVersion:P2016ConversationHandlingCommand={...body,sessions:[{session_id:'synthetic',expected_row_version:'1'}]};void wrongVersion;
declare const page:P2016RelatedConversationPage;
const row=page.items[0];if(row){const version:string=row.session_row_version;void version;}
declare const ack:P2016ConversationHandlingAcknowledgement;
if(ack.state==='COMMITTED'){
  const version:number=ack.ticket_version;void version;
  // @ts-expect-error -- The scoped readonly acknowledgement never exposes Session references or Control results.
  const sessions=ack.conversations;void sessions;
}
