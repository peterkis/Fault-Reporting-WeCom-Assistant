import '../../app/pc-admin/src/design/fonts.css';
import '../../app/pc-admin/src/design/foundation.css';
import '../../app/pc-admin/src/design/motion/controls.css';
import '../../app/pc-admin/src/app/heroui-workbench.css';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {api,type Principal} from '../../app/pc-admin/src/api/client';
import {WorkbenchLink} from '../../app/pc-admin/src/app/WorkbenchLink';
import {Button} from '../../app/pc-admin/src/design/components/Button/Button';
import {Modal} from '../../app/pc-admin/src/design/components/Modal/Modal';
import {HoverCard} from '../../app/pc-admin/src/design/components/HoverCard/HoverCard';
import {HoverCardsProvider,PersonHoverCard} from '../../app/pc-admin/src/features/hover-cards/PersonHoverCard';
import {TicketHoverCard} from '../../app/pc-admin/src/features/hover-cards/TicketHoverCard';
import {ClosureOriginalLink} from '../../app/pc-admin/src/features/ticket-waiting/ClosureLinks';

const peer='周宁（合成）';
function ActionTrigger({id}:{id:string}){
  return <HoverCard kind="person" width={300} renderContent={({titleId,close})=><>
    <strong id={titleId}>{peer}</strong><Button onPress={close}>关闭</Button>
  </>}>
    <Button id={id}>{peer}</Button>
  </HoverCard>;
}
function Scene({principal}:{principal:Principal}){
  const [modal,setModal]=useState(false);
  const params=new URLSearchParams(location.search),id=params.get('ticket'),number=params.get('number');
  return <HoverCardsProvider principal={principal}><main style={{padding:72}}>
    <div style={{display:'flex',gap:12}}>
      <ActionTrigger id="first"/><ActionTrigger id="neighbor"/>
      <PersonHoverCard name={peer}><Button id="peer">{peer}</Button></PersonHoverCard>
      <Button id="open-modal" onPress={()=>setModal(true)}>打开弹窗（合成）</Button>
    </div>
    {id&&number?<p><TicketHoverCard itemKind="ticket" itemId={id} number={number}>
      <WorkbenchLink id="ticket" to={'/items/ticket/'+id}>查看关联事项 {number}</WorkbenchLink>
    </TicketHoverCard> <ClosureOriginalLink number={number}/></p>:null}
    <Modal.Backdrop isOpen={modal} onOpenChange={setModal}><Modal.Container><Modal.Dialog aria-label="处理人（合成）">
      <Modal.Heading>处理人（合成）</Modal.Heading>
      <Button onPress={()=>setModal(false)}>取消</Button>
      <PersonHoverCard name={peer}><Button id="modal-peer">{peer}</Button></PersonHoverCard>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </main></HoverCardsProvider>;
}
async function start(){
  const root=document.getElementById('root');if(!root)throw Error('Missing fixture root');
  const principal=await api.bootstrap(new AbortController().signal);
  createRoot(root).render(<BrowserRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}>
    <Scene principal={principal}/>
  </QueryClientProvider></BrowserRouter>);
}
void start();
