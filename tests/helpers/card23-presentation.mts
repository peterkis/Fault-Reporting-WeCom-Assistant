import assert from 'node:assert/strict';
import type {Browser} from './wbint-t27-browser-fixture.mjs';

export interface Card23Geometry {
 width:number;chatWidth:number;rightWidth:number|null;headerOverlap:boolean;name:{text:string;scroll:number;client:number};
 picker:{gap:number;position:string;icon:number;menuGap:number;indicatorContained:boolean};metaGap:number;avatarGap:number;avatarTop:number;avatarSize:number;
 groups:{avatar:number;meta:number;slot:number;gap:number}[];
 deliveries:{label:string;text:string;footer:boolean;statusTop:number;timeTop:number|null;bubbleBottom:number;color:string;expected:string;icons:number;iconSize:number;idCount:number}[];
 composer:{placeholder:string;disabled:boolean;reason:string;reasonVisible:boolean;reasonCenterDelta:number;described:boolean;shortcutVisible:boolean;sendIcon:number;lock:number;draftIconOnly:boolean};
 banner:{visible:boolean;text:string;icon:number;takeover:number};
 sidebar:{titleGaps:number[];blockGaps:number[];avatar:number;personGap:number;sourceLabels:string[];replyInteractive:boolean};
 system:string[];overflow:boolean;
}

export async function card23Geometry(browser:Browser):Promise<Card23Geometry>{
 await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
 return await browser.evaluate(`(()=>{
  const rect=n=>n.getBoundingClientRect(),visible=n=>Boolean(n&&n.checkVisibility()&&getComputedStyle(n).clipPath==='none'),size=n=>n?rect(n).width:0,chat=document.querySelector('.inbox-chat'),name=chat.querySelector('h2'),picker=chat.querySelector('.inbox-topic-picker'),val=picker.querySelector('[data-slot=select-value]'),arrow=picker.querySelector('.select__indicator');
  const incoming=[...chat.querySelectorAll('.inbox-message-user')].slice(0,2),first=incoming[0],meta=first.querySelector('header'),strong=meta.querySelector('strong'),dot=meta.querySelector('[aria-hidden=true]'),avatar=first.querySelector('.ds-message-avatar'),content=first.querySelector('.ds-message-content');
  const input=chat.querySelector('textarea[data-purpose=messages]'),reason=document.getElementById(input.getAttribute('aria-describedby')),send=chat.querySelector('[data-action=send-conversation-reply]'),banner=chat.querySelector('.inbox-reception'),side=document.querySelector('.inbox-business .inbox-associated'),identity=rect(chat.querySelector('.inbox-chat-name')),tools=rect(chat.querySelector('.inbox-chat-tools')),identityRight=Math.max(...[...chat.querySelectorAll('.inbox-chat-name>h2,.inbox-chat-name>.ds-tag')].map(n=>rect(n).right));
  const token=name=>{const n=document.createElement('span');n.style.color='var('+name+')';document.body.append(n);const c=getComputedStyle(n).color;n.remove();return c;};
  const sections=side?[side,side.querySelector('.inbox-reporter'),side.querySelector('.inbox-origin')]:[];
  return {
   width:innerWidth,chatWidth:rect(chat).width,rightWidth:visible(document.querySelector('.inbox-business'))?rect(document.querySelector('.inbox-business')).width:null,headerOverlap:identity.left<tools.right&&identityRight>tools.left&&identity.top<tools.bottom&&identity.bottom>tools.top,name:{text:name.textContent,scroll:name.scrollWidth,client:name.clientWidth},
   picker:{gap:rect(arrow).left-rect(val).right,position:getComputedStyle(arrow).position,icon:size(picker.querySelector('.inbox-topic-icon')),menuGap:rect(chat.querySelector('.inbox-more-actions summary')).left-rect(arrow).right,indicatorContained:rect(arrow).right<=rect(picker).right+1},
   metaGap:rect(dot).left-rect(strong).right,avatarGap:rect(content).left-rect(avatar).right,avatarTop:rect(avatar).top-rect(meta).top,avatarSize:size(avatar.querySelector('.ds-avatar')),
   groups:incoming.map(n=>({avatar:n.querySelectorAll('.ds-message-avatar .ds-avatar').length,meta:n.querySelectorAll('header').length,slot:size(n.querySelector('.ds-message-avatar')),gap:parseFloat(getComputedStyle(n).marginBottom)})),
   deliveries:[...chat.querySelectorAll('[data-message-delivery]')].map(n=>{const bubble=n.closest('.ds-message-content').querySelector('.ds-message-bubble'),time=n.closest('.ds-message-content').querySelector('header time'),icon=n.querySelector('svg'),label=n.dataset.deliveryLabel;return {label,text:n.innerText,footer:Boolean(n.closest('footer')),statusTop:rect(n).top,timeTop:time?rect(time).top:null,bubbleBottom:rect(bubble).bottom,color:getComputedStyle(n.querySelector('[data-delivery-id]')??n).color,expected:token(label==='发送失败'?'--tone-danger-fg':label==='结果待核实'?'--tone-attention-fg':'--text-tertiary'),icons:n.querySelectorAll('svg').length,iconSize:size(icon),idCount:n.querySelectorAll('[data-delivery-id]').length};}),
   composer:{placeholder:input.placeholder,disabled:input.disabled,reason:reason.textContent,reasonVisible:visible(reason),reasonCenterDelta:(rect(reason).top+rect(reason).bottom-rect(send).top-rect(send).bottom)/2,described:input.getAttribute('aria-describedby')===reason.id,shortcutVisible:visible(chat.querySelector('#conversation-reply-panel .ds-composer-shortcut')),sendIcon:size(send.querySelector('svg')),lock:size(chat.querySelector('#conversation-note-tab svg')),draftIconOnly:[...chat.querySelectorAll('.inbox-draft-status')].some(n=>visible(n)&&n.querySelector('svg')&&!visible(n.querySelector('.inbox-draft-copy')))},
   banner:{visible:visible(banner),text:banner.textContent,icon:size(banner.querySelector('p>svg')),takeover:size(banner.querySelector('[data-action=takeover-conversation] svg'))},
   sidebar:{titleGaps:sections.map((n,i)=>{const h=n.querySelector(':scope>h3'),next=i===0?n.querySelector('.inbox-mini-ticket'):i===1?n.querySelector('.inbox-reporter-person'):n.querySelector('p');return rect(next).top-rect(h).bottom;}),blockGaps:side?[rect(sections[1]).top-rect(side.querySelector('.inbox-open-summary')).bottom,rect(sections[2]).top-rect(sections[1]).bottom]:[],avatar:side?size(side.querySelector('.inbox-reporter-person>.ds-avatar')):0,personGap:side?rect(side.querySelector('.inbox-reporter-person>div')).left-rect(side.querySelector('.inbox-reporter-person>.ds-avatar')).right:0,sourceLabels:side?[...side.querySelectorAll('.inbox-origin p>span:first-child')].map(n=>n.textContent):[],replyInteractive:Boolean(side?.querySelector('.inbox-reply-target')?.closest('a,button'))},
   system:[...chat.querySelectorAll('.inbox-message-system p')].map(n=>n.textContent),overflow:document.documentElement.scrollWidth>innerWidth
  };
 })()`) as Card23Geometry;
}

export function assertCard23Geometry(sample:Card23Geometry,mode:'allowed'|'denied'|'failed'){
 assert.equal(sample.name.text,'欧阳慧敏（合成）');assert.ok(sample.name.scroll<=sample.name.client,'V3 full name '+JSON.stringify(sample.name));
 assert.equal(sample.headerOverlap,false,'V3 identity and tools never overlap');
 assert.ok(sample.picker.gap>=4,'V2 value/arrow gap '+sample.picker.gap);assert.equal(sample.picker.position,'static');assert.equal(sample.picker.icon,14);
 assert.ok(sample.picker.menuGap>=4);assert.equal(sample.picker.indicatorContained,true);
 if(sample.width===1440){assert.ok(sample.chatWidth>=500);assert.equal(sample.rightWidth,264);}
 assert.equal(sample.metaGap,4,'V5 meta gap');assert.equal(sample.avatarGap,8);assert.ok(Math.abs(sample.avatarTop)<=1);assert.equal(sample.avatarSize,28);
 assert.equal(sample.groups[0]?.avatar,1);assert.equal(sample.groups[0]?.meta,1);assert.equal(sample.groups[0]?.gap,6);
 assert.equal(sample.groups[1]?.avatar,0);assert.equal(sample.groups[1]?.meta,0);assert.equal(sample.groups[1]?.slot,28);
 assert.deepEqual(sample.deliveries.map(d=>d.label).sort(),['渠道已确认发送','排队中','发送失败','结果待核实'].sort());
 for(const d of sample.deliveries){
  assert.equal(d.color,d.expected);assert.equal(d.icons,1);assert.equal(d.iconSize,12);assert.equal(d.idCount,1);
  if(d.label==='排队中'){assert.equal(d.footer,false);assert.notEqual(d.timeTop,null);assert.ok(Math.abs(d.statusTop-(d.timeTop??Infinity))<=2);}
  else if(d.label==='渠道已确认发送'){assert.equal(d.footer,false);assert.equal(d.text,'');}
  else{assert.equal(d.footer,true);assert.ok(d.statusTop>=d.bubbleBottom);if(d.label==='发送失败')assert.match(d.text,/V23_SYNTHETIC_FAILURE/u);}
 }
 assert.equal(sample.composer.placeholder.includes('Ctrl'),false);assert.equal(sample.composer.disabled,mode==='denied');assert.equal(sample.composer.described,true);
 assert.equal(sample.composer.sendIcon,14);assert.equal(sample.composer.lock,13);assert.equal(sample.composer.draftIconOnly,false);
 if(mode==='denied'){assert.equal(sample.composer.reason,'你当前没有回复权限');assert.equal(sample.composer.reasonVisible,true);assert.ok(Math.abs(sample.composer.reasonCenterDelta)<=1);assert.equal(sample.composer.shortcutVisible,false);}
 if(sample.width>900){assert.deepEqual(sample.sidebar.titleGaps,[8,8,8]);assert.deepEqual(sample.sidebar.blockGaps,[24,24]);assert.equal(sample.sidebar.avatar,32);assert.equal(sample.sidebar.personGap,10);assert.deepEqual(sample.sidebar.sourceLabels,['原始来源：','当前沟通：','回复方式：']);assert.equal(sample.sidebar.replyInteractive,false);}
 assert.ok(sample.system.some(text=>/^已记录现场检查进展（合成） · \d{2}:\d{2}$/u.test(text)),'V10 '+JSON.stringify(sample.system));assert.equal(sample.overflow,false);
}
