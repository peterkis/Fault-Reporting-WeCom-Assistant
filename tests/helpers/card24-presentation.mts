import assert from 'node:assert/strict';
import type {Browser} from './wbint-t27-browser-fixture.mjs';
import {record} from './wbint-t27-browser-fixture.mjs';

export async function card24Numeric(browser:Browser){
 const values=await browser.evaluate(`(()=>{const selectors=['time','.ds-composer-count','.inbox-unread','.ds-stage-count','.ds-board-group-count','.ds-ticket-heat','.ds-ticket-deadline','.card-tags .ds-tag','.list-group .column-heading>span','.ds-table-footer'];return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(n=>n.checkVisibility()&&/[0-9]/.test(n.textContent)).map(n=>({selector,text:n.textContent,variant:getComputedStyle(n).fontVariantNumeric})));})()`) as {selector:string;text:string;variant:string}[];
 assert.ok(values.length>0,'F1 rendered numeric controls');
 for(const value of values)assert.equal(value.variant,'tabular-nums','F1 '+value.selector+' '+value.text);
 return values;
}

export async function card24Fonts(browser:Browser){
 await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
 const sample=record(await browser.evaluate(`(()=>{
  const families=['Inter Variable','Noto Sans SC Variable','JetBrains Mono Variable'];
  const selectors=['h1','.ds-ticket-body h3','.ds-message-bubble p','.notification-table td','.ds-button','[data-slot=select-trigger]','.sidebar-brand-copy'];
  const fonts=performance.getEntriesByType('resource').filter(n=>/\\.woff2(?:$|\\?)/.test(n.name)).map(n=>({file:new URL(n.name).pathname,external:new URL(n.name).origin!==location.origin,encoded:n.encodedBodySize,transfer:n.transferSize}));
  return {checks:families.map(f=>({family:f,check:document.fonts.check('14px "'+f+'"'),loaded:[...document.fonts].filter(n=>n.family.replaceAll('"','').replaceAll("'",'')===f&&n.status==='loaded').length,failed:[...document.fonts].filter(n=>n.family.replaceAll('"','').replaceAll("'",'')===f&&n.status==='error').length})),sans:selectors.flatMap(s=>[...document.querySelectorAll(s)].filter(n=>n.checkVisibility()).map(n=>({selector:s,font:getComputedStyle(n).fontFamily}))),mono:[...document.querySelectorAll('.card-top>a,.card-top>span:first-child,.notification-source-link[data-source-domain=TICKET]')].filter(n=>n.checkVisibility()).map(n=>getComputedStyle(n).fontFamily),fonts,total:fonts.reduce((sum,n)=>sum+n.encoded,0),dpr:devicePixelRatio,zoom:visualViewport.scale};
 })()`));
 assert.ok(Array.isArray(sample.checks));
 for(const value of sample.checks){const face=record(value);assert.equal(face.check,true,'F1 '+String(face.family));assert.ok(Number(face.loaded)>0,'F1 loaded '+String(face.family));assert.equal(face.failed,0);}
 assert.ok(Array.isArray(sample.sans)&&sample.sans.length>0);
 for(const value of sample.sans)assert.match(String(record(value).font),/^"?Inter Variable/u);
 assert.ok(Array.isArray(sample.mono)&&sample.mono.length>0,'F3 rendered ticket number');
 for(const value of sample.mono)assert.match(String(value),/^"?JetBrains Mono Variable/u);
 assert.ok(Array.isArray(sample.fonts)&&sample.fonts.length>0);assert.equal(sample.fonts.some(v=>record(v).external),false,'F1 no remote font');
 assert.equal(sample.dpr,1);assert.equal(sample.zoom,1);
 return {...sample,numeric:await card24Numeric(browser)};
}

export async function card24Kbd(browser:Browser,selector:string){
 const value=record(await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(n);return Object.fromEntries(['height','minWidth','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderTopColor','borderRadius','backgroundColor','fontSize','fontFamily','fontWeight','color'].map(k=>[k,s[k]]));})()`));
 assert.equal(value.height,'18px');assert.equal(value.minWidth,'18px');assert.equal(value.paddingRight,'4px');assert.equal(value.paddingLeft,'4px');assert.equal(value.borderTopWidth,'1px');assert.equal(value.borderRadius,'4px');assert.equal(value.fontSize,'12px');assert.equal(value.fontWeight,'500');assert.match(String(value.fontFamily),/^"?Inter Variable/u);
 return value;
}

export async function card24Conversation(browser:Browser,mode:'allowed'|'denied'|'waiting'|'failed'){
 const sample=record(await browser.evaluate(`(()=>{
  const chat=document.querySelector('.inbox-chat'),rect=n=>n.getBoundingClientRect(),css=n=>getComputedStyle(n),visible=n=>Boolean(n&&n.checkVisibility()&&css(n).clipPath==='none');
  const corners=n=>{const s=css(n);return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius,s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft];};
  const banner=chat.querySelector('.inbox-reception'),composer=chat.querySelector('.inbox-composer'),input=chat.querySelector('textarea[data-purpose=messages]'),first=chat.querySelector('.inbox-message-user .ds-message-bubble'),second=chat.querySelector('.inbox-message-user.inbox-message-merged .ds-message-bubble'),outgoing=chat.querySelector('.inbox-message-human .ds-message-bubble'),badge=chat.querySelector('[data-chat-assignment]');
  const color=name=>{const n=document.createElement('span');n.style.color='var('+name+')';document.body.append(n);const result=css(n).color;n.remove();return result;};
  const titles=[...document.querySelectorAll('.inbox-business .inbox-associated>h3,.inbox-business .inbox-reporter>h3,.inbox-business .inbox-origin>h3')],person=document.querySelector('.inbox-business .inbox-reporter-person strong'),department=document.querySelector('.inbox-business .inbox-reporter-person p');
  return {width:innerWidth,bubbles:first&&second&&outgoing?{first:corners(first),second:corners(second),outgoing:corners(outgoing),positions:[first.dataset.groupPosition,second.dataset.groupPosition],avatars:[...chat.querySelectorAll('.ds-message-avatar .ds-avatar')].map(n=>[rect(n).width,rect(n).height]),placeholder:rect(chat.querySelector('.inbox-message-merged .ds-message-avatar')).width}:null,
   banner:{visible:visible(banner),gap:rect(composer).top-rect(banner).bottom,height:rect(banner).height,text:banner.textContent,mainColor:css(banner.querySelector('strong')).color,mainWeight:css(banner.querySelector('strong')).fontWeight,hintColor:css(banner.querySelector('.inbox-reception-hint')).color},
   composer:{background:css(composer).backgroundColor,inputBackground:css(input).backgroundColor,white:color('--bg-canvas'),muted:color('--bg-subtle'),countVisible:visible(chat.querySelector('#conversation-reply-panel .ds-composer-count')),count:chat.querySelector('#conversation-reply-panel .ds-composer-count').textContent,shortcut:visible(chat.querySelector('#conversation-reply-panel .ds-composer-shortcut')),placeholder:input.placeholder,disabled:input.disabled},
   header:{border:css(chat.querySelector('.inbox-chat-header')).borderBottomWidth,background:css(chat.querySelector('.inbox-chat-header')).backgroundColor,gap:rect(chat.querySelector('.inbox-timeline')).top-rect(chat.querySelector('.inbox-chat-header')).bottom,overflow:css(chat.querySelector('.inbox-timeline')).overflowY,status:badge.textContent,tone:badge.dataset.tone},
   sidebar:{titles:titles.map(n=>[css(n).fontSize,css(n).fontWeight]),person:person?[css(person).fontSize,css(person).fontWeight]:null,department:department?css(department).fontSize:null,source:[...document.querySelectorAll('.inbox-business .inbox-origin p')].map(n=>[css(n).fontSize,css(n).lineHeight,css(n.firstElementChild).color,css(n.lastElementChild).color])},
   colors:{primary:color('--text-primary'),secondary:color('--text-secondary')},exceptions:[...document.querySelectorAll('.inbox-delivery-exception')].map(n=>({svg:n.querySelectorAll('svg').length,text:n.textContent,size:rect(n.querySelector('svg')).width})),overflow:document.documentElement.scrollWidth>innerWidth};
 })()`));
 const banner=record(sample.banner),composer=record(sample.composer),header=record(sample.header),colors=record(sample.colors);
 assert.equal(header.border,'1px');assert.equal(header.background,composer.white);assert.equal(header.gap,0);assert.equal(header.overflow,'auto');
 assert.equal(composer.placeholder&&String(composer.placeholder).includes('给 '),false);assert.equal(String(composer.placeholder).includes(' …'),false);
 if(mode==='waiting'){
  assert.equal(banner.visible,true);assert.equal(banner.gap,0);assert.ok(Number(banner.height)<=52);assert.equal(banner.mainColor,colors.primary);assert.equal(banner.mainWeight,'600');assert.equal(banner.hintColor,colors.secondary);
  assert.equal(composer.background,composer.white);assert.equal(composer.inputBackground,composer.white);assert.equal(composer.countVisible,true);assert.equal(composer.count,'0 / 2000');assert.equal(composer.disabled,true);assert.equal(composer.shortcut,false);assert.equal(header.status,'待接待');assert.equal(header.tone,'warning');
 }else{
  assert.equal(composer.background,mode==='denied'?composer.muted:composer.white);if(mode==='denied')assert.equal(composer.inputBackground,composer.muted);assert.equal(composer.shortcut,mode!=='denied');
  const b=record(sample.bubbles);assert.deepEqual(b.first,['4px','12px','12px','12px','10px','12px','10px','12px']);assert.deepEqual(b.second,['12px','12px','12px','12px','10px','12px','10px','12px']);assert.deepEqual(b.outgoing,['12px','4px','12px','12px','10px','12px','10px','12px']);assert.deepEqual(b.positions,['first','rest']);assert.equal(b.placeholder,28);
  assert.ok(Array.isArray(b.avatars)&&b.avatars.length>0);for(const avatar of b.avatars)assert.deepEqual(avatar,[28,28]);
  assert.equal(header.tone,'brand');assert.equal(header.status,mode==='denied'?'接待中 · 林舟':'接待中 · 我');
  const side=record(sample.sidebar);assert.deepEqual(side.titles,[['13px','600'],['13px','600'],['13px','600']]);assert.deepEqual(side.person,['14px','600']);assert.equal(side.department,'12px');assert.deepEqual(side.source,Array.from({length:3},()=>['13px','22px',colors.secondary,colors.primary]));
 }
 assert.ok(Array.isArray(sample.exceptions));for(const value of sample.exceptions){const e=record(value);assert.equal(e.svg,1);assert.equal(e.text,'');assert.equal(e.size,12);}
 assert.equal(sample.overflow,false);
 return sample;
}
