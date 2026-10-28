import test from 'node:test';
import assert from 'node:assert/strict';
import {activityTime,groupActivityRecords} from '../app/pc-admin/src/app/activity-time.mjs';

test('activity groups use exact Beijing calendar days across loaded pages',()=>{
  const now=Date.parse('2026-10-28T00:10:00+08:00');
  const firstPage=[{id:1,at:'2026-10-28 00:05:00'},{id:2,at:'2026-10-27 23:55:00'}];
  const olderPage=[{id:3,at:'2026-10-27 09:00:00'},{id:4,at:'2026-10-26 12:00:00'},{id:5,at:'2026-10-25 12:00:00'}];
  const records=[...firstPage,...olderPage];
  assert.deepEqual(groupActivityRecords(records,now).map(group=>({label:group.label,ids:group.records.map(record=>record.id)})),[
    {label:'今天',ids:[1]},{label:'昨天',ids:[2,3]},{label:'10月26日',ids:[4]},{label:'10月25日',ids:[5]},
  ]);
  assert.deepEqual(records.map(record=>record.id),[1,2,3,4,5]);
  assert.deepEqual(groupActivityRecords([],now),[]);
  assert.deepEqual(groupActivityRecords([{at:'2026-10-25 23:59:59'},{at:'2026-10-24 23:59:59'}],Date.parse('2026-10-26T00:00:00+08:00')).map(group=>group.label),['昨天','10月24日']);
  assert.equal(groupActivityRecords([{at:'2026-12-31 23:59:59'}],Date.parse('2027-01-01T00:00:00+08:00'))[0]?.label,'昨天');
});

test('activity times stay compact and retain the year for older calendar years',()=>{
  const now=Date.parse('2026-10-28T00:10:00+08:00');
  const cases:readonly (readonly [string,string])[]=[
    ['2026-10-28 00:09:59','刚刚'],['2026-10-27 23:55:00','15 分钟前'],
    ['2026-10-27 23:10:00','1 小时前'],['2026-10-27 00:10:00','1 天前'],
    ['2026-10-22 00:10:00','6 天前'],['2026-10-21 00:10:00','10月21日'],
    ['2025-10-21 00:10:00','2025年10月21日'],['2026-10-29 00:00:00','10月29日'],
  ];
  for(const [at,label] of cases)assert.equal(activityTime(at,now),label);
  assert.equal(activityTime('2026-01-01 00:00:00',Date.parse('2026-12-31T17:00:00Z')),'2026年1月1日');
  assert.equal(groupActivityRecords([{at:'2026-10-29 00:00:00'}],now)[0]?.label,'10月29日');
});
