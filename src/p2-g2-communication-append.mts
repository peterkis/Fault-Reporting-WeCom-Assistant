type AppendInput = Parameters<typeof appendCommunication>[0];
import { appendCommunication } from './p2-004-communication-core.mjs';
import { G2_TEST_PREFIX, failG2 } from './p2-g2-validation-config.mjs';

// Label the persisted payload before its hash and Outbox are created. The
// Provider receives this same body; the Sender never rewrites stored content.
export function appendG2Communication(input:AppendInput) {
  if (!input.resolvedDestinations?.some(d => d.target_type === 'GROUP')) return appendCommunication(input);
  const command = input.command;
  if (command?.sender_kind !== 'SYSTEM' || command.purpose !== 'SYSTEM_NOTIFICATION'
    || command.message_type !== 'text' || typeof (command.content as {text?:unknown}|null)?.text !== 'string') failG2('GROUP_TEMPLATE_INVALID');
  const text = (command.content as {text:string}).text.startsWith(G2_TEST_PREFIX) ? (command.content as {text:string}).text : G2_TEST_PREFIX + (command.content as {text:string}).text;
  return appendCommunication({ ...input, command: { ...command, content: { ...(command.content as Record<string,unknown>), text } } });
}
