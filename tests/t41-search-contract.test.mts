import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSearchRequest,normalizeSearchCriteria,searchCriteriaKey,searchParameters,SearchInputError} from '../src/workbench-search-contracts.mjs';

test('search canonicalizes complete criteria without treating literal wildcard characters as a pattern',()=>{
 const raw=new URLSearchParams('q=%20%25_%20&sources=WECOM_GROUP,WECOM_DIRECT&statuses=QUEUED,NEW&limit=2');
 const input=parseSearchRequest(raw);
 assert.deepEqual(input,{criteria:{q:'%_',column:'all',range:'all',scope:'team',responsibility:'any',resolver_team_id:null,assignee_id:null,
  sources:['WECOM_DIRECT','WECOM_GROUP'],source_group_ref:null,statuses:['NEW','QUEUED'],supplement:'any',schedule:'any'},cursor:null,limit:2});
 assert.equal(raw.get('q'),' %_ ');
 assert.equal(searchCriteriaKey(input.criteria),searchCriteriaKey(parseSearchRequest(searchParameters(input.criteria)).criteria));
});
test('search rejects unknown or duplicate keys, array duplicates, controls and invalid enum instead of silently changing criteria',()=>{
 for(const query of ['q=a&q=b','unknown=x','sources=WECOM_GROUP,WECOM_GROUP','statuses=NEW,','statuses=VIEWER','q=%0Ahello','source_group_ref=same-name','responsibility=owner','supplement=read']){
  assert.throws(()=>parseSearchRequest(new URLSearchParams(query)),SearchInputError,query);
 }
 const q='😀'.repeat(128);assert.equal(parseSearchRequest(new URLSearchParams({q})).criteria.q,q);
 assert.throws(()=>parseSearchRequest(new URLSearchParams({q:q+'x'})),SearchInputError);
 const original=parseSearchRequest(new URLSearchParams()).criteria;
 assert.throws(()=>normalizeSearchCriteria({...original,hidden_count:1}),SearchInputError);
 assert.throws(()=>normalizeSearchCriteria({...original,q:'\ud800'}),SearchInputError);
});
test('search bounds limit and opaque cursor separately',()=>{
 for(const value of ['0','101','01','1.5','Infinity'])assert.throws(()=>parseSearchRequest(new URLSearchParams({limit:value})),error=>error instanceof SearchInputError&&error.code==='LIMIT_INVALID');
 for(const value of ['', 'a'.repeat(2049),'/not-a-cursor'])assert.throws(()=>parseSearchRequest(new URLSearchParams({cursor:value})),error=>error instanceof SearchInputError&&error.code==='CURSOR_INVALID');
});
