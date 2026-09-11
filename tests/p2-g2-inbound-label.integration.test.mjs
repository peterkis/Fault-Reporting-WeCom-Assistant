import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { createP2G1HumanOnlyAssembly } from '../src/p2-g1-human-only-assembly.mjs';
import { createG2OperationalIntake } from '../src/p2-g2-service-loop-assembly.mjs';
import { createP2012ApprovedGroupReporterRegistry, createP2012LiveReporterScope } from '../src/p2-012-live-reporter-scope.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';

test('G2 frozen continuation template accepts the actual dynamic receipt ref and preserves raw case and run label',async()=>{
  await withG2Runtime(async f=>{
    const {manifest}=configurationFixture();manifest.scope.bot_hash=g2Hash(f.botId);manifest.scope.group_hashes=[g2Hash(f.groupId)];
    manifest.scope.person_hashes=f.reporters.map(g2Hash);manifest.scope.direct_organic_person_hash=manifest.scope.person_hashes[2];
    manifest.scope.approved_inputs.push('续接工单 {PUBLIC_REF}：补充，处方提交不了。');
    const assembly=createP2G1HumanOnlyAssembly({coordinator:f.runtime.coordinator,
      operationalIntake:createG2OperationalIntake({pool:f.pool,configuration:{manifest,botId:f.botId}})});
    const frame=(text,chatType)=>({cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:f.botId,
      chattype:chatType,...(chatType==='group'?{chatid:f.groupId}:{}),from:{userid:f.reporters[0]},msgtype:'text',text:{content:'【p2-g2测试】'+text}}});
    assert.equal((await assembly.handleFrame(frame('处方提交不了','group'))).ok,true);await f.pump();
    const ref=(await f.pool.query("SELECT m.content->>'text' AS text FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id WHERE b.destination_type='GROUP'")).rows[0].text.match(/续接工单 ([A-Za-z0-9_-]{32})：/u)[1];
    const direct=frame('续接工单 '+ref+'：补充，处方提交不了。','single');
    direct.body.text.content='  '+direct.body.text.content;
    assert.equal((await assembly.handleFrame(direct)).ok,true);await f.pump();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    const saved=(await f.pool.query('SELECT raw_text FROM channel.message_inbox WHERE msg_id=$1',[direct.body.msgid])).rows[0].raw_text;
    assert.ok(saved.startsWith('  【p2-g2测试】'));assert.ok(saved.includes(ref));
    assert.equal((await assembly.handleFrame(frame('续接工单 '+ref+'：未经批准的内容','single'))).ok,false);
    assert.equal(f.providerCalls.length,0);
  });
});

test('P2-G2 scope label remains in raw evidence but cannot become a classification keyword', async () => {
  await withG2Runtime(async f => {
    const { manifest } = configurationFixture();
    manifest.scope.bot_hash = g2Hash(f.botId); manifest.scope.group_hashes = [g2Hash(f.groupId)];
    manifest.scope.person_hashes = f.reporters.map(g2Hash); manifest.scope.direct_organic_person_hash = manifest.scope.person_hashes[2];
    const intake = createG2OperationalIntake({ pool: f.pool, configuration: { manifest, botId: f.botId } });
    const assembly = createP2G1HumanOnlyAssembly({ operationalIntake: intake, coordinator: f.runtime.coordinator });
    const frame = (text, person, chatType = 'group') => ({ cmd: 'aibot_msg_callback', headers: { req_id: randomUUID() }, body: {
      msgid: randomUUID(), aibotid: f.botId, chattype: chatType, ...(chatType === 'group' ? { chatid: f.groupId } : {}),
      from: { userid: person }, msgtype: 'text', text: { content: text },
    } });
    for (const [index, [text, code]] of [['@测试助手', 'NEEDS_DESCRIPTION'], ['处方提交不了', 'TICKET_ELIGIBLE'], ['谢谢', 'ACKNOWLEDGEMENT']].entries()) {
      const input = frame('【p2-g2测试】' + text, f.reporters[index]);
      assert.equal((await assembly.handleFrame(input)).ok, true);
      const row = (await f.pool.query('SELECT raw_text,clean_text FROM channel.message_inbox WHERE msg_id=$1', [input.body.msgid])).rows[0];
      assert.ok(row.raw_text.startsWith('【p2-g2测试】')); assert.equal(row.clean_text, text);
      const result = await f.pump(); assert.equal(result.results[0].result_code, code);
    }
    const before = (await f.pool.query('SELECT count(*)::integer AS n FROM channel.message_inbox')).rows[0].n;
    for (const text of ['处方提交不了', '无关【p2-g2测试】处方提交不了', '【p2-g2测试】未批准的额外指令'])
      assert.equal((await assembly.handleFrame(frame(text, f.reporters[0]))).ok, false);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM channel.message_inbox')).rows[0].n, before);

    const discoveredReporter = 'synthetic-g2-discovered-reporter';
    assert.equal((await assembly.handleFrame(frame('【p2-g2测试】@测试助手', discoveredReporter))).ok, true);
    await f.pump();
    const registry = createP2012ApprovedGroupReporterRegistry({ pool: f.pool, botId: f.botId,
      groupHashes: manifest.scope.group_hashes, testLabel: '【p2-g2测试】', labelSource: 'raw' });
    assert.equal(await registry.isApprovedGroupReporter({ sender_user_id: discoveredReporter }), true);
    const scope = createP2012LiveReporterScope({ bot_id: f.botId, person_hashes: manifest.scope.person_hashes,
      group_hashes: manifest.scope.group_hashes, ...registry, testLabel: '【p2-g2测试】', labelSource: 'raw' });
    assert.equal(await scope.authorizesDestination({ target_type: 'PERSON', target_id: discoveredReporter }), false);
    assert.equal((await assembly.handleFrame(frame('【p2-g2测试】处方提交不了', discoveredReporter, 'single'))).ok, true);
    await f.pump();
    assert.equal(await scope.authorizesDestination({ target_type: 'PERSON', target_id: discoveredReporter }), true);
    assert.equal(f.providerCalls.length, 0);
  });
});

test('P2-G2 approved image-only input uses the existing no-OCR degradation without inventing text or image content', async () => {
  await withG2Runtime(async f => {
    const { manifest } = configurationFixture();
    manifest.scope.person_hashes = f.reporters.map(g2Hash); manifest.scope.direct_organic_person_hash = manifest.scope.person_hashes[2];
    const imageFrame = person => ({ cmd: 'aibot_msg_callback', headers: { req_id: randomUUID() }, body: {
      msgid: randomUUID(), aibotid: f.botId, chattype: 'single', from: { userid: person }, msgtype: 'image',
      image: { url: 'https://synthetic.invalid/image-never-fetched', aeskey: 'synthetic-never-used-key' },
    } });
    const assemblyFor = () => createP2G1HumanOnlyAssembly({ coordinator: f.runtime.coordinator,
      operationalIntake: createG2OperationalIntake({ pool: f.pool, configuration: { manifest, botId: f.botId } }) });
    assert.equal((await assemblyFor().handleFrame(imageFrame(f.reporters[0]))).ok, false);
    manifest.scope.approved_inputs.push('[图片]');
    const assembly = assemblyFor();
    assert.equal((await assembly.handleFrame(imageFrame('foreign-image-only-reporter'))).ok, false);
    const frame = imageFrame(f.reporters[0]);
    assert.equal((await assembly.handleFrame(frame)).ok, true);
    const message = (await f.pool.query('SELECT raw_text,clean_text,normalized_message FROM channel.message_inbox WHERE msg_id=$1', [frame.body.msgid])).rows[0];
    assert.equal(message.raw_text ?? '', ''); assert.equal(message.clean_text ?? '', '');
    assert.equal(message.normalized_message.content[0].kind, 'media');
    const batch = await f.pump();
    assert.equal(batch.results[0].result_code, 'NEEDS_DESCRIPTION');
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n, 0);
    assert.equal(f.providerCalls.length, 0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM channel.message_inbox')).rows[0].n, 1);
  });
});
