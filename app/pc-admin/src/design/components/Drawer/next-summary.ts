import type {WorkbenchCard} from '../../../api/client';

/** Viewer copy only; original command owners continue to admit and label actions. */
export function nextSummary(item:WorkbenchCard,heatLabel:string|undefined,isAssignee:boolean,allowedActions:readonly string[]=[]):string{
  const name=isAssignee?'你':item.assignee_name??'处理人';
  const summaries:Record<string,string>={
    NEW:(heatLabel?'已等待 '+heatLabel.replace('超时 ','')+'，':'')+'尚无人领取',
    QUEUED:(heatLabel?'已等待 '+heatLabel.replace('超时 ','')+'，':'')+'尚无人领取',
    ACCEPTED:name+'已领取，尚未开始',
    IN_PROGRESS:name+(isAssignee?'正在处理 · 故障排除后登记完工':'正在处理'+(allowedActions.some(action=>action==='takeover'||action==='takeover-and-start')?' · 需要时可接管':'')),
    WAITING_REQUESTER:'等待报修人补充'+(heatLabel?' · 已等待 '+heatLabel.replace('超时 ',''):''),
    WAITING_VENDOR:'等待厂商回复'+(heatLabel?' · 已等待 '+heatLabel.replace('超时 ',''):''),
    RESOLVED:'已解决，等待报修人确认',
    CLOSED:'工单已关闭 · 同一故障仍未解决时可重新打开',
    CANCELLED:'工单已关闭 · 请查看关闭记录',
    REOPENED:'同一故障仍未解决 · 请重新领取',
    PENDING:'规则无法判断 · 需要人工复核',
    RECEIVED:'报修已受理 · 等待建立工单',
    WAITING_TRIAGE:'报修待判断 · 请核对报修材料',
    WAITING_DESCRIPTION:'等待补充报修描述',
    DUPLICATE_LINKED:'已关联已有工单 · 请查看关联处理进展',
    FAILED:'受理处理失败 · 请核对报修材料',
  };
  return summaries[item.status]??'请核对报修材料，确认下一步';
}
