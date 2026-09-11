import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {g2CandidateInventory,requirePreparedG2Candidate} from '../src/p2-g2-candidate.mjs';
import {validateYxxEntryConfig,failYxx} from '../src/p2-g2-yixiaoxiu-contract.mjs';

export function checkYxx({requireReady=false}={}){
  const example=JSON.parse(readFileSync(new URL('../config_examples/yixiaoxiu-member-ticket-entry.example.json',import.meta.url),'utf8'));
  const c=validateYxxEntryConfig(example.reporterMemberEntry);
  if(c.enabled!==false||example.wecomWebOAuth.enabled!==false||example.reporterPolicy!=='MEMBER_REQUIRED')failYxx('CONFIG_INVALID');
  for(const name of ['member_session','legacy_prepare','legacy_prepared','logout','logged_out','error','member_entry_config']){
    const schema=JSON.parse(readFileSync(new URL('../contracts/yixiaoxiu_'+name+'.schema.json',import.meta.url),'utf8'));
    if(schema.type!=='object'||schema.additionalProperties!==false)failYxx('CONFIG_INVALID');
  }
  const inventory=g2CandidateInventory();if(requireReady)requirePreparedG2Candidate(inventory.fingerprint);
  return {ok:true,work_item:'P2-G2-YXX-TICKET-ENTRY',check_scope:requireReady?'CURRENT_READY':'SOURCE_PREPARATION',candidate_fingerprint:inventory.fingerprint,
    persistent_defaults_off:true,readiness_checked:requireReady,live_authorized:false,database_connections:0,provider_calls:0};
}
export function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){console.log('Usage: node scripts/p2-g2-yixiaoxiu-check.mjs [--require-ready]\nDefault: source/preparation only. --require-ready requires complete current G2 plus48 member scenarios and independent reviews. Never authorizes live.');return;}
  if(argv.length>1||argv.some(a=>a!=='--require-ready'))failYxx('CONFIG_INVALID');console.log(JSON.stringify(checkYxx({requireReady:argv.includes('--require-ready')})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch(error){console.log(JSON.stringify({ok:false,error_code:/^(?:P2_G2|YXX_ENTRY)_[A-Z_]+$/u.test(error?.code??'')?error.code:'YXX_ENTRY_CONFIG_INVALID'}));process.exitCode=1;}
