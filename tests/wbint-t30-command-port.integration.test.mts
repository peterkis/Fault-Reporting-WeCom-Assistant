import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t30Http,text,record} from './helpers/t30-internal-note-fixture.mjs';
import {createP2012IncidentCommandService} from '../src/p2-012-incident-command-service.mjs';
test('T30 default public Incident Command Port honors its enabled internal-note purpose',async()=>{
  await t30Http({purpose:'t30port'},async({pool,f,confirm})=>{
    const incident=await confirm(),service=createP2012IncidentCommandService({pool,enabled:true,internalNotesEnabled:true});
    const result=await service.perform({authContext:{principal_id:text(record(f.admin).id)},command:{action:'ADD_INTERNAL_NOTE',incident_id:incident,client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:'合成公共 Port 调用'}});
    assert.equal(result.ok,true,'the supported default-query factory must accept the authorized enabled purpose');
  });
});
