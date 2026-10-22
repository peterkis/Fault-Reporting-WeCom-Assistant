import i18n from '../i18n';
import {en as compiledEn,zh as compiledZh} from 'virtual:yxx-i18n/auth';

export const en={
 app:'Yixiaoxiu',
 externalTitle:'Please open in WeCom',
 externalText:'Open Yixiaoxiu from your WeCom workplace or a ticket message so we can securely confirm your work account.',
 reconnectingTitle:'Connecting you back',
 reconnectingText:'Checking your access securely through WeCom. You’ll return to this page.',
 reconnectTitle:'Let’s reconnect',
 reconnectText:'We couldn’t restore your connection automatically. Reconnect through WeCom to continue here.',
 accessTitle:'This space needs access',
 accessText:'Your current account doesn’t have access to this service. Please contact your IT team if you need help.',
 reconnectProtected:'Reconnecting leaves this page. Unsubmitted content and operations awaiting confirmation will not be sent again automatically.',
 reconnectConfirm:'Leave this page and reconnect',
 reconnectAction:'Reconnect with WeCom',
 reconnectingAction:'Connecting…',
 reconnectFootnote:'Your submitted tickets stay safely recorded.',
};
export const zh={
 app:'医小修',
 externalTitle:'请在企业微信中打开',
 externalText:'请返回企业微信，从工作台或工单消息中打开医小修，以便安全核验你的工作身份。',
 reconnectingTitle:'正在接回这段连接',
 reconnectingText:'正在通过企业微信安全核验，完成后回到当前页面。',
 reconnectTitle:'连接歇了一会儿',
 reconnectText:'暂时未能自动恢复连接。通过企业微信重新连接，即可继续访问当前页面。',
 accessTitle:'这里需要一把通行钥匙',
 accessText:'当前账号暂没有此项服务的访问权限。如需协助，请联系院内 IT 团队。',
 reconnectProtected:'重新连接将离开此页。未提交内容和待确认操作不会自动再次发送，请先记录需要保留或核对的事项。',
 reconnectConfirm:'确认离开并重新连接',
 reconnectAction:'通过企业微信重新连接',
 reconnectingAction:'正在连接…',
 reconnectFootnote:'已经提交的报修仍会保留。',
} satisfies Record<keyof typeof en,string>;
i18n.addResourceBundle('en','auth',compiledEn);
i18n.addResourceBundle('zh-CN','auth',compiledZh);
