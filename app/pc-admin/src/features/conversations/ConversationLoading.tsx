import {LoadingStatus,Skeleton} from '../../design/components/Skeleton/Skeleton';

/** The same row boxes, avatar size, text lines and spacing as the contact list. */
export function ConversationRowsLoading({label,slow,onRetry}:{label:string;slow:boolean;onRetry:()=>void}){
  return <LoadingStatus label={label} slow={slow} onRetry={onRetry}><div className="inbox-contact-rows">{[0,1,2,3,4].map(index=><article key={index} className="ds-conversation-list-item" aria-hidden="true">
    <Skeleton className="ds-avatar" w="var(--avatar-lg)" h="var(--avatar-lg)" r="var(--radius-full)"/>
    <a tabIndex={-1}><div className="inbox-contact-title"><strong><Skeleton w="60%" h="var(--lh-md)"/></strong></div><p className="inbox-contact-preview"><Skeleton w="85%" h="var(--lh-sm)"/></p><div className="inbox-contact-bottom"><Skeleton w="35%" h="var(--lh-xs)"/></div></a>
  </article>)}</div></LoadingStatus>;
}
