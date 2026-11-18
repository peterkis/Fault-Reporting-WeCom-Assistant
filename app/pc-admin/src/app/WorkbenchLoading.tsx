import {BoardColumnSkeleton} from '../design/components/Skeleton/Skeleton';

export function WorkbenchLoading({slow=false,onRetry}:{slow?:boolean;onRetry?:()=>void}){
  return <div className="workbench-startup" data-startup>
    <div className="startup-heading"><strong>医小修 · 工作台</strong></div>
    <div className="startup-columns"><BoardColumnSkeleton column="pending" label="待受理" slow={slow} {...(onRetry?{onRetry}:{})}/><BoardColumnSkeleton column="active" label="处理中"/><BoardColumnSkeleton column="handled" label="已处理"/></div>
  </div>;
}
