import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  CLAIM_UNDONE_BEFORE_NOTIFICATION_REASON,
  DEFAULT_CLAIM_NOTIFICATION_UNDO_WINDOW_MS,
  DEFAULT_CLOSURE_NOTIFICATION_UNDO_WINDOW_MS,
  MAX_NOTIFICATION_UNDO_WINDOW_MS,
  normalizeNotificationUndoWindowMs,
} from '../app/server/src/notification-undo-window.mjs';
import {
  readHumanWorkbenchConfiguration,
  readWorkbenchRoleSettings,
  readWorkbenchWorkerSettings,
  workbenchRoleEnvironment,
} from '../app/server/src/human-workbench-configuration.mjs';
import {workbenchTestSettings} from './helpers/human-workbench-test-settings.mjs';

function fixture(run:(f:ReturnType<typeof workbenchTestSettings>)=>void|Promise<void>){
  const directory=mkdtempSync(join(tmpdir(),'card37a-undo-config-'));
  return Promise.resolve().then(()=>run(workbenchTestSettings(directory))).finally(()=>rmSync(directory,{recursive:true,force:true}));
}

test('notification undo window defaults and normalization enforce integer bounds',()=>{
  assert.equal(DEFAULT_CLOSURE_NOTIFICATION_UNDO_WINDOW_MS,10_000);
  assert.equal(DEFAULT_CLAIM_NOTIFICATION_UNDO_WINDOW_MS,10_000);
  assert.equal(MAX_NOTIFICATION_UNDO_WINDOW_MS,3_600_000);
  assert.equal(CLAIM_UNDONE_BEFORE_NOTIFICATION_REASON,'CLAIM_UNDONE_BEFORE_NOTIFICATION');

  assert.equal(normalizeNotificationUndoWindowMs(undefined,DEFAULT_CLOSURE_NOTIFICATION_UNDO_WINDOW_MS),10_000);
  assert.equal(normalizeNotificationUndoWindowMs(0,DEFAULT_CLOSURE_NOTIFICATION_UNDO_WINDOW_MS),0);
  assert.equal(normalizeNotificationUndoWindowMs(30_000,DEFAULT_CLAIM_NOTIFICATION_UNDO_WINDOW_MS),30_000);
  assert.equal(normalizeNotificationUndoWindowMs(MAX_NOTIFICATION_UNDO_WINDOW_MS,DEFAULT_CLAIM_NOTIFICATION_UNDO_WINDOW_MS),3_600_000);

  for(const invalid of [-1,1.5,MAX_NOTIFICATION_UNDO_WINDOW_MS+1,'10000',null,NaN,Infinity]){
    assert.throws(()=>normalizeNotificationUndoWindowMs(invalid,10_000),/FLAG_INVALID/u);
  }
});

test('human-workbench configuration defaults notification undo windows to 10s, forwards APP/WORKER settings, and excludes GATEWAY',()=>fixture(f=>{
  const read=()=>{
    const config=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});
    assert.ok(config.enabled);
    return config;
  };
  const defaults=read();
  assert.equal(defaults.settings.closureNotificationUndoWindowMs,10_000);
  assert.equal(defaults.settings.claimNotificationUndoWindowMs,10_000);

  const defaultApp=readWorkbenchRoleSettings('APP',workbenchRoleEnvironment(defaults,'APP'));
  assert.equal(defaultApp.closureNotificationUndoWindowMs,10_000);
  assert.equal(defaultApp.claimNotificationUndoWindowMs,10_000);
  const defaultWorker=readWorkbenchWorkerSettings(workbenchRoleEnvironment(defaults,'WORKER'));
  assert.equal(defaultWorker.closureNotificationUndoWindowMs,10_000);

  f.settings.closureNotificationUndoWindowMs=0;
  f.settings.claimNotificationUndoWindowMs=25_000;
  f.save();
  const custom=read();
  const appEnv=workbenchRoleEnvironment(custom,'APP');
  const workerEnv=workbenchRoleEnvironment(custom,'WORKER');
  const gatewayEnv=workbenchRoleEnvironment(custom,'GATEWAY');

  const appSettings=readWorkbenchRoleSettings('APP',appEnv);
  assert.equal(appSettings.closureNotificationUndoWindowMs,0);
  assert.equal(appSettings.claimNotificationUndoWindowMs,25_000);
  assert.equal(readWorkbenchWorkerSettings(workerEnv).closureNotificationUndoWindowMs,0);
  assert.equal(JSON.parse(gatewayEnv.WORKBENCH_ROLE_SETTINGS??'{}').closureNotificationUndoWindowMs,undefined);
  assert.equal(JSON.parse(gatewayEnv.WORKBENCH_ROLE_SETTINGS??'{}').claimNotificationUndoWindowMs,undefined);

  const tamperedGateway={...gatewayEnv,WORKBENCH_ROLE_SETTINGS:JSON.stringify({...JSON.parse(gatewayEnv.WORKBENCH_ROLE_SETTINGS??'{}'),claimNotificationUndoWindowMs:0})};
  assert.throws(()=>readWorkbenchRoleSettings('GATEWAY',tamperedGateway),/claimNotificationUndoWindowMs/u);

  for(const badValue of [-1,1.25,'0',3_600_001]){
    writeFileSync(f.file,JSON.stringify({...f.settings,closureNotificationUndoWindowMs:badValue}));
    assert.throws(read,/closureNotificationUndoWindowMs/u);
  }
  f.save();
  for(const badValue of [-1,1.25,'0',3_600_001]){
    writeFileSync(f.file,JSON.stringify({...f.settings,claimNotificationUndoWindowMs:badValue}));
    assert.throws(read,/claimNotificationUndoWindowMs/u);
  }
}));
