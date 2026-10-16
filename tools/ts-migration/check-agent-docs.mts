import {existsSync, readFileSync, readdirSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export type AgentDocIssue = {file: string; code: string; target?: string};
const AGENTS_BYTE_BUDGET = 8 * 1024; // This repository's context budget, not an OpenAI product limit.
const relative = (root: string, file: string): string => path.relative(root, file).split(path.sep).join('/');
const inside = (root: string, file: string): boolean => {
  const part = path.relative(root, file);
  return part === '' || part !== '..' && !part.startsWith('..' + path.sep) && !path.isAbsolute(part);
};

function withoutFences(text: string): string {
  let fence = '', length = 0;
  return text.split(/\r?\n/u).map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      if (marker && marker[0] === fence && marker.length >= length && line.slice(line.indexOf(marker) + marker.length).trim() === '') fence = '';
      return '';
    }
    if (marker) { fence = marker[0] ?? ''; length = marker.length; return ''; }
    return line;
  }).join('\n');
}

function withoutComments(text: string): string {
  return text.replace(/(`+)[\s\S]*?\1(?!`)|<!--[\s\S]*?(?:-->|$)/gu,
    match => match.startsWith('<!--') ? match.replace(/[^\r\n]/gu, '') : match);
}

function anchors(text: string): Set<string> {
  const source = withoutComments(withoutFences(text)), ids = new Set<string>(), used = new Set<string>();
  const prose = source.replace(/(`+)[\s\S]*?\1(?!`)/gu, '');
  for (const tag of prose.matchAll(/<[a-z][a-z0-9:-]*(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/giu)) {
    const attributes = tag[0].replace(/^<[a-z][a-z0-9:-]*/iu, '');
    for (const attr of attributes.matchAll(/\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu)) {
      const id = attr[2] ?? attr[3] ?? attr[4];
      if (attr[1]?.toLowerCase() === 'id' && id) ids.add(id);
    }
  }
  for (const match of prose.matchAll(/\{#([^\s{}]+)\}/gu)) {
    if (match[1]) ids.add(match[1]);
  }
  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    const atx = line.match(/^ {0,3}#{1,6}(?:[\t ]+|$)(.*?)(?:[\t ]+#+[\t ]*)?$/u)?.[1];
    const setext = /^ {0,3}(?:=+|-+)[\t ]*$/u.test(lines[index + 1] ?? '') && line.trim() ? line : undefined;
    const heading = atx ?? setext;
    if (heading === undefined) continue;
    const base = heading.replace(/\{#[^\s{}]+\}/gu, '').replace(/<[^>]*>/gu, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').toLowerCase().trim()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\t ]/gu, '').replace(/[\t ]/gu, '-');
    let slug = base, suffix = 0;
    while (used.has(slug)) slug = base + '-' + String(++suffix);
    used.add(slug); ids.add(slug);
  }
  return ids;
}

function linkTargets(text: string): string[] {
  const prose = withoutComments(withoutFences(text)).replace(/(`+)[\s\S]*?\1(?!`)/gu, '');
  const targets: string[] = [];
  const destination = (start: number): {value: string; end: number} | undefined => {
    let end = start, depth = 0;
    if (prose[start] === '<') {
      end++;
      while (end < prose.length) {
        if (prose[end] === '\\' && end + 1 < prose.length) { end += 2; continue; }
        if (prose[end] === '>') return {value: prose.slice(start + 1, end), end: end + 1};
        if (prose[end] === '\n' || prose[end] === '\r') return undefined;
        end++;
      }
      return undefined;
    }
    while (end < prose.length) {
      const char = prose[end] ?? '';
      if (char === '\\' && end + 1 < prose.length) { end += 2; continue; }
      if (/\s/u.test(char)) break;
      if (char === '(') depth++;
      if (char === ')') { if (depth === 0) break; depth--; }
      end++;
    }
    return depth === 0 ? {value: prose.slice(start, end), end} : undefined;
  };
  const inline = /!?\[[^\]\n]*\]\(\s*/gu;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(prose)) !== null) {
    const target = destination(inline.lastIndex);
    if (!target) continue;
    const close = prose.slice(target.end).match(/^(?:\s+(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\((?:\\.|[^)\\\n])*\)))?\s*\)/u);
    if (!close) continue;
    targets.push(target.value);
    inline.lastIndex = target.end + close[0].length;
  }
  for (const reference of prose.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*/gmu)) {
    const start = reference.index + reference[0].length, target = destination(start);
    if (target && target.end > start) targets.push(target.value);
  }
  return targets;
}

/** Check the bounded agent-document navigation surface without network or runtime access. */
export function checkAgentDocs(root: string): AgentDocIssue[] {
  const base = realpathSync(root), files = [path.join(base, 'AGENTS.md')], issues: AgentDocIssue[] = [];
  const add = (file: string, code: string, target?: string): void => {
    issues.push(target === undefined ? {file: relative(base, file), code} : {file: relative(base, file), code, target});
  };
  const collect = (directory: string): void => {
    if (!existsSync(directory)) return;
    try {
      if (!inside(base, realpathSync(directory))) { add(directory, 'DOC_OUTSIDE_REPOSITORY'); return; }
      for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) collect(file);
        else if ((entry.isFile() || entry.isSymbolicLink()) && /\.md$/iu.test(entry.name)) files.push(file);
      }
    } catch { add(directory, 'DOC_UNREADABLE'); }
  };
  for (const folder of ['docs/agents', 'docs/retrospectives']) collect(path.join(base, folder));
  const cache = new Map<string, Set<string>>();
  for (const file of files) {
    let text: string;
    try {
      if (!inside(base, realpathSync(file))) { add(file, 'DOC_OUTSIDE_REPOSITORY'); continue; }
      const bytes = readFileSync(file);
      if (file === files[0] && bytes.byteLength > AGENTS_BYTE_BUDGET) add(file, 'AGENTS_BYTE_BUDGET_EXCEEDED');
      text = bytes.toString('utf8');
    } catch { add(file, 'DOC_UNREADABLE'); continue; }
    for (const raw of linkTargets(text)) {
      if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/iu.test(raw) && !/^[a-z]:[\\/]/iu.test(raw) && !/^file:/iu.test(raw)) continue;
      let resource: string, fragment: string;
      try {
        const split = raw.indexOf('#');
        resource = decodeURIComponent((split < 0 ? raw : raw.slice(0, split)).split('?')[0] ?? '').replace(/\\([\\()[\] ])/gu, '$1');
        fragment = split < 0 ? '' : decodeURIComponent(raw.slice(split + 1));
      } catch { add(file, 'LOCAL_LINK_INVALID', raw); continue; }
      if (/^file:/iu.test(resource) || path.win32.isAbsolute(resource) && !path.isAbsolute(resource)) { add(file, 'LOCAL_LINK_OUTSIDE_REPOSITORY', raw); continue; }
      const target = resource ? path.resolve(path.dirname(file), resource) : file;
      if (!inside(base, target)) { add(file, 'LOCAL_LINK_OUTSIDE_REPOSITORY', raw); continue; }
      if (!existsSync(target)) { add(file, 'LOCAL_LINK_MISSING', raw); continue; }
      try {
        if (!inside(base, realpathSync(target))) { add(file, 'LOCAL_LINK_OUTSIDE_REPOSITORY', raw); continue; }
        if (fragment && /\.md$/iu.test(target)) {
          const ids = cache.get(target) ?? anchors(readFileSync(target, 'utf8'));
          cache.set(target, ids);
          if (!ids.has(fragment)) add(file, 'LOCAL_ANCHOR_MISSING', raw);
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
