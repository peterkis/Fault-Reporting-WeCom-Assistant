import {existsSync, readFileSync, readdirSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import GithubSlugger from 'github-slugger';
import {Marked} from 'marked';
import {parseFragment, type DefaultTreeAdapterTypes} from 'parse5';

export type AgentDocIssue = {file: string; code: string; target?: string};
const AGENTS_BYTE_BUDGET = 8 * 1024; // This repository's context budget, not an OpenAI product limit.
const relative = (root: string, file: string): string => path.relative(root, file).split(path.sep).join('/');
const inside = (root: string, file: string): boolean => {
  const part = path.relative(root, file);
  return part === '' || part !== '..' && !part.startsWith('..' + path.sep) && !path.isAbsolute(part);
};

type DocumentFacts = {anchors: Set<string>; links: string[]};
const markdown = new Marked({gfm: true, async: false});

function documentFacts(text: string): DocumentFacts {
  // Both parsers only create data; the HTML is never displayed or executed.
  const tree = parseFragment(markdown.parse(text, {async: false}));
  const facts: DocumentFacts = {anchors: new Set<string>(), links: []}, slugger = new GithubSlugger();
  const plainText = (node: DefaultTreeAdapterTypes.Node): string => {
    if (node.nodeName === '#text' && 'value' in node) return node.value;
    if ('tagName' in node && node.tagName === 'img') return node.attrs.find(attr => attr.name === 'alt')?.value ?? '';
    return 'childNodes' in node ? node.childNodes.map(plainText).join('') : '';
  };
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node) {
      const id = node.attrs.find(attr => attr.name === 'id')?.value;
      if (id) facts.anchors.add(id);
      if (/^h[1-6]$/u.test(node.tagName)) facts.anchors.add(slugger.slug(plainText(node)));
      const attribute = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : undefined;
      const target = attribute && node.attrs.find(attr => attr.name === attribute)?.value;
      if (target) facts.links.push(target);
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(tree);
  return facts;
}

/** Check the bounded agent-document navigation surface without network or runtime access. */
export function checkAgentDocs(root: string): AgentDocIssue[] {
  const base = realpathSync(root), files = [path.join(base, 'AGENTS.md')], issues: AgentDocIssue[] = [];
  const add = (file: string, code: string, target?: string): void => {
    issues.push(target === undefined ? {file: relative(base, file), code} : {file: relative(base, file), code, target});
  };
  const collect = (directory: string, ancestors: ReadonlySet<string> = new Set<string>()): void => {
    if (!existsSync(directory)) return;
    try {
      const resolved = realpathSync(directory);
      if (!inside(base, resolved)) { add(directory, 'DOC_OUTSIDE_REPOSITORY'); return; }
      const identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      if (ancestors.has(identity)) return;
      const next = new Set(ancestors); next.add(identity);
      for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory() || entry.isSymbolicLink() && statSync(file).isDirectory()) collect(file, next);
        else if ((entry.isFile() || entry.isSymbolicLink()) && /\.md$/iu.test(entry.name)) files.push(file);
      }
    } catch { add(directory, 'DOC_UNREADABLE'); }
  };
  for (const folder of ['docs/agents', 'docs/retrospectives']) collect(path.join(base, folder));
  const cache = new Map<string, DocumentFacts>();
  for (const file of files) {
    let text: string;
    try {
      if (!inside(base, realpathSync(file))) { add(file, 'DOC_OUTSIDE_REPOSITORY'); continue; }
      const bytes = readFileSync(file);
      if (file === files[0] && bytes.byteLength > AGENTS_BYTE_BUDGET) add(file, 'AGENTS_BYTE_BUDGET_EXCEEDED');
      text = bytes.toString('utf8');
    } catch { add(file, 'DOC_UNREADABLE'); continue; }
    const facts = cache.get(file) ?? documentFacts(text);
    cache.set(file, facts);
    for (const raw of facts.links) {
      if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/iu.test(raw) && !/^[a-z]:[\\/]/iu.test(raw) && !/^file:/iu.test(raw)) continue;
      let resource: string, fragment: string;
      try {
        const split = raw.indexOf('#');
        resource = decodeURIComponent((split < 0 ? raw : raw.slice(0, split)).split('?')[0] ?? '');
        fragment = split < 0 ? '' : decodeURIComponent(raw.slice(split + 1));
      } catch { add(file, 'LOCAL_LINK_INVALID', raw); continue; }
      if (/^file:/iu.test(resource) || path.win32.isAbsolute(resource) && !path.isAbsolute(resource)) { add(file, 'LOCAL_LINK_OUTSIDE_REPOSITORY', raw); continue; }
      const target = resource ? path.resolve(path.dirname(file), resource) : file;
      if (!inside(base, target)) { add(file, 'LOCAL_LINK_OUTSIDE_REPOSITORY', raw); continue; }
      if (!existsSync(target)) { add(file, 'LOCAL_LINK_MISSING', raw); continue; }
      try {
        if (!inside(base, realpathSync(target))) { add(file, 'LOCAL_LINK_OUTSIDE_REPOSITORY', raw); continue; }
        if (fragment && /\.md$/iu.test(target)) {
          const targetFacts = cache.get(target) ?? documentFacts(readFileSync(target, 'utf8'));
          cache.set(target, targetFacts);
          if (!targetFacts.anchors.has(fragment)) add(file, 'LOCAL_ANCHOR_MISSING', raw);
        }
      } catch { add(file, 'LOCAL_TARGET_UNREADABLE', raw); }
    }
  }
  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = checkAgentDocs(process.cwd());
  for (const issue of issues) console.error(issue.file + ': ' + issue.code + (issue.target ? ' (' + issue.target + ')' : ''));
  if (issues.length) process.exitCode = 1;
  else console.log('Agent documentation budget and local links passed.');
}
