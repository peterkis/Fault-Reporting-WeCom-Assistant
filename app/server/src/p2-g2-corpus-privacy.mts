type CorpusRow = {case_id?:unknown;source_basis?:unknown;source_kind?:unknown};
import { failG2, g2Hash } from './p2-g2-validation-config.mjs';

// Build-time guard, not a runtime diagnosis or a claim that regexes can identify every name.
// Corpus provenance must explicitly be synthetic; recognizable identifiers are then rejected.
export function validateG2SyntheticCorpus(input: unknown){
  const rows=input as CorpusRow[];
  if(!Array.isArray(rows)||!rows.length||rows.length>1000)failG2('CORPUS_INVALID');
  for(const row of rows){
    if(!row||typeof row.case_id!=='string'||!/(SYNTHETIC|ANONYMIZED|PRODUCT_DECISION|PRODUCT_DESIGN)/u.test((row.source_basis??row.source_kind??'') as string))failG2('CORPUS_PROVENANCE_REQUIRED');
    const value=JSON.stringify(row);
    const ips=value.match(/(?:\b\d{1,3}\.){3}\d{1,3}\b/gu)??[];
    // Frozen examples use RFC5737 documentation addresses, not internal hospital addresses.
    const unsafeIp=ips.some(ip=>!/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.(?:\d{1,2}|1\d\d|2[0-4]\d|25[0-5])$/u.test(ip));
    if(value.length>40000||unsafeIp||/(?:\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/u.test(value)
      ||/(?:https?:\/\/)(?![^\s"/]*\.invalid(?:\/|"))[^\s"]+/u.test(value)
      ||/(?:患者姓名|姓名是|我叫)(?!测试|占位|合成)[\p{Script=Han}]{2,}/u.test(value))failG2('CORPUS_IDENTIFIER_REJECTED');
  }
  if(new Set(rows.map(r=>r.case_id)).size!==rows.length)failG2('CORPUS_DUPLICATE');
  return Object.freeze({checked:rows.length,source_hash:g2Hash(JSON.stringify(rows)),recognizable_identifier_matches:0,
    basis:'SYNTHETIC_PROVENANCE_AND_BUILD_SCAN_NOT_REAL_PERSON_IDENTIFICATION'});
}
