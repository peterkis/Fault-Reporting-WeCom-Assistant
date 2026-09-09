import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { g2Hash,readG2Configuration } from '../src/p2-g2-validation-config.mjs';

test('approved webhook route binds private URL and group without exposing the key in manifest',()=>{
  const f=configurationFixture(),url='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic-unused';
  f.manifest.scope.group_webhook_routes=[{group_hash:g2Hash('synthetic-g2-group'),endpoint_hash:g2Hash(url)}];
  f.manifest.scope.ticket_notification_additional_events=['ticket.resolved'];
  f.env.P2_G2_GROUP_WEBHOOK_ROUTES=JSON.stringify([{group_id:'synthetic-g2-group',url}]);
  const c=readG2Configuration(f);assert.equal(c.groupClosureWebhookRoutes[0].url,url);
  assert.deepEqual(c.ticketNotificationAdditionalEvents,['ticket.resolved']);
  assert.doesNotMatch(JSON.stringify(c.manifest),/synthetic-unused/u);
  f.env.P2_G2_GROUP_WEBHOOK_ROUTES=JSON.stringify([{group_id:'different-group',url}]);
  assert.throws(()=>readG2Configuration(f),{code:'P2_G2_WEBHOOK_ROUTE_MISMATCH'});
});

test('unapproved optional event and duplicate webhook destinations fail closed',()=>{
  const f=configurationFixture();f.manifest.scope.ticket_notification_additional_events=['ticket.fake'];
  assert.throws(()=>readG2Configuration(f));
  delete f.manifest.scope.ticket_notification_additional_events;
  const route={group_hash:f.manifest.scope.group_hashes[0],endpoint_hash:'a'.repeat(64)};
  f.manifest.scope.group_webhook_routes=[route,route];assert.throws(()=>readG2Configuration(f));
});
