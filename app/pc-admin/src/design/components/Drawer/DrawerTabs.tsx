import {Button} from '../Button/Button';
import {SegmentedControl} from '../SegmentedControl/SegmentedControl';

export function DrawerTabs({value,onChange,attachments,conversations}:{value:string;onChange:(value:string)=>void;attachments:number|null;conversations:number|null}){
  const tabs=[{id:'activity',label:'动态'},{id:'attachments',label:'附件'+(attachments===null?'':' '+attachments)},{id:'conversations',label:'会话'+(conversations===null?'':' '+conversations)}];
  return <SegmentedControl className="ds-detail-tabs" role="tablist" aria-label="事项内容">
    {tabs.map((tab,index)=><Button key={tab.id} id={'detail-tab-trigger-'+tab.id} role="tab" aria-selected={value===tab.id} aria-controls={'detail-tab-'+tab.id} tabIndex={value===tab.id?0:-1} tone="ghost" onPress={()=>onChange(tab.id)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
      if(next===null)return;event.preventDefault();const tab=tabs[next];if(tab){onChange(tab.id);document.getElementById('detail-tab-trigger-'+tab.id)?.focus();}
    }}>{tab.label}</Button>)}
  </SegmentedControl>;
}
