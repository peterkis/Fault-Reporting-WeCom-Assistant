import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shortcuts,type KeyEvent} from './helpers/card37b-shortcut-module.mjs';

const bindings=[
  ['move-vertical','J K'],['move-horizontal','H L'],['open-close-detail','Enter Esc'],['jump-column','1 2 3'],
  ['claim','A'],['transfer','T'],['complete','D'],['close','X'],['follow','F'],['note','M'],['copy-number','C'],
  ['command-panel','Ctrl K'],['focus-search','/'],['new-report','N'],['toggle-view','V'],['undo','Ctrl Z'],
  ['goto-workbench','G W'],['goto-conversations','G C'],['goto-exceptions','G N'],['help','?'],
] as const;

test('37B B5.1 every B1 binding, modifier, sequence and platform cap',()=>{
  assert.deepEqual(shortcuts.SHORTCUT_GROUPS,['移动','对当前工单','工作区','前往']);
  assert.deepEqual(shortcuts.SHORTCUTS.map(({id,keys})=>[id,keys.join(' ')]),bindings);
  for(const [id,value] of bindings){
    const keys=value.split(' '),combo=value.startsWith('Ctrl '),sequence=value.startsWith('G ');
    assert.deepEqual(shortcuts.shortcutKeys(id,false),keys);
    assert.deepEqual(shortcuts.shortcutKeys(id,true),keys.map(key=>key==='Ctrl'?'⌘':key));
    assert.equal(shortcuts.shortcutSeparator(id),sequence?'然后':!combo&&keys.length>1?'/':undefined);
    if(combo){
      assert.equal(shortcuts.ariaKeyshortcuts(id,false),'Control+'+keys[1]);
      assert.equal(shortcuts.ariaKeyshortcuts(id,true),'Meta+'+keys[1]);
    }
    for(const key of (combo||sequence?keys.slice(1):keys)){
      const event:KeyEvent={key:key==='Esc'?'Escape':key.length===1?key.toLowerCase():key};
      const matches=(extra:Partial<KeyEvent>,prefix?:string)=>shortcuts.matchesShortcut({...event,...extra},id,prefix);
      assert.equal(matches(combo?{ctrlKey:true}:{},sequence?'G':undefined),true,id+' '+key);
      if(combo){assert.equal(matches({metaKey:true}),true);assert.equal(matches({}),false);}
      if(sequence){assert.equal(matches({}),false);assert.equal(matches({},'X'),false);}
      for(const modifier of ['altKey','shiftKey','ctrlKey','metaKey'] as const){
        if(combo&&(modifier==='ctrlKey'||modifier==='metaKey')||key==='?'&&modifier==='shiftKey')continue;
        assert.equal(matches({[modifier]:true,...(combo?{ctrlKey:true}:{})},sequence?'G':undefined),false,id+' '+modifier);
      }
    }
  }
  assert.equal(shortcuts.matchesGotoPrefix({key:'g'}),true);
  assert.equal(shortcuts.matchesGotoPrefix({key:'g',ctrlKey:true}),false);
  assert.equal(shortcuts.matchesShortcut({key:'e'},'claim'),false);
});

test('37B B5.7 account rows follow original workspace flags and manual creation capability',()=>{
  const worker={roles:['ADMIN']},reader={roles:['REPORTER']};
  assert.equal(shortcuts.isShortcutAvailableForPrincipal('close',reader,false),false);
  assert.equal(shortcuts.isShortcutAvailableForPrincipal('close',worker,false),true);
  for(const [id,flag] of [['follow','workbench_follow_enabled'],['new-report','manual_reports_enabled'],
    ['focus-search','workbench_search_enabled'],['goto-conversations','conversation_workspace_enabled'],
    ['goto-exceptions','notification_exceptions_enabled'],['claim','ticket_self_handling_enabled'],
    ['transfer','ticket_assignment_enabled'],['complete','ticket_staff_completion_enabled'],['note','internal_notes_enabled']] as const){
    const available={[flag]:true,...worker};
    assert.equal(shortcuts.isShortcutAvailableForPrincipal(id,worker,false),false,id);
    assert.equal(shortcuts.isShortcutAvailableForPrincipal(id,available,true),true,id);
    if(id==='new-report')assert.equal(shortcuts.isShortcutAvailableForPrincipal(id,available,false),false);
  }
});

test('37B B5.1 platform detection renders Command only on macOS',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try{
    for(const [platform,mac] of [['macOS',true],['Windows',false],['Linux',false]] as const){
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgentData:{platform},platform:mac?'MacIntel':'Win32'}});
      assert.equal(shortcuts.isMacPlatform(),mac);
      assert.deepEqual(shortcuts.shortcutKeys('command-panel'),[mac?'⌘':'Ctrl','K']);
      assert.equal(shortcuts.ariaKeyshortcuts('undo'),mac?'Meta+Z':'Control+Z');
    }
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{platform:'MacIntel'}});
    assert.equal(shortcuts.isMacPlatform(),true);
  }finally{
    if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');
  }
});

test('37B B5.1 a combo with an additional system modifier is unassigned',()=>{
  const captured=shortcuts.SHORTCUTS.filter(def=>shortcuts.matchesShortcut(
    {key:def.id==='undo'?'z':'k',ctrlKey:true,metaKey:true},def.id,
  )).map(def=>def.id);
  assert.deepEqual(captured,[],'Ctrl+Meta is not a B1 modifier chord');
});
