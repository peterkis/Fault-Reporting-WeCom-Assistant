import type {ComponentPropsWithRef,ReactNode} from 'react';
import {Fragment,useId,useLayoutEffect,useRef,useState} from 'react';
import {Bell,Bot,Check,CircleX,Clock3,Undo2} from 'lucide-react';
import {categoryOf} from '../../category-map';
import type {WorkbenchCard} from '../../../api/client';
import type {Heat} from '../../heat';
import {Tag} from '../Tag/Tag';
import {visibleCardTags} from '../../status-map';
import type {CardTag} from '../../status-map';
import {formatListTime} from '../../format-time';
import {Avatar} from '../Avatar/Avatar';
import {BeijingTime} from '../Timeline/BeijingTime';
import {ClosureOriginalLink} from '../../../features/ticket-waiting/ClosureLinks';
import {PersonHoverTrigger} from '../HoverCard/HoverCard';
import {closureReasonText,externalTicketNumber} from './closure-presentation';
import './ticket-card.css';

export function TicketCard({className='',...props}:ComponentPropsWithRef<'article'>){
  return <article {...props} className={'ticket-card ds-ticket-card '+className}/>;
}
export function TicketCategoryTile({service}:{service:WorkbenchCard['service']}){
  const category=categoryOf(service?.category,service?.code),Icon=category.icon;
  return <span className="ds-ticket-category" data-category={service?.category??'unclassified'} title={category.label==='未分类'?'未分类':service?service.category_name_zh+' · '+service.name_zh:category.label} style={{background:category.bg,color:category.fg,border:category.border??undefined}}><Icon aria-hidden="true"/><span className="sr-only">{service?service.category_name_zh+' · '+service.name_zh:'未分类'}</span></span>;
}
export function TicketHeat({heat,heatStart}:{heat:Heat;heatStart?:string|null|undefined}){
  return <Tag className="ds-ticket-heat" data-heat-tone={heat.tone} title={heatStart?'自 '+heatStart.slice(5,16)+' 起计时':undefined} tone={heat.tone}><Clock3 aria-hidden="true"/>{heat.label}</Tag>;
}

function parseCssPx(value:string):number|null{
  const parsed=Number.parseFloat(value);
  return Number.isFinite(parsed)?parsed:null;
}

type FoldParams={availableWidth:number;tagWidths:readonly number[];hasBaseHidden:boolean;overflowWidth:number;gap:number;extraWidth:number;extraCount:number;minSingleTagWidth?:number};
/** Fold lowest-priority card tags into +N until the row fits; never leave a zero-width tag. */
export function computeFoldedTagCount({availableWidth,tagWidths,hasBaseHidden,overflowWidth,gap,extraWidth,extraCount,minSingleTagWidth=0}:FoldParams):number{
  const count=tagWidths.length;
  if(count<=1||availableWidth<=0)return 0;
  const limit=availableWidth+0.5;
  const totalFor=(keep:number)=>{
    let sum=extraWidth;
    for(let i=0;i<keep;i++)sum+=tagWidths[i]??0;
    const hasOverflow=hasBaseHidden||keep<count;
    if(hasOverflow)sum+=overflowWidth;
    const itemCount=keep+(hasOverflow?1:0)+extraCount;
    return sum+gap*Math.max(0,itemCount-1);
  };
  if(totalFor(count)<=limit)return 0;
  for(let keep=count-1;keep>=1;keep--)if(totalFor(keep)<=limit)return count-keep;
  const singleTagRoom=availableWidth-overflowWidth-extraWidth-gap*(1+extraCount);
  const requiredMin=Math.min(tagWidths[0]??0,minSingleTagWidth);
  if(requiredMin>0&&singleTagRoom+0.5<requiredMin)return count;
  return count-1;
}

/** Slice the lowest-priority shown tags from the tail into the hidden overflow group. */
export function applyCardTagFold(baseShown:readonly CardTag[],baseHidden:readonly CardTag[],foldedCount:number){
  const clamped=baseShown.length<=1?0:Math.max(0,Math.min(foldedCount,baseShown.length));
  const keep=baseShown.length-clamped;
  return {
    shown:baseShown.slice(0,keep),
    hidden:clamped>0?[...baseShown.slice(keep),...baseHidden]:[...baseHidden],
    foldedCount:clamped,
  };
}

type FooterProps={tags:readonly CardTag[];owner:ReactNode;hasOwnerName?:boolean;activity:ReactNode;followUp?:ReactNode;className?:string};
export function TicketCardFooter({tags,owner,hasOwnerName,activity,followUp,className=''}:FooterProps){
  const {shown:baseShown,hidden:baseHidden}=visibleCardTags(tags);
  const tagSignature=baseShown.map(tag=>`${tag.key}\0${tag.label}\0${tag.icon??''}`).join('\n');
  const [fontVersion,setFontVersion]=useState(0);
  const measureKey=`${tagSignature}#${fontVersion}`;
  const [state,setState]=useState<{key:string;foldedCount:number}>(()=>({key:measureKey,foldedCount:0}));
  const activeFolded=state.key===measureKey?state.foldedCount:0;
  const {shown,hidden,foldedCount}=applyCardTagFold(baseShown,baseHidden,activeFolded);
  const singleTag=shown.length===1;
  const canFold=baseShown.length>1;
  const baseShownCount=baseShown.length;
  const firstShownKey=baseShown[0]?.key??'';
  const hasBaseHidden=baseHidden.length>0;
  const hasFollowUp=Boolean(followUp);

  const tagsRef=useRef<HTMLDivElement>(null);
  const widthsRef=useRef<Map<string,number>>(new Map());
  const overflowWidthRef=useRef<number|null>(null);
  const estimatedOverflowRef=useRef<number>(0);
  const minSingleTagWidthRef=useRef<number>(0);
  const measuredKeyRef=useRef<string>(measureKey);
  const measureRef=useRef<()=>void>(()=>{});

  useLayoutEffect(()=>{
    const fonts=typeof document==='undefined'?undefined:document.fonts;
    if(!fonts)return;
    let cancelled=false,bumped=false;
    const onLoadingDone=()=>{bumped=true;if(!cancelled)setFontVersion(version=>version+1);};
    if(typeof fonts.addEventListener==='function')fonts.addEventListener('loadingdone',onLoadingDone);
    if(fonts.status==='loading')void fonts.ready.then(()=>{if(!cancelled&&!bumped)setFontVersion(version=>version+1);});
    return ()=>{
      cancelled=true;
      if(typeof fonts.removeEventListener==='function')fonts.removeEventListener('loadingdone',onLoadingDone);
    };
  },[]);

  useLayoutEffect(()=>{
    if(measuredKeyRef.current!==measureKey){
      widthsRef.current.clear();
      overflowWidthRef.current=null;
      estimatedOverflowRef.current=0;
      minSingleTagWidthRef.current=0;
      measuredKeyRef.current=measureKey;
    }
    const el=tagsRef.current;
    if(!el||!canFold){measureRef.current=()=>{};return;}
    const baseKeys=baseShown.map(tag=>tag.key);
    const measure=()=>{
      const availableWidth=el.clientWidth;
      if(availableWidth<=0)return;
      const style=getComputedStyle(el);
      const gap=parseCssPx(style.columnGap)??parseCssPx(style.gap)??0;
      let extraWidth=0,extraCount=0;
      for(const child of el.children){
        if(child.getAttribute('data-card-tag-overflow')==='true'){
          const width=child.getBoundingClientRect().width;
          if(width>0)overflowWidthRef.current=overflowWidthRef.current===null?width:Math.max(overflowWidthRef.current,width);
          continue;
        }
        const key=child.getAttribute('data-card-tag-key');
        if(key){
          if(key===firstShownKey){
            const tagStyle=getComputedStyle(child);
            const padX=(parseCssPx(tagStyle.paddingLeft)??0)+(parseCssPx(tagStyle.paddingRight)??0);
            const fontSize=parseCssPx(tagStyle.fontSize)??0;
            const svg=child.querySelector('svg');
            const svgWidth=svg?svg.getBoundingClientRect().width:0;
            const svgMargin=svg&&svgWidth>0?parseCssPx(getComputedStyle(svg).marginRight)??0:0;
            estimatedOverflowRef.current=padX+fontSize*1.25;
            minSingleTagWidthRef.current=padX+(svgWidth>0?svgWidth+svgMargin:0)+fontSize;
          }
          const rectWidth=child.getBoundingClientRect().width;
          if(!singleTag){widthsRef.current.set(key,rectWidth);continue;}
          const content=child.querySelector('.ds-tag-content');
          if(content&&content.scrollWidth>content.clientWidth){
            if(!widthsRef.current.has(key))widthsRef.current.set(key,rectWidth+(content.scrollWidth-content.clientWidth));
          }else widthsRef.current.set(key,rectWidth);
          continue;
        }
        const childStyle=getComputedStyle(child);
        const flexGrow=parseCssPx(childStyle.flexGrow)??0;
        const minW=parseCssPx(childStyle.minWidth)??0;
        extraWidth+=flexGrow>0?minW:child.getBoundingClientRect().width;
        extraCount+=1;
      }
      const tagWidths=baseKeys.map(key=>widthsRef.current.get(key)??0);
      if(tagWidths.some(width=>width<=0))return;
      const nextFolded=computeFoldedTagCount({
        availableWidth,
        tagWidths,
        hasBaseHidden,
        overflowWidth:overflowWidthRef.current??estimatedOverflowRef.current,
        gap,
        extraWidth,
        extraCount,
        minSingleTagWidth:minSingleTagWidthRef.current,
      });
      setState(prev=>(prev.key===measureKey&&prev.foldedCount===nextFolded?prev:{key:measureKey,foldedCount:nextFolded}));
    };
    measureRef.current=measure;
    measure();
  },[measureKey,canFold,baseShownCount,firstShownKey,hasBaseHidden,foldedCount,singleTag,hasFollowUp]);

  useLayoutEffect(()=>{
    const el=tagsRef.current;
    if(!el||!canFold||typeof ResizeObserver==='undefined')return;
    let lastWidth=Math.round(el.clientWidth);
    const observer=new ResizeObserver(()=>{
      const nextWidth=Math.round(el.clientWidth);
      if(nextWidth===lastWidth)return;
      lastWidth=nextWidth;
      measureRef.current();
    });
    observer.observe(el);
    return ()=>observer.disconnect();
  },[canFold]);

  return <footer className={'card-footer'+(className?' '+className:'')}><div ref={tagsRef} className="card-tags" data-folded-tag-count={foldedCount} data-single-tag={singleTag?'true':undefined}>{shown.map(tag=><Tag key={tag.key} tone={tag.tone} className={'status-chip '+(tag.className??'')} data-card-tag-key={tag.key} {...(tag.key==='supplement'?{'data-supplement-follow-up-pending':'true'}:{})} title={tag.title??tag.label}>{tag.icon==='bell'?<Bell aria-hidden="true"/>:tag.icon==='clock'?<Clock3 aria-hidden="true"/>:null}<span>{tag.label}</span></Tag>)}{hidden.length?<Tag data-card-tag-overflow="true" className={hidden.map(tag=>tag.className??'').join(' ')} {...(hidden.some(tag=>tag.key==='supplement')?{'data-supplement-follow-up-pending':'true'}:{})} title={hidden.map(tag=>tag.title??tag.label).join('；')} aria-label={'另有 '+hidden.length+' 项：'+hidden.map(tag=>tag.label).join('、')}>+{hidden.length}</Tag>:null}{followUp}</div><span className="ds-ticket-owner" data-has-owner-name={hasOwnerName?'true':undefined}>{owner}</span>{activity}</footer>;
}
type BodyProps={number:string;title:string;metadata:ReactNode;tags:readonly CardTag[];owner:ReactNode;hasOwnerName?:boolean;activity:ReactNode;followUp?:ReactNode;deadline?:{tone:'attention'|'danger';label:string};category?:ReactNode;heat?:Heat|null;heatStart?:string|null;completedAt?:string|null};
export function TicketCardBody({number,title,metadata,tags,owner,hasOwnerName,activity,followUp,deadline,category,heat,heatStart,completedAt}:BodyProps){
  return <div className={'ds-ticket-body'+(category?' has-category':'')}>
    <div className="card-top"><span title={number}>{number}</span>{completedAt?<time className="ds-ticket-completed" dateTime={completedAt.replace(' ','T')+'+08:00'} title={completedAt+'（北京时间）'}><Check aria-hidden="true"/>{completedAt.slice(11,16)} 完成</time>:heat?<TicketHeat heat={heat} heatStart={heatStart}/>:deadline?<span className="ds-ticket-deadline" data-tone={deadline.tone}><Clock3 aria-hidden="true"/>{deadline.label}</span>:null}{category}</div>
    <h3 title={title}>{title||'待补充的问题描述'}</h3>
    <div className="ds-ticket-metadata">{metadata}</div>
    <TicketCardFooter tags={tags} owner={owner} {...(hasOwnerName===undefined?{}:{hasOwnerName})} activity={activity} followUp={followUp}/>
  </div>;
}

export function ClosureReason({closure}:{closure:WorkbenchCard['closure']}){
  if(!closure)return null;
  const original=externalTicketNumber(closure.duplicate_of?.display_no);
  const label=closure.reason_code==='DUPLICATE'&&original?'重复':closureReasonText(closure);
  return <Tag className="ds-ticket-closure-reason" data-closure-reason title={label+(original?' · '+original:'')}>
    <span className="ds-closure-reason-label">{label}</span>{original?<><span aria-hidden="true" className="ds-closure-reason-separator"> · </span><ClosureOriginalLink number={original}/></>:null}
  </Tag>;
}

export function DismissedTicketCardBody({item,now,followUp,badge,titleLink}:{item:WorkbenchCard;now:number;metadata:ReactNode;followUp?:ReactNode;badge?:ReactNode;titleLink?:ReactNode}){
  const closure=item.closure;
  if(closure?.kind!=='DISMISSED')return null;
  const name=closure.ended_by_display_name;
  return <div className="ds-ticket-body ds-ticket-dismissed-body has-category">
    <div className="card-top"><span title={item.number}>{item.number}</span><span className="activity-time ds-ticket-dismissed-at" title={closure.ended_at?closure.ended_at+'（北京时间）':'关闭时间未记录'}><CircleX aria-hidden="true"/>{closure.ended_at?<time dateTime={closure.ended_at.replace(' ','T')+'+08:00'}>{formatListTime(closure.ended_at,now)} 关闭</time>:<span>时间未记录 关闭</span>}</span><TicketCategoryTile service={item.service}/></div>
    <h3 title={item.title}>{titleLink??(item.title||'待补充的问题描述')}</h3>
    <footer className="card-footer"><div className="card-tags"><ClosureReason closure={closure}/>{followUp}{badge}</div><span className="ds-ticket-owner ds-ticket-closer" data-closure-source={closure.source??'unknown'}>
      {closure.source==='SYSTEM'?<><Avatar size={20} systemIcon={<Bot aria-hidden="true"/>} aria-hidden="true"/><span className="ds-ticket-close-method">系统判定</span></>:closure.source==='MANUAL'?<>{name?<><Avatar name={name} size={20} aria-hidden="true"/><span className="owner-name" title={name}>{name}</span><span aria-hidden="true"> · </span></>:null}<span className="ds-ticket-close-method">人工关闭</span></>:name?<span className="owner-name" title={name}>{name}</span>:null}
    </span></footer>
  </div>;
}

export interface ClosureRecordEntry {source:'MANUAL'|'SYSTEM'|null;reason_code:string|null;reason_label:string|null;secondary_reason:{code:string;label:string}|null;note:string|null;duplicate_of:{display_no:string}|null;ended_at:string|null;ended_by_display_name:string|null;notification_state?:'SENT'|'UNKNOWN'|'NOT_SENT';restored_at?:string|null;restored_by_display_name?:string|null;restore_source?:'MANUAL'|'SYSTEM'|null}
/** Reason tag + 「原单 IT-…」 link, shared by the closure record and (Card 32 B6) the closing line of the activity timeline. */
export function ClosureFacts({closure}:{closure:Pick<ClosureRecordEntry,'reason_code'|'reason_label'|'secondary_reason'|'duplicate_of'>}){
  const original=externalTicketNumber(closure.duplicate_of?.display_no);
  return <><Tag className="ds-closure-entry-reason">{closureReasonText(closure)}</Tag>
    {original?<span className="ds-closure-entry-original"><span>原单</span><ClosureOriginalLink number={original}/></span>:null}</>;
}
/** Card 29 D3: one compact closure entry; empty values are omitted instead of shown as placeholders. */
export function ClosureRecord({entry,now}:{entry:ClosureRecordEntry;now?:number}){
  const name=entry.ended_by_display_name;
  return <div className="ds-closure-entry" data-closure-record="true">
    <div className="ds-closure-entry-head">{entry.source==='SYSTEM'?<Avatar size={20} systemIcon={<Bot aria-hidden="true"/>} aria-hidden="true"/>:name?<Avatar name={name} size={20} aria-hidden="true"/>:null}
      {name?entry.source==='SYSTEM'?<strong className="ds-closure-entry-name">{name}</strong>:<PersonHoverTrigger name={name}><strong className="ds-closure-entry-name">{name}</strong></PersonHoverTrigger>:null}<span className="ds-closure-entry-method">{entry.source==='SYSTEM'?'系统判定':'人工关闭'}{entry.ended_at?<> · <BeijingTime value={entry.ended_at} {...(now===undefined?{}:{now})}/></>:null}</span></div>
    <div className="ds-closure-entry-facts"><ClosureFacts closure={entry}/>
      {entry.notification_state==='SENT'?<span className="ds-closure-entry-notified">已通知报修人</span>:null}</div>
    {entry.note?<p className="ds-closure-entry-note">说明：{entry.note}</p>:null}
    {entry.restored_at?<p className="ds-closure-restored-event" data-closure-restored-event><Undo2 aria-hidden="true"/>{entry.restore_source==='SYSTEM'?null:entry.restored_by_display_name?<PersonHoverTrigger name={entry.restored_by_display_name}><strong>{entry.restored_by_display_name}</strong></PersonHoverTrigger>:null}<span>{entry.restore_source==='SYSTEM'?'系统自动恢复（报修人补充后）':'恢复'} · <BeijingTime value={entry.restored_at} {...(now===undefined?{}:{now})}/></span></p>:null}
  </div>;
}

/** Native radios; a nested group (Card 29 K1) renders directly beneath its parent option. */
export function ClosureReasonOptions({options,value,isDisabled,onChange,label='关闭原因',nested}:{options:readonly {value:string;label:string;hint?:string}[];value:string;isDisabled:boolean;onChange:(value:string)=>void;label?:string;nested?:{after:string;content:ReactNode}|undefined}){
  const name=useId();
  return <fieldset className="ds-closure-reason-options" disabled={isDisabled} aria-label={label}><legend className="sr-only">{label}</legend>{options.map(option=><Fragment key={option.value}><label className="ds-closure-reason-option">
    <input className="sr-only" type="radio" name={name} value={option.value} checked={value===option.value} onChange={event=>onChange(event.currentTarget.value)}/><span className="ds-closure-reason-indicator" aria-hidden="true"/><span className="ds-closure-reason-text">{option.label}</span>{option.hint?<span className="ds-closure-reason-hint"> · {option.hint}</span>:null}
  </label>{nested?.after===option.value?nested.content:null}</Fragment>)}</fieldset>;
}
