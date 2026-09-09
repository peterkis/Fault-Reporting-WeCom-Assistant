import { appendCommunication } from './p2-004-communication-core.mjs';
import { G2_TEST_PREFIX, failG2 } from './p2-g2-validation-config.mjs';

// Label the persisted payload before its hash and Outbox are created. The
// Provider receives this same body; the Sender never rewrites stored content.
export function appendG2Communication(input) {
  if (!input.resolvedDestinations?.some(d => d.target_type === 'GROUP')) return appendCommunication(input);
  const command = input.command;
  if (command?.sender_kind !== 'SYSTEM' || command.purpose !== 'SYSTEM_NOTIFICATION'
    || command.message_type !== 'text' || typeof command.content?.text !== 'string') failG2('GROUP_TEMPLATE_INVALID');
  const text = command.content.text.startsWith(G2_TEST_PREFIX) ? command.content.text : G2_TEST_PREFIX + command.content.text;
  return appendCommunication({ ...input, command: { ...command, content: { ...command.content, text } } });
}
