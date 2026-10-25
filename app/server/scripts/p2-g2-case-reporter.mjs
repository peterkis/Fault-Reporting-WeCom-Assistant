import path from 'node:path';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
// Node's test runner supplies the executing file; names in comments or another
// file cannot satisfy a scenario binding. Only non-sensitive test metadata is kept.
export default async function* cases(events){
  for await(const event of events)if(['test:pass','test:fail'].includes(event.type)){
    const d=event.data;
    yield JSON.stringify({...g2EvidenceTime(),time_basis:'REPORTER_OBSERVED_AT',event:event.type,name:d.name,file:typeof d.file==='string'?path.relative(process.cwd(),d.file).replaceAll('\\','/'):null,
      line:d.line??null,nesting:d.nesting??0,skip:d.skip??false,todo:d.todo??false})+'\n';
  }
}
