import {test} from 'node:test';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {proposedBoundReplySuccess} from './helpers/t36-bound-reply-scenes.mjs';
// Real ingress/Session -> Cookie HTTP -> original Message/Outbox/Delivery -> manual Worker.
test('T36 captured Bot supplement is cleared only by an exact bound reply with reliable original Delivery completion',{timeout:240000},()=>withT36BoundReplyFixture(proposedBoundReplySuccess));
