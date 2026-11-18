import '../../app/pc-admin/src/design/fonts.css';
import '../../app/pc-admin/src/design/foundation.css';
import '../../app/pc-admin/src/design/motion/controls.css';
import '../../app/pc-admin/src/design/components/TicketCard/ticket-card.css';
import '../../app/pc-admin/src/design/components/Drawer/detail-content.css';
import '../../app/pc-admin/src/design/shell.css';
import '../../app/pc-admin/src/app/heroui-workbench.css';
import './motion-app.css';
import {useLayoutEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Dropdown,Label} from '@heroui/react';
import {Button} from '../../app/pc-admin/src/design/components/Button/Button';
import {SegmentedControl} from '../../app/pc-admin/src/design/components/SegmentedControl/SegmentedControl';
import {Collapse,CollapseChevron} from '../../app/pc-admin/src/design/components/Collapse/Collapse';
import {CollapsibleSection} from '../../app/pc-admin/src/design/components/Section/Section';
import {BoardGroup} from '../../app/pc-admin/src/design/components/BoardColumn/BoardColumn';
import {Modal} from '../../app/pc-admin/src/design/components/Modal/Modal';
import {Tooltip} from '../../app/pc-admin/src/design/components/Tooltip/Tooltip';
import {DrawerMoreActions} from '../../app/pc-admin/src/design/components/Drawer/Drawer';
import {PresenceTags} from '../../app/pc-admin/src/design/components/PresenceTags/PresenceTags';
import {OnlineColleaguesView} from '../../app/pc-admin/src/design/components/OnlineColleagues/OnlineColleagues';
import {ClosureSearchField} from '../../app/pc-admin/src/design/components/TicketCard/ClosureDialog';
import {NumberRoll} from '../../app/pc-admin/src/design/motion/number-roll';
import {flip} from '../../app/pc-admin/src/design/motion/flip';
import {highlight} from '../../app/pc-admin/src/design/motion/highlight';
import {motionToken,prefersReducedMotion} from '../../app/pc-admin/src/design/motion/tokens';
import {useExitPresence} from '../../app/pc-admin/src/design/motion/presence';
import {installMotionDebug} from '../../app/pc-admin/src/design/motion/debug';

declare global {interface Window {motionFixture:{flip:typeof flip;highlight:typeof highlight;motionToken:typeof motionToken;prefersReducedMotion:typeof prefersReducedMotion;setNumber:(value:number)=>void;setRolling:(value:boolean)=>void;setPresent:(value:boolean)=>void}}}
installMotionDebug();
function MotionFixture(){
  const [tab,setTab]=useState(0),[expanded,setExpanded]=useState(false),[modal,setModal]=useState(false),[number,setNumber]=useState(10),[rolling,setRolling]=useState(true),[present,setPresent]=useState(true),[query,setQuery]=useState('');
  const retained=useExitPresence(present,'--dur-fast');
  useLayoutEffect(()=>{window.motionFixture={flip,highlight,motionToken,prefersReducedMotion,setNumber,setRolling,setPresent};},[]);
  return <main className="motion-fixture"><h1>动效检查（合成）</h1>
    <section id="control-examples"><Button id="press">领取（合成）</Button><SegmentedControl aria-label="展示方式（合成）"><Button aria-pressed={tab===0} onPress={()=>setTab(0)}>看板</Button><Button aria-pressed={tab===1} onPress={()=>setTab(1)}>列表</Button></SegmentedControl>
      <div className="collapse-example"><Button id="collapse-trigger" data-action="expand-column" aria-expanded={expanded} onPress={()=>setExpanded(value=>!value)}><CollapseChevron expanded={expanded}/>显示剩余 3 项</Button>
      <Collapse expanded={expanded} id="collapse"><div className="motion-rows"><p>报修一（合成）</p><p>报修二（合成）</p><p>报修三（合成）</p></div></Collapse><p id="below-collapse">下一组（合成）</p></div>
      <CollapsibleSection title="可折叠区块（合成）"><p>折叠内容（合成）</p></CollapsibleSection>
      <div id="hero-group"><BoardGroup label="原生分组（合成）" count={1}><p>分组内容（合成）</p></BoardGroup></div>
      <Dropdown><Dropdown.Trigger id="menu-trigger">更多（合成）</Dropdown.Trigger><Dropdown.Popover className="motion-menu"><Dropdown.Menu aria-label="操作（合成）"><Dropdown.Item id="copy"><Label>复制工单链接</Label></Dropdown.Item><Dropdown.Item id="close"><Label>关闭事项…</Label></Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown>
      <DrawerMoreActions><Button tone="ghost">复制工单链接</Button></DrawerMoreActions>
      <Button id="modal-trigger" onPress={()=>setModal(true)}>打开弹窗（合成）</Button>
      <Modal.Backdrop isOpen={modal} onOpenChange={setModal}><Modal.Container><Modal.Dialog aria-label="弹窗（合成）"><header><Modal.Heading>关闭事项（合成）</Modal.Heading></header><p>用于检查进入、退出与焦点恢复。</p><Button onPress={()=>setModal(false)}>取消</Button></Modal.Dialog></Modal.Container></Modal.Backdrop>
      <article id="hover-card" className="ds-ticket-card ticket-card">工单卡片（合成）</article>
      <div className="motion-tooltips"><Button isDisabled disabledReason="暂时只能查看（合成）">不可用一</Button><Button isDisabled disabledReason="请先核对结果（合成）">不可用二</Button><Tooltip><Tooltip.Trigger id="hero-tooltip">附件提示（合成）</Tooltip.Trigger><Tooltip.Content>附件暂不可用（合成）</Tooltip.Content></Tooltip></div>
      <PresenceTags people={[{display_name:'周宁（合成）',mode:'VIEWING',field:null,expires_epoch_ms:String(Date.now()+60_000)}]}/>
      <OnlineColleaguesView collapsed={false} view={{schema_version:1,total:1,people:[{display_name:'周宁（合成）',status:'ONLINE'}]}}/>
      <ClosureSearchField query={query} selected={null} items={[{id:'synthetic-original',number:'IT-0001',title:'关联原单（合成）',service:null,column:'pending'}]} busy={false} disabled={false} message="" onQuery={setQuery} onSelect={()=>setQuery('')}/>
    </section>
    <section id="tool-examples"><span id="number"><NumberRoll value={number} animate={rolling}/></span>{retained?<span id="retained">保留内容（合成）</span>:null}<div id="highlight">高亮目标（合成）</div>{Array.from({length:7},(_,index)=><div className="flip-target" id={'flip-'+index} key={index}>位移（合成）</div>)}</section>
  </main>;
}
const root=document.getElementById('root');if(!root)throw Error('FIXTURE_ROOT_MISSING');createRoot(root).render(<MotionFixture/>);
