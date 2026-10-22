import i18n from '../i18n';
import {en as compiledEn,zh as compiledZh} from 'virtual:yxx-i18n/help';
export const en={
  "checksPrinter": "Printer paper jam",
  "checksPrinterText": "Follow the printer's on-screen guide. Remove only accessible paper. If paper is stuck inside, report the fault.",
  "checksOffline": "Printer is offline",
  "checksOfflineText": "Check the power and network cable. Confirm the selected printer. If it stays offline, report the fault.",
  "checksSystem": "A clinical system shows an error",
  "checksSystemText": "Keep the exact error message. Capture the screen without patient information and report the fault.",
  "checksEmergency": "For an urgent IT fault, call the emergency line."
};
export const zh={
  "checksPrinter": "打印机卡纸",
  "checksPrinterText": "按打印机屏幕指引检查可见纸张。纸张卡在内部时，请报修并等待处理。",
  "checksOffline": "打印机脱机",
  "checksOfflineText": "检查电源与网络连接，确认选中了正确的打印机。如仍显示脱机，请报修。",
  "checksSystem": "临床系统提示错误",
  "checksSystemText": "保留准确错误提示，拍摄不含患者信息的故障画面后提交报修。",
  "checksEmergency": "紧急 IT 故障可直接拨打应急电话。"
} satisfies Record<keyof typeof en,string>;
i18n.addResourceBundle('en','help',compiledEn);
i18n.addResourceBundle('zh-CN','help',compiledZh);
