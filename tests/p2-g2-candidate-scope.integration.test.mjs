import test from 'node:test';
import assert from 'node:assert/strict';
import {withG2Runtime} from './helpers/p2-g2-runtime-harness.mjs';
import {createReporterDirectoryPort} from '../src/p2-015-contact-journey.mjs';

for(const [id,count,departments,scope] of [['D12-043',3,1,'DEPARTMENT'],['D12-044',5,2,'CAMPUS'],['D12-045',8,3,'CAMPUS']])
  test(id+' actual independent reports use trusted primary memberships without inventing locations',async t=>{
    const directoryPort=createReporterDirectoryPort({resolveProfile:async input=>({status:'RESOLVED',snapshot:{
      source:'WECOM_DIRECTORY',version:'synthetic-memberships-v1',memberships:[{
        department_ref:'synthetic-department-'+(Number(input.reporter_external_id.split('-').at(-1))%departments),role:'PRIMARY'}]}})});
    await withG2Runtime(async f=>{
      for(let i=0;i<count;i++){await f.inbound('门诊系统进不去了',{chatType:'single',reporter:'synthetic-member-'+i});await f.pump();}
      const before=Number((await f.pool.query('SELECT count(*) FROM communication.delivery')).rows[0].count);
      await f.runtime.incidentExtension.runOnce();
      const items=(await f.get('/api/incident-candidates')).items;assert.equal(items.length,1);
      const detail=await f.get('/api/incident-candidates/'+items[0].id);
      assert.equal(detail.distinct_reporters,count);assert.equal(detail.distinct_departments,departments);
      assert.equal(detail.distinct_locations,0);assert.equal(detail.scope_candidate,scope);
      assert.equal(detail.correlation_window_ms,120000);assert.equal(detail.status,'CANDIDATE');assert.equal(detail.report_sources.length,count);
      await f.runtime.incidentExtension.runOnce();
      assert.equal((await f.get('/api/incident-candidates')).items.length,1);
      assert.equal(Number((await f.pool.query('SELECT count(*) FROM communication.delivery')).rows[0].count),before);
      for(const table of ['incident.incident','incident.incident_report','incident.reporter_subscription','communication.incident_notification_binding'])
        assert.equal(Number((await f.pool.query('SELECT count(*) FROM '+table)).rows[0].count),0);
      assert.equal(Number((await f.pool.query('SELECT count(*) FROM pilot_ticket.ticket')).rows[0].count),count);
      assert.equal(f.providerCalls.length,0);
      t.diagnostic(JSON.stringify({source_case_ids:[id,'D12-051'],surface:'NORMAL_INGRESS_WITH_TRUSTED_DIRECTORY',
        scope_adjudication:scope,source_300s_replaced_by_frozen_120s:true,trusted_locations:0,
        internal_alert_surface:'AUTHORIZED_CANDIDATE_WORKBENCH_QUEUE',candidate_external_notifications:0}));
    },{directoryPort});
  });

test('one Reporter with conflicting report-time primary departments never inflates campus scope',async()=>{
  let conflicting=false;
  const directoryPort=createReporterDirectoryPort({resolveProfile:async input=>({status:'RESOLVED',snapshot:{source:'WECOM_DIRECTORY',
    version:conflicting?'synthetic-v2':'synthetic-v1',memberships:[{role:'PRIMARY',
      department_ref:input.reporter_external_id==='synthetic-member-0'&&conflicting?'synthetic-b':'synthetic-a'}]}})});
  await withG2Runtime(async f=>{
    await f.inbound('门诊系统进不去了',{chatType:'group',reporter:'synthetic-member-0'});await f.pump();
    const old=(await f.pool.query('SELECT id,profile_snapshot,profile_snapshot_hash FROM intake.contact_journey')).rows[0];
    conflicting=true;
    for(let i=0;i<5;i++){await f.inbound('门诊系统进不去了',{chatType:'single',reporter:'synthetic-member-'+i});await f.pump();}
    assert.deepEqual((await f.pool.query('SELECT id,profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE id=$1',[old.id])).rows[0],old);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM intake.contact_journey')).rows[0].count),6);
    await f.runtime.incidentExtension.runOnce();const c=(await f.get('/api/incident-candidates')).items[0];
    const detail=await f.get('/api/incident-candidates/'+c.id);
    assert.equal(detail.distinct_reporters,5);assert.equal(detail.distinct_departments,1);assert.equal(detail.scope_candidate,'DEPARTMENT');
  },{directoryPort});
});

test('missing, ambiguous and untrusted primary metadata remain unknown instead of using first membership',async()=>{
  const cases=[{source:'WECOM_DIRECTORY',version:'synthetic',memberships:[{role:'SECONDARY',department_ref:'synthetic-a'}]},
    {source:'WECOM_DIRECTORY',version:'synthetic',memberships:[{role:'PRIMARY',department_ref:'synthetic-a'},{role:'PRIMARY',department_ref:'synthetic-b'}]},
    {source:'UNTRUSTED',version:'synthetic',memberships:[{role:'PRIMARY',department_ref:'synthetic-c'}]},
    {source:'WECOM_DIRECTORY',memberships:[{role:'PRIMARY',department_ref:'synthetic-d'}]}];
  const directoryPort=createReporterDirectoryPort({resolveProfile:async input=>({status:'RESOLVED',
    snapshot:cases[Number(input.reporter_external_id.split('-').at(-1))]})});
  await withG2Runtime(async f=>{
    for(let i=0;i<4;i++){await f.inbound('门诊系统进不去了',{chatType:'single',reporter:'synthetic-member-'+i});await f.pump();}
    await f.runtime.incidentExtension.runOnce();const c=(await f.get('/api/incident-candidates')).items[0];
    const detail=await f.get('/api/incident-candidates/'+c.id);
    assert.equal(detail.distinct_reporters,4);assert.equal(detail.distinct_departments,0);assert.equal(detail.scope_candidate,'ROOM');
  },{directoryPort});
});
