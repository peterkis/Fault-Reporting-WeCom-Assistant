import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {INCIDENT_STATES} from '../src/p2-012-domain-contracts.mjs';

test('P2-012 real TypeScript consumers accept nullable cursors and optional owner teams',async()=>{
  await mkdir('tmp',{recursive:true});const directory=await mkdtemp('tmp/p2012-contract-'),file=directory+'/consumer.ts';
  assert.match(file,/^tmp\/p2012-contract-[A-Za-z0-9]+\/consumer\.ts$/u);
  try{
    await writeFile(file,`import type {IncidentList,IncidentCommand} from '../../contracts/p2_012_contracts';
      const first:IncidentList={items:[],next_cursor:null};
      const next:IncidentList={items:[],next_cursor:'cursor'};
      const cursor:string|null=next.next_cursor;
      const owner:Extract<IncidentCommand,{action:'CONFIRM_INCIDENT'}>['owner_team_id']='PILOT_IT';
      const absent:typeof owner|null=null;
      // @ts-expect-error numeric cursors are outside the wire contract
      const bad:IncidentList={items:[],next_cursor:123};
    `);
    if(process.platform==='win32')execFileSync('cmd.exe',['/d','/s','/c','tsc --noEmit --strict --skipLibCheck '+file],{encoding:'utf8'});
    else execFileSync('tsc',['--noEmit','--strict','--skipLibCheck',file],{encoding:'utf8'});
  }finally{await unlink(file);await rmdir(directory);}
});

test('P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases',async()=>{
  for(const file of ['contracts/openapi.yaml','contracts/conversation_center.openapi.yaml']){
    const document=JSON.parse(execFileSync('python',['-c','import sys,json,yaml; print(json.dumps(yaml.safe_load(sys.stdin.buffer.read().decode("utf-8"))))'],{input:await readFile(file,'utf8'),encoding:'utf8'}));
    const params=document.paths['/api/incidents'].get.parameters,states=params.filter(p=>p.name==='state');
    assert.equal(states.length,1);assert.equal(states[0].in,'query');assert.equal(states[0].required??false,false);
    assert.equal(states[0].schema.type,'string');assert.deepEqual(states[0].schema.enum,['ACTIVE','FINISHED',...INCIDENT_STATES]);
  }
});
