import { exactP2016,snapshotP2016,failP2016,textHashP2016 } from './p2-016-domain-contracts.mjs';
export function createP2016InboundScope(input){
  const v=exactP2016(input,['bot_id','person_hashes','group_hashes']);
  const hashes=a=>Array.isArray(a)&&a.length>=1&&a.length<=20&&new Set(a).size===a.length&&a.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/u.test(h));
  if(typeof v.bot_id!=='string'||!v.bot_id.length||v.bot_id.length>256||!hashes(v.person_hashes)||!hashes(v.group_hashes))failP2016('LIVE_SCOPE_REQUIRED',403);
  const people=new Set(v.person_hashes),groups=new Set(v.group_hashes);
  return Object.freeze({
    allowed_target_hashes:Object.freeze([...new Set([...people,...groups])]),
    accepts(input){
      let m;try{m=snapshotP2016(input);}catch{return false;}
      if(m?.provider!=='WECOM_AIBOT'||m.bot_id!==v.bot_id||typeof m.sender_user_id!=='string'||!people.has(textHashP2016(m.sender_user_id)))return false;
      return m.chat_type==='single'||m.chat_type==='group'&&typeof m.chat_id==='string'&&groups.has(textHashP2016(m.chat_id));
    },
  });
}
