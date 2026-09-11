import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';

const parse = file => JSON.parse(execFileSync('python', ['-c',
  'import sys,json,yaml; print(json.dumps(yaml.safe_load(sys.stdin.buffer.read().decode("utf-8"))))'],
{ input: readFileSync(file, 'utf8'), encoding: 'utf8' }));
function requestPath(document, route, method) {
  const item = document.paths[route], server = item[method]?.servers?.[0] ?? item.servers?.[0] ?? document.servers[0];
  const prefix = new URL(server.url, 'https://synthetic.invalid').pathname.replace(/\/$/u, '');
  return prefix + route;
}
test('P2-G2 parsed OpenAPI server and Incident paths resolve to the actual authenticated HTTP route', async () => {
  await withG2Runtime(async f => {
    for (const file of ['contracts/openapi.yaml', 'contracts/conversation_center.openapi.yaml']) {
      const document = parse(file);
      for (const [route, item] of Object.entries(document.paths).filter(([route]) => /^\/api\/(?:incidents|incident-candidates)(?:\/|$)/u.test(route)))
        for (const method of ['get', 'post'].filter(method => item[method])) assert.equal(requestPath(document, route, method), route, file + ':' + route);
      // Only the path is exercised against the owned fixture; documentation hosts
      // are never contacted and the cookie cannot leave this local origin.
      const response = await f.get(requestPath(document, '/api/incidents', 'get'));
      assert.ok(Array.isArray(response.items));
    }
  });
});
