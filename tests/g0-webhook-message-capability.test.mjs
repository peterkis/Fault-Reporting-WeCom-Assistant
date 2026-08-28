import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialMessagePayloads,
  buildMediaMessagePayload,
  buildMultipartMediaBody,
  buildUploadUrl,
  createAmrNbFixture,
  createFileFixture,
  createImageFixture,
  parseWebhookUrl,
  redactWebhookEndpoint,
  runWebhookCapabilityProbe,
} from '../src/g0-webhook-message-capability.mjs';

const webhookUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-secret-key';

test('validates and redacts a Webhook URL without exposing its key', () => {
  assert.equal(parseWebhookUrl(webhookUrl).searchParams.get('key'), 'test-secret-key');
  assert.equal(redactWebhookEndpoint(webhookUrl), 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send');
  assert.throws(() => parseWebhookUrl('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x'), /G0_WEBHOOK_URL_INVALID/);
  assert.throws(() => parseWebhookUrl('https://example.test/hook?key=x'), /G0_WEBHOOK_URL_INVALID/);
});

test('builds the documented text, markdown, media, news, and card payload forms', () => {
  const payloads = buildInitialMessagePayloads('test-userid');
  assert.deepEqual(payloads.map(({ capability }) => capability), [
    'text_mentioned_list',
    'markdown_mention_tag',
    'markdown_v2',
    'image',
    'news',
    'template_card_text_notice',
    'template_card_news_notice',
  ]);
  assert.deepEqual(payloads[0].payload.text.mentioned_list, ['test-userid']);
  assert.match(payloads[1].payload.markdown.content, /<@test-userid>/);
  assert.equal(payloads[2].payload.msgtype, 'markdown_v2');
  assert.match(payloads[3].payload.image.md5, /^[a-f0-9]{32}$/);
  assert.equal(payloads[4].payload.news.articles.length, 1);
  assert.equal(payloads[5].payload.template_card.card_type, 'text_notice');
  assert.equal(payloads[6].payload.template_card.card_type, 'news_notice');
  assert.deepEqual(buildMediaMessagePayload({ type: 'file', mediaId: 'media-file' }), { msgtype: 'file', file: { media_id: 'media-file' } });
  assert.throws(() => buildMediaMessagePayload({ type: 'image', mediaId: 'media-image' }), /G0_WEBHOOK_MEDIA_PAYLOAD_INVALID/);
});

test('creates bounded in-memory image, file, and AMR fixtures and documented multipart headers', () => {
  const image = createImageFixture();
  const file = createFileFixture();
  const voice = createAmrNbFixture();
  assert.ok(image.bytes.length > 0);
  assert.ok(file.bytes.length > 5);
  assert.equal(voice.bytes.subarray(0, 6).toString('ascii'), '#!AMR\n');
  assert.equal(voice.frameCount, 50);
  assert.equal(voice.durationMs, 1000);

  const multipart = buildMultipartMediaBody({ fixture: file, boundary: 'boundary-test' });
  const multipartText = multipart.body.toString('utf8');
  assert.match(multipartText, /name="media"; filename="g0-webhook-file-test\.txt"; filelength=/);
  assert.match(multipartText, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(buildUploadUrl(webhookUrl, 'voice').toString(), /upload_media\?key=test-secret-key&type=voice/);
});

test('records only safe live-probe evidence when every provider reply is accepted', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/upload_media')) {
      return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', media_id: 'sensitive-media-id' }), { status: 200 });
    }
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
  };

  const report = await runWebhookCapabilityProbe({ fetchImpl, webhookUrl, mentionedUserId: 'sensitive-userid' });
  assert.equal(calls.length, 11);
  assert.equal(report.rate_limit_guard.sent_message_count, 9);
  assert.equal(report.rate_limit_guard.within_documented_limit, true);
  assert.equal(report.results.filter((result) => result.status === 'accepted').length, 11);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('test-secret-key'), false);
  assert.equal(serialized.includes('sensitive-userid'), false);
  assert.equal(serialized.includes('sensitive-media-id'), false);
});
