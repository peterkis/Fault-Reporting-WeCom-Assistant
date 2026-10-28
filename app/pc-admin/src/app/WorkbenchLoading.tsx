import {Skeleton} from '@heroui/react/skeleton';

export function BoardColumnLoading(){
  return <div className="startup-column" role="status" aria-label="正在读取事项">
    <div aria-hidden="true"><Skeleton className="startup-line" animationType="pulse"/><Skeleton className="startup-card" animationType="pulse"/><Skeleton className="startup-line startup-short" animationType="pulse"/></div>
  </div>;
}

export function WorkbenchLoading(){
  return <div className="workbench-startup" data-startup role="status" aria-label="正在打开工作台" aria-busy="true">
    <div className="startup-heading"><strong>医小修 · 工作台</strong><p>正在打开工作台…</p></div>
    <div className="startup-columns" aria-hidden="true"><BoardColumnLoading/><BoardColumnLoading/><BoardColumnLoading/></div>
  </div>;
}
