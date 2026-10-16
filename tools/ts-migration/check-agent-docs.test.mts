import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {checkAgentDocs} from './check-agent-docs.mjs';

function fixture(run: (root: string, write: (file: string, text: string) => void, owned: string) => void): void {
  const parent = realpathSync(tmpdir()), owned = mkdtempSync(path.join(parent, 'agent-docs-')), root = path.join(owned, 'checkout');
  mkdirSync(root);
  const write = (file: string, text: string): void => {
    const target = path.join(root, file); mkdirSync(path.dirname(target), {recursive: true}); writeFileSync(target, text);
  };
  write('AGENTS.md', '# Agent navigation\n');
  try { run(root, write, owned); } finally {
    assert.equal(path.dirname(realpathSync(owned)), parent);
    assert.ok(path.basename(owned).startsWith('agent-docs-'));
    rmSync(owned, {recursive: true});
  }
}

test('agent navigation resolves Chinese, duplicate, explicit and setext anchors with encoded local paths', () => fixture((root, write) => {
  write('AGENTS.md', '[规则](docs/agents/规则%20说明.md#中文规则-1)\n[显式](docs/agents/规则%20说明.md#contract)\n[参考][guide]\n[guide]: docs/agents/规则%20说明.md#另一节\n');
  write('docs/agents/规则 说明.md', '# 中文规则\n# 中文规则\n<a id="contract"></a>\n另一节\n---\n');
  assert.deepEqual(checkAgentDocs(root), []);
}));

test('a missing local document is reported at its referring file', () => fixture((root, write) => {
  write('docs/retrospectives/one/README.md', '[missing](missing.md)\n');
  assert.deepEqual(checkAgentDocs(root), [{file: 'docs/retrospectives/one/README.md', code: 'LOCAL_LINK_MISSING', target: 'missing.md'}]);
}));

test('an existing document with a stale fragment fails while its valid link remains accepted', () => fixture((root, write) => {
  write('AGENTS.md', '[good](docs/agents/rules.md#rules)\n[stale](docs/agents/rules.md#removed)\n');
  write('docs/agents/rules.md', '# Rules\n');
  assert.deepEqual(checkAgentDocs(root).map(issue => issue.code), ['LOCAL_ANCHOR_MISSING']);
}));

test('only actual HTML id attributes create explicit anchors', () => fixture((root, write) => {
  write('AGENTS.md', '[data](docs/agents/rules.md#data-only)\n[quoted](docs/agents/rules.md#quoted-only)\n[real](docs/agents/rules.md#real)\n[bare](docs/agents/rules.md#bare)\n');
  write('docs/agents/rules.md', '<a data-id="data-only"></a>\n<a title=" id=\'quoted-only\'"></a>\n<A data-id="ignored" ID="real"></A>\n<a id=bare></a>\n');
  assert.deepEqual(checkAgentDocs(root).map(issue => issue.target), ['docs/agents/rules.md#data-only', 'docs/agents/rules.md#quoted-only']);
}));

test('HTML comments hide links, explicit anchors and headings while inline code remains literal', () => fixture((root, write) => {
  write('AGENTS.md', '`<!--`\n[visible](docs/agents/rules.md#visible)\n[hidden](docs/agents/rules.md#hidden)\n[heading](docs/agents/rules.md#hidden-heading)\n[unclosed](docs/agents/rules.md#unclosed)\n<!-- [retired](gone.md#write) -->\n');
  write('docs/agents/rules.md', '<!--\n<a id="hidden"></a>\n# Hidden heading\n-->\n<a id="visible"></a>\n<!-- <a id="unclosed"></a>\n');
  assert.deepEqual(checkAgentDocs(root).map(issue => [issue.code, issue.target]), [
    ['LOCAL_ANCHOR_MISSING', 'docs/agents/rules.md#hidden'],
    ['LOCAL_ANCHOR_MISSING', 'docs/agents/rules.md#hidden-heading'],
    ['LOCAL_ANCHOR_MISSING', 'docs/agents/rules.md#unclosed'],
  ]);
}));

test('balanced, escaped and angle-wrapped destinations retain complete paths and fragments', () => fixture((root, write) => {
  write('AGENTS.md', '[nested](docs/agents/a(b(c)).md#part "title")\n[escaped](docs/agents/a\\(b\\).md#part)\n[angle](<docs/agents/a b(c).md#part> \'title\')\n[reference][guide]\n[guide]: docs/agents/a(b(c)).md#part\n[missing](docs/agents/missing(a).md)\n');
  for (const name of ['a(b(c)).md', 'a(b).md', 'a b(c).md']) write('docs/agents/' + name, '# Part\n');
  assert.deepEqual(checkAgentDocs(root), [{file: 'AGENTS.md', code: 'LOCAL_LINK_MISSING', target: 'docs/agents/missing(a).md'}]);
}));

test('the root budget counts UTF-8 bytes rather than visible characters', () => fixture((root, write) => {
  write('AGENTS.md', '规'.repeat(2731));
  assert.deepEqual(checkAgentDocs(root).map(issue => issue.code), ['AGENTS_BYTE_BUDGET_EXCEEDED']);
  write('AGENTS.md', 'x'.repeat(8192));
  assert.deepEqual(checkAgentDocs(root), []);
}));

test('external links and fenced or inline link examples do not require local targets', () => fixture((root, write) => {
  write('AGENTS.md', '[web](https://example.invalid/absent.md#nope)\n[mail](mailto:someone@example.invalid)\n`[inline](absent.md)`\n```md\n[example](absent.md)\n```\n~~~\n[other](absent.md)\n~~~\n');
  assert.deepEqual(checkAgentDocs(root), []);
}));

test('local links cannot leave the repository through traversal, encoding or a directory junction', () => fixture((root, write, owned) => {
  const outside = path.join(owned, 'outside'); mkdirSync(outside); writeFileSync(path.join(outside, 'secret.md'), '# Secret\n');
  symlinkSync(outside, path.join(root, 'linked'), 'junction');
  write('AGENTS.md', '[traversal](../outside/secret.md)\n[encoded](%2e%2e/outside/secret.md)\n[junction](linked/secret.md)\n');
  assert.deepEqual(checkAgentDocs(root).map(issue => issue.code), Array<string>(3).fill('LOCAL_LINK_OUTSIDE_REPOSITORY'));
}));

test('unrelated Markdown and source-index JSON contents are outside the link scan', () => fixture((root, write) => {
  write('docs/other.md', '[unrelated](missing.md)\n');
  write('docs/retrospectives/source-index.json', '{"source":"D:/external/session.jsonl"}\n');
  assert.deepEqual(checkAgentDocs(root), []);
}));
