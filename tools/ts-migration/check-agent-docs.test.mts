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

test('nested and escaped link labels still validate their destinations', () => fixture((root, write) => {
  write('AGENTS.md', '[ADR [Accepted]](missing.md)\n[literal \\]](gone.md)\n[valid [guide]](docs/agents/rules.md#rules)\n');
  write('docs/agents/rules.md', '# Rules\n');
  assert.deepEqual(checkAgentDocs(root), [
    {file: 'AGENTS.md', code: 'LOCAL_LINK_MISSING', target: 'missing.md'},
    {file: 'AGENTS.md', code: 'LOCAL_LINK_MISSING', target: 'gone.md'},
  ]);
}));

test('Markdown punctuation escapes are decoded before checking local paths', () => fixture((root, write) => {
  write('AGENTS.md', '[escaped](docs/agents/a\\!.md#part)\n[encoded](docs/agents/a%21.md#part)\n[missing](docs/agents/gone\\!.md)\n');
  write('docs/agents/a!.md', '# Part\n');
  assert.deepEqual(checkAgentDocs(root), [{file: 'AGENTS.md', code: 'LOCAL_LINK_MISSING', target: 'docs/agents/gone!.md'}]);
}));

test('rendered references, images and HTML links decode entities and ignore unused definitions', () => fixture((root, write) => {
  write('AGENTS.md', '[rule][guide]\n![asset](docs/agents/icon.svg)\n<a href="docs/agents/a&amp;b.md#part">HTML</a>\n\n[guide]: docs/agents/a&amp;b.md#part\n[unused]: absent.md\n');
  write('docs/agents/a&b.md', '# Part\n');
  write('docs/agents/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  assert.deepEqual(checkAgentDocs(root), []);
  write('AGENTS.md', '[missing][guide]\n![missing](gone.svg)\n<a href="gone.html">HTML</a>\n\n[guide]: gone.md\n');
  assert.deepEqual(checkAgentDocs(root).map(issue => issue.target), ['gone.md', 'gone.svg', 'gone.html']);
}));

test('heading slugs use rendered text, decoded entities and duplicate numbering', () => fixture((root, write) => {
  write('AGENTS.md', '[first](docs/agents/rules.md#rules-v2--links)\n[duplicate](docs/agents/rules.md#rules-v2--links-1)\n[absent](docs/agents/rules.md#rules-v2--links-2)\n');
  write('docs/agents/rules.md', '# **Rules** `v2` &amp; links\n\n# **Rules** `v2` &amp; links\n');
  assert.deepEqual(checkAgentDocs(root), [{file: 'AGENTS.md', code: 'LOCAL_ANCHOR_MISSING', target: 'docs/agents/rules.md#rules-v2--links-2'}]);
}));

test('indented code cannot create links or explicit anchors', () => fixture((root, write) => {
  write('AGENTS.md', '[example](docs/agents/rules.md#example)\n');
  write('docs/agents/rules.md', '    <a id="example"></a>\n\n    [sample](missing.md)\n');
  assert.deepEqual(checkAgentDocs(root), [{file: 'AGENTS.md', code: 'LOCAL_ANCHOR_MISSING', target: 'docs/agents/rules.md#example'}]);
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

test('an in-repository linked documentation directory is scanned', () => fixture((root, write) => {
  write('AGENTS.md', '[rules](docs/agents/linked/rules.md#rules)\n');
  write('docs/agents/README.md', '# Navigation\n');
  write('docs/shared/rules.md', '# Rules\n[missing](missing.md)\n');
  symlinkSync(path.join(root, 'docs/shared'), path.join(root, 'docs/agents/linked'), 'junction');
  assert.deepEqual(checkAgentDocs(root), [{file: 'docs/agents/linked/rules.md', code: 'LOCAL_LINK_MISSING', target: 'missing.md'}]);
}));

test('an external linked documentation directory is rejected without an incoming link', () => fixture((root, write, owned) => {
  const outside = path.join(owned, 'outside'); mkdirSync(outside); writeFileSync(path.join(outside, 'rules.md'), '# Rules\n');
  write('docs/retrospectives/README.md', '# Retrospectives\n');
  symlinkSync(outside, path.join(root, 'docs/retrospectives/external'), 'junction');
  assert.deepEqual(checkAgentDocs(root), [{file: 'docs/retrospectives/external', code: 'DOC_OUTSIDE_REPOSITORY'}]);
}));

test('directory aliases validate links relative to each logical parent', () => fixture((root, write) => {
  write('AGENTS.md', '[first](docs/agents/a/guide.md)\n[second](docs/retrospectives/b/guide.md)\n');
  write('docs/agents/present.md', '# Present\n');
  write('docs/retrospectives/README.md', '# Retrospectives\n');
  write('docs/shared/guide.md', '[up](../present.md)\n');
  symlinkSync(path.join(root, 'docs/shared'), path.join(root, 'docs/agents/a'), 'junction');
  symlinkSync(path.join(root, 'docs/shared'), path.join(root, 'docs/retrospectives/b'), 'junction');
  assert.deepEqual(checkAgentDocs(root), [{file: 'docs/retrospectives/b/guide.md', code: 'LOCAL_LINK_MISSING', target: '../present.md'}]);
}));

test('cyclic directory links terminate while distinct aliases are scanned', () => fixture((root, write) => {
  write('docs/agents/rules.md', '[missing](missing.md)\n');
  symlinkSync(path.join(root, 'docs/agents'), path.join(root, 'docs/agents/cycle'), 'junction');
  write('docs/retrospectives/README.md', '# Retrospectives\n');
  symlinkSync(path.join(root, 'docs/agents'), path.join(root, 'docs/retrospectives/duplicate'), 'junction');
  assert.deepEqual(checkAgentDocs(root), [
    {file: 'docs/agents/rules.md', code: 'LOCAL_LINK_MISSING', target: 'missing.md'},
    {file: 'docs/retrospectives/duplicate/rules.md', code: 'LOCAL_LINK_MISSING', target: 'missing.md'},
  ]);
}));

test('unrelated Markdown and source-index JSON contents are outside the link scan', () => fixture((root, write) => {
  write('docs/other.md', '[unrelated](missing.md)\n');
  write('docs/retrospectives/source-index.json', '{"source":"D:/external/session.jsonl"}\n');
  assert.deepEqual(checkAgentDocs(root), []);
}));
