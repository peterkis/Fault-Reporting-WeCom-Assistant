import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { cleanGenerated, controlledBuildRoot, hash, identity, mappings, safeFile, sourceRoot, runNode, type BuildManifest, type FileDigest, type OutputFile } from './common.mjs';
import {buildWeb} from './web.mjs';

interface BuildSyntaxEvidence {actual_node_checks:number;reused_checks:number;covered_files:number;node_sha256:string}
interface SyntaxProof {root:string;source_identity:string;node_identity:string;compiled_identity:string;evidence:Readonly<BuildSyntaxEvidence>}
const syntaxProofs=new WeakMap<BuildManifest,SyntaxProof>();
const nodeParser=()=>({executable:process.execPath,sha256:hash(readFileSync(process.execPath)),version:process.versions.node,options:process.env.NODE_OPTIONS??'',argv:['--check']});
function compiledIdentity(runtime:string,map:readonly Pick<OutputFile,'path'|'kind'>[]):string{
  return JSON.stringify(map.filter(item=>item.kind==='COMPILED'&&item.path.endsWith('.mjs'))
    .map(item=>({path:item.path,sha256:hash(readFileSync(safeFile(runtime,item.path)))} satisfies FileDigest)));
}
export function buildSyntaxEvidence(manifest:BuildManifest):Readonly<BuildSyntaxEvidence>{
  const proof=syntaxProofs.get(manifest);if(!proof)throw Error('MIGRATION_SYNTAX_PROOF_NOT_OWNED');
  return Object.freeze({...proof.evidence});
}

export function build(root: string,options:{syntaxReference?:BuildManifest}={}): BuildManifest {
  sourceRoot(root);
  // Invalidate first: a failed configuration, resource or compile must not leave a usable old artifact.
  for (const name of ['artifact-proof.json', 'runtime', 'emit'] as const) cleanGenerated(root, name);
  const reference=options.syntaxReference===undefined?undefined:syntaxProofs.get(options.syntaxReference);
  if(options.syntaxReference!==undefined&&!reference)throw Error('MIGRATION_SYNTAX_PROOF_NOT_OWNED');
  const before = identity(root);
  // Preserve source collisions and resource guards before compiling or invoking Vite.
  mappings(root);
  // Wait for the full strict emit child to exit before Go/Vite starts. Its AST
  // need not remain in the parent while the frontend allocates its build graph.
  runNode(root,[fileURLToPath(new URL('./emit.mjs',import.meta.url)),'--root',root]);
  const output = path.join(controlledBuildRoot(root), 'runtime');
  try {
    buildWeb(root);
    const map=mappings(root);
    for (const item of map) {
      const from = path.join(root, item.kind === 'COMPILED'||item.kind==='WEB' ? '.build/emit/' + item.path : item.source);
      const to = path.join(output, item.path);
      mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to);
    }
    const node=nodeParser(),nodeIdentity=JSON.stringify(node),compiled=compiledIdentity(output,map);
    const count=map.filter(item=>item.kind==='COMPILED'&&item.path.endsWith('.mjs')).length;
    const reused=reference?.root===path.resolve(root)&&reference.source_identity===JSON.stringify(before)
      &&reference.node_identity===nodeIdentity&&reference.compiled_identity===compiled;
    const syntax:BuildSyntaxEvidence={actual_node_checks:reused?0:count,reused_checks:reused?count:0,covered_files:count,node_sha256:node.sha256};
    if(reused)console.log(JSON.stringify({status:'MIGRATION_IDENTICAL_COMPILED_SYNTAX_PROOF_REUSED',...syntax}));
    else runNode(root,[fileURLToPath(new URL('./syntax-check.mjs',import.meta.url)),'--root',root]);
    if(compiledIdentity(output,map)!==compiled||JSON.stringify(nodeParser())!==nodeIdentity)throw Error('MIGRATION_SYNTAX_CHECK_INPUT_DRIFT');
    const after = identity(root);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('MIGRATION_SOURCE_CHANGED_DURING_BUILD');
    const manifest: BuildManifest = {
      schema_version: 1, status: 'STAGED_NOT_ACTIVATED', node_major: 24, compiler: ts.version, source: before,
      typed_implementations: map.filter(f => f.kind === 'COMPILED' && !f.path.endsWith('.map')).map(f => f.source),
      unchecked_legacy: map.filter(f => f.kind === 'LEGACY').map(f => f.source),
      declaration_inputs: before.inputs.filter(f => /\.d\.(?:ts|mts)$/u.test(f.path)).map(f => f.path),
      outputs: map.map(item => ({ ...item, sha256: hash(readFileSync(path.join(output, item.path))) })),
    };
    const text = JSON.stringify(manifest, null, 2) + '\n';
    const sealedCompiled=JSON.stringify(manifest.outputs.filter(item=>item.kind==='COMPILED'&&item.path.endsWith('.mjs')).map(item=>({path:item.path,sha256:item.sha256})));
    if(sealedCompiled!==compiled)throw Error('MIGRATION_SYNTAX_CHECK_OUTPUT_DRIFT');
    writeFileSync(path.join(output, 'build-manifest.json'), text);
    writeFileSync(path.join(root, '.build/artifact-proof.json'), JSON.stringify({ manifest_sha256: hash(text), source_input_hash: before.input_hash }) + '\n');
    syntaxProofs.set(manifest,{root:path.resolve(root),source_identity:JSON.stringify(before),node_identity:nodeIdentity,compiled_identity:compiled,evidence:Object.freeze(syntax)});
    return manifest;
  } catch (error) {
    cleanGenerated(root, 'runtime'); cleanGenerated(root, 'artifact-proof.json'); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = build(sourceRoot());
  console.log(JSON.stringify({ status: result.status, source: result.source.head, input_hash: result.source.input_hash, typed: result.typed_implementations.length, unchecked_legacy: result.unchecked_legacy.length, outputs: result.outputs.length }));
}
