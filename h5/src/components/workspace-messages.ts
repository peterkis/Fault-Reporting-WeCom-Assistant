import i18n from '../i18n';
import {en as compiledEn,zh as compiledZh} from 'virtual:yxx-i18n/workspace';
export const en={
  "heroEyebrow": "ONE TAP REPORT",
  "heroTitle": "Clinical IT support",
  "heroDescription": "Describe a fault by voice, photo, video or text. Your report is sent to the IT support team.",
  "heroCta": "Report an IT fault",
  "voiceSupported": "Voice description",
  "photoSupported": "Photos & videos",
  "support": "Common support",
  "selfCheckShort": "Paper jam / offline",
  "recent": "Recent tickets",
  "allHistory": "All history",
  "history": "History",
  "departmentStats": "{{total}} tickets · {{active}} active",
  "servicePhone": "Service hotline"
};
export const zh={
  "heroEyebrow": "一键报障",
  "heroTitle": "临床快速报修",
  "heroDescription": "支持长按录制语音、拍摄故障屏幕或录制视频。信息科将接收并处理你的报修。",
  "heroCta": "立即上报 IT 故障",
  "voiceSupported": "支持语音描述",
  "photoSupported": "现场图片与视频",
  "support": "常用支持",
  "selfCheckShort": "打印卡纸/脱机",
  "recent": "最近报修工单",
  "allHistory": "全部历史",
  "history": "历史",
  "departmentStats": "上报 {{total}} 件 · {{active}} 件处理中",
  "servicePhone": "电话专线"
} satisfies Record<keyof typeof en,string>;
i18n.addResourceBundle('en','workspace',compiledEn);
i18n.addResourceBundle('zh-CN','workspace',compiledZh);
