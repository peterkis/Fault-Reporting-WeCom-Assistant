import {Pencil} from 'lucide-react';
import type {WorkbenchActivityField,WorkbenchActivityPerson} from '../../../../../../contracts/workbench_activity_contracts';
import {Avatar} from '../Avatar/Avatar';
import {withPresentationKeys} from '../../presentation-keys';
import './presence-tags.css';

export const presenceFieldLabels:Readonly<Record<WorkbenchActivityField,string>>={'internal-note':'内部备注','ticket-handling':'处理记录','ticket-completion':'完成记录','manual-review':'人工复核'};
/** 「周宁正在编辑内部备注」/「沈然正在查看」. */
export function presenceAction(person:WorkbenchActivityPerson){return person.mode==='EDITING'?'正在编辑'+(person.field?presenceFieldLabels[person.field]:''):'正在查看';}
export function presenceDescription(people:readonly WorkbenchActivityPerson[]){return people.map(person=>person.display_name+presenceAction(person)).join('、');}
/** Names longer than four characters show their first three and an ellipsis; the full name stays in the tooltip and label. */
export function shortPresenceName(name:string){const characters=Array.from(name);return characters.length>4?characters.slice(0,3).join('')+'…':name;}
export const presenceTone=(people:readonly WorkbenchActivityPerson[])=>people[0]?.mode==='EDITING'?'editing':people.length?'viewing':undefined;

/**
 * Card 30B B1 (prototype 01f V3, corner name tags). People arrive editors first. One or two people show a tag each;
 * three or more show the first tag plus a dark 「+N」. Hovering for 300ms shows every person with their action.
 */
export function PresenceTags({people,className=''}:{people:readonly WorkbenchActivityPerson[];className?:string}){
  if(!people.length)return null;
  const shown=people.length<=2?people:people.slice(0,1),rest=people.length-shown.length,description=presenceDescription(people),listed=people.slice(0,8);
  return <span className={'ds-presence-tags '+className} role="img" aria-label={description} data-presence-count={people.length}>
    {withPresentationKeys(shown).map(({key,item:person})=><span key={key} className="ds-presence-tag" data-mode={person.mode==='EDITING'?'editing':'viewing'} aria-hidden="true">{person.mode==='EDITING'?<Pencil aria-hidden="true"/>:null}{shortPresenceName(person.display_name)}</span>)}
    {rest>0?<span className="ds-presence-tag" data-mode="more" aria-hidden="true">+{rest}</span>:null}
    <span className="ds-presence-tooltip" aria-hidden="true">{withPresentationKeys(listed).map(({key,item:person})=><span key={key} className="ds-presence-tooltip-row"><Avatar name={person.display_name} size={20} className="ds-presence-tooltip-avatar" aria-hidden="true"/><strong>{person.display_name}</strong><span>{presenceAction(person)}</span></span>)}{people.length>listed.length?<span className="ds-presence-tooltip-more">另有 {people.length-listed.length} 人</span>:null}</span>
  </span>;
}
