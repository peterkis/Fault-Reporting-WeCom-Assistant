import {useEffect,useId,useRef,useState} from 'react';
import {Users} from 'lucide-react';
import type {WorkbenchOnlineStatus,WorkbenchOnlineView} from '../../../../../../contracts/workbench_activity_contracts';
import {Avatar} from '../Avatar/Avatar';
import {PresenceStack} from '../PresenceStack/PresenceStack';
import {withPresentationKeys} from '../../presentation-keys';
import {NumberRoll} from '../../motion/number-roll';
import './online-colleagues.css';
import {PersonHoverTrigger} from '../HoverCard/HoverCard';
import {usePopoverPresence} from '../Popover/usePopoverPresence';

const statusLabels:Readonly<Record<WorkbenchOnlineStatus,string>>={EDITING:'正在编辑',VIEWING:'正在查看工单',ONLINE:'在线'};

/** Card 31 F1/F2: sidebar 「在线同事」 row, popover and collapsed badge. Presentation only; the caller supplies the view. */
export function OnlineColleaguesView({view,collapsed}:{view:WorkbenchOnlineView;collapsed:boolean}){
  const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),root=useRef<HTMLDivElement>(null),panelId=useId();
  const total=view.total;
  const panel=usePopoverPresence(open);
  useEffect(()=>{
    if(!open)return;
    const livePanelHoverCards=():HTMLElement[]=>{
      const activeTrigger=root.current?.querySelector<HTMLElement>('[data-hover-card-trigger][aria-expanded="true"]');
      const cardId=activeTrigger?.getAttribute('aria-controls');
      const card=cardId?document.getElementById(cardId):null;
      if(!card||card.hasAttribute('data-exiting'))return [];
      const nestedTrigger=card.querySelector<HTMLElement>('[data-hover-card-trigger][aria-expanded="true"]');
      const nestedId=nestedTrigger?.getAttribute('aria-controls');
      const nestedCard=nestedId?document.getElementById(nestedId):null;
      return nestedCard&&!nestedCard.hasAttribute('data-exiting')?[card,nestedCard]:[card];
    };
    const away=(event:PointerEvent)=>{
      const cards=livePanelHoverCards();
      if(event.target instanceof Node&&cards.some(card=>card.contains(event.target as Node)))return;
      if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);
    };
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&livePanelHoverCards().length===0){event.preventDefault();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',away);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',escape);};
  },[open]);
  useEffect(()=>{if(!total)setOpen(false);},[total]);
  const label='在线同事 '+total+' 人';
  if(collapsed)return <div className="ds-online-colleagues is-collapsed" data-online-colleagues><span className="ds-online-collapsed" title={label} aria-label={label} role="img"><Users aria-hidden="true"/>{total?<span className="ds-online-badge"><NumberRoll value={total}/></span>:null}</span></div>;
  if(!total)return <div className="ds-online-colleagues" data-online-colleagues><div className="ds-online-row is-empty"><span className="ds-online-title">在线同事</span><span className="ds-online-none">暂无</span></div></div>;
  return <div className="ds-online-colleagues" data-online-colleagues ref={root}>
    <button ref={trigger} type="button" className="ds-online-row" aria-label={label} aria-expanded={open} aria-controls={panelId} data-action="open-online-colleagues" onClick={()=>setOpen(value=>!value)}>
      <span className="ds-online-title">在线同事</span><PresenceStack names={view.people.map(person=>person.display_name)} max={3} total={total}/><span className="ds-online-count"><NumberRoll value={total}/></span>
    </button>
    {panel.present?<div {...panel.attributes} className="ds-online-panel" id={panelId} role="dialog" aria-label={'在线同事 · '+total}>
      <p className="ds-online-panel-title">在线同事 · {total}</p>
      <ul className="ds-online-list">{withPresentationKeys(view.people).map(({key,item:person})=><PersonHoverTrigger key={key} name={person.display_name}><li className="ds-online-person"><Avatar name={person.display_name} size={24} className="ds-online-avatar" aria-hidden="true"/><span className="ds-online-name">{person.display_name}</span><span className="ds-online-status" data-status={person.status}>{statusLabels[person.status]}</span></li></PersonHoverTrigger>)}</ul>
      {total>view.people.length?<p className="ds-online-more">另有 {total-view.people.length} 人在线</p>:null}
      <p className="ds-online-note">只显示同团队、当前打开工作台的同事</p>
    </div>:null}
  </div>;
}
