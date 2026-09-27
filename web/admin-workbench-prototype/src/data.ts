export type Stage = 'pending' | 'active' | 'closed';
export type Ticket = {id:string; title:string; description:string; location:string; reporter:string; category:string; source:string; stage:Stage; status:string; owner:string; communicator:string; age:number; unread:number; followup:boolean;followAt?:string; watched:boolean; presence:string; version:number; closedAt?:number; history:string[]; messages:{text:string; internal:boolean; by:string}[]};
export const people=['林舟','陈悦','周宁','沈然'];
export const me=people[0];
export const stageNames:Record<Stage,string>={pending:'待受理',active:'处理中',closed:'已关闭'};
const rows=[
 ['门诊二楼打印机无法打印处方','门诊二楼 · 203 诊室','赵医生','终端设备','群聊报修','pending','待复核','',42,1],
 ['护士站登录护理系统提示连接超时','住院部 · 六楼护士站','孙护士','业务系统','医小修','pending','待接单','',28,0],
 ['自助机读卡失败，患者无法签到','门诊大厅 · 03 号自助机','吴老师','终端设备','电话代录','pending','重新报障','陈悦',19,1],
 ['检验报告查询页面显示空白','检验科 · 报告窗口','李老师','业务系统','Bot 私聊','pending','已领取','周宁',12,0],
 ['手术排班屏幕无法同步最新安排','手术室 · 示教区','钱护士','显示设备','医小修','pending','待接单','',7,0],
 ['住院部西区无线网络频繁断开','住院部 · 西区五楼','王护士','网络通信','群聊报修','active','处理中','林舟',86,2],
 ['PACS 调阅影像时加载缓慢','影像科 · 阅片室','郑医生','业务系统','Bot 私聊','active','等待厂商','陈悦',124,0],
 ['收费窗口票据打印位置偏移','门诊一楼 · 收费 02 窗口','冯老师','终端设备','电话代录','active','等待补充','周宁',56,0],
 ['心电图工作站无法上传检查结果','医技楼 · 心电图室','蒋医生','业务系统','医小修','active','处理中','林舟',34,0],
 ['门诊诊室键盘更换','门诊三楼 · 301 诊室','韩医生','终端设备','医小修','closed','已关闭','沈然',15,0],
 ['病区移动查房车无法充电','住院部 · 七楼','杨护士','终端设备','Bot 私聊','closed','已关闭','林舟',40,0],
 ['恢复药房标签打印服务','药房 · 配药区','许老师','业务系统','群聊报修','closed','已关闭','陈悦',68,0],
 ['影像诊断室显示器亮度异常','影像科 · 诊断室','何医生','显示设备','医小修','closed','已解决待确认','周宁',90,0],
] as const;
export function seed():Ticket[]{return rows.map((r,i)=>({id:`WX-${String(2381+i)}`,title:r[0],description:`${r[0]}。已尝试重新打开相关设备或页面，问题仍然存在，请协助排查。此内容为视觉原型的合成报修材料，不包含真实人员或医院业务数据。`,location:r[1],reporter:r[2],category:r[3],source:r[4],stage:r[5],status:r[6],owner:r[7],communicator:r[4].includes('Bot')||r[4].includes('群')?r[7]:'',age:r[8],unread:r[9],followup:i===6,followAt:i===6?'14:30':undefined,watched:i===2,presence:i===0?'陈悦正在查看':i===5?'周宁正在编辑':'',version:1,closedAt:r[5]==='closed'?Date.now()-(i-9)*4*3600000:undefined,history:[`09:10 · ${r[2]}提交报修`,...(r[7]?[`09:18 · ${r[7]}首次接单`]:[])],messages:[{text:`${r[0]}，请协助处理。`,internal:false,by:r[2]},...(r[9]?[{text:'补充：旁边同事也遇到了相同情况，请帮忙一起看看。',internal:false,by:r[2]}]:[])]}));}
