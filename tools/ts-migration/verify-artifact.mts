import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { controlledBuildRoot, hash, identity, mappings, outputFiles, record, safeFile, sourceRoot } from './common.mjs';

function runtimeOutputs(runtime:string,outputs:Record<string,unknown>[]):Map<string,Buffer>{
  const bytes=new Map<string,Buffer>();
  for(const output of outputs){
    if(typeof output.path!=='string'||typeof output.sha256!=='string'||bytes.has(output.path))throw Error('MIGRATION_OUTPUT_SCHEMA');
    const value=readFileSync(safeFile(runtime,output.path));
    if(hash(value)!==output.sha256)throw Error('MIGRATION_OUTPUT_TAMPERED: '+output.path);
    bytes.set(output.path,value);
  }
  if(JSON.stringify(outputFiles(runtime))!==JSON.stringify([...bytes.keys(),'build-manifest.json'].sort()))throw Error('MIGRATION_UNDECLARED_OUTPUT');
  return bytes;
}

/** Physical runtime identity; ADR-0051 keeps source admission separately bounded at 4096 files. */
export function runtimeOutputInventory(runtime:string,archivedManifest?:Buffer){
  const text=readFileSync(safeFile(runtime,'build-manifest.json'),'utf8'),manifest=record(JSON.parse(text) as unknown);
  if(manifest.schema_version!==1||manifest.status!=='STAGED_NOT_ACTIVATED'||manifest.node_major!==24||!Array.isArray(manifest.outputs))throw Error('MIGRATION_RUNTIME_MANIFEST_SCHEMA');
  const outputs=manifest.outputs.map(record);runtimeOutputs(runtime,outputs);
  const canonical=Buffer.from((archivedManifest?new TextDecoder('utf-8',{fatal:true}).decode(archivedManifest):text).replaceAll('\r\n','\n'));
  const archived=record(JSON.parse(canonical.toString('utf8')) as unknown);
  if(JSON.stringify(archived.outputs)!==JSON.stringify(manifest.outputs)
    ||JSON.stringify(record(archived.source).inputs)!==JSON.stringify(record(manifest.source).inputs))throw Error('MIGRATION_RUNTIME_ARCHIVE_MISMATCH');
  const files=[...outputs.map(output=>String(output.path)),'build-manifest.json'].sort();
  return {schema_version:1,algorithm:'VERIFIED_RUNTIME_OUTPUTS_AND_CANONICAL_MANIFEST_SHA256_V1',fingerprint:hash(canonical),file_count:files.length,files};
}

export function verifyArtifact(root: string, expectedManifest?: string): string {
  const runtime = path.join(controlledBuildRoot(root), 'runtime');
  const text = readFileSync(safeFile(runtime, 'build-manifest.json'), 'utf8');
  const digest = hash(text), proof = record(JSON.parse(readFileSync(safeFile(root, '.build/artifact-proof.json'), 'utf8')) as unknown);
  if (digest !== (expectedManifest ?? proof.manifest_sha256)) throw new Error('MIGRATION_MANIFEST_TAMPERED');
  const manifest = record(JSON.parse(text) as unknown), current = identity(root);
  if (manifest.schema_version !== 1 || manifest.status !== 'STAGED_NOT_ACTIVATED' || manifest.node_major !== 24 || manifest.compiler !== ts.version
    || JSON.stringify(manifest.source) !== JSON.stringify(current) || proof.source_input_hash !== current.input_hash) throw new Error('MIGRATION_INPUT_DRIFT');
  if (!Array.isArray(manifest.outputs)) throw new Error('MIGRATION_OUTPUT_SCHEMA');
  const expected = mappings(root), seen = manifest.outputs.map((value: unknown) => record(value));
  if (seen.length !== expected.length) throw new Error('MIGRATION_OUTPUT_COUNT');
  for(const [i,item]of expected.entries()){
    const actual=seen[i];if(!actual||actual.path!==item.path||actual.source!==item.source||actual.kind!==item.kind)throw Error('MIGRATION_OUTPUT_MAPPING');
  }
  const outputBytes=runtimeOutputs(runtime,seen);
  for (const [i, item] of expected.entries()) {
    const actual = seen[i];
    if (!actual || actual.path !== item.path || actual.source !== item.source || actual.kind !== item.kind) throw new Error('MIGRATION_OUTPUT_MAPPING');
    const bytes=outputBytes.get(item.path);if(!bytes)throw Error('MIGRATION_OUTPUT_MISSING');
    if (item.kind !== 'COMPILED'&&item.kind!=='WEB' && !bytes.equals(readFileSync(safeFile(root, item.source)))) throw new Error('MIGRATION_LEGACY_OR_RESOURCE_DRIFT');
    if(item.kind==='WEB'&&!bytes.equals(readFileSync(safeFile(root,'.build/emit/'+item.path))))throw new Error(item.path.startsWith('h5/')?'H5_OUTPUT_DRIFT':'WEB01_OUTPUT_DRIFT');
    if (item.path.endsWith('.map')) {
      const map = record(JSON.parse(bytes.toString('utf8')) as unknown);
      if (!Array.isArray(map.sources) || map.sources.some((v: unknown) => typeof v !== 'string' || path.isAbsolute(v))) throw new Error('MIGRATION_ABSOLUTE_SOURCE_MAP');
    }
  }
  return digest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify({ status: 'ARTIFACT_VERIFIED_NOT_ACTIVATED', manifest_sha256: verifyArtifact(sourceRoot(), process.argv[2]) }));
