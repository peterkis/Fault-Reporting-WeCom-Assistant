import i18n from '../i18n';
import {en as compiledEn,zh as compiledZh} from 'virtual:yxx-i18n/command';
export const en={
  "errorTitle": "Unable to complete this action",
  "unknownTitle": "Result not confirmed",
  "unknownDescription": "Keep this page open. Check the original operation before doing anything else.",
  "checkOriginal": "Check original operation",
  "stillUnknown": "No confirmed result yet. Please check again later.",
  "conflictTitle": "The report has changed",
  "conflictDescription": "View the latest progress before starting a new action.",
  "resetConflict": "Use the latest version",
  "requestRejected": "This action is not available. Refresh to check the latest permissions.",
  "originalOperationDone": "Original operation confirmed",
  "syncFailure": "Submitted, but this page could not be synchronized. Refresh before continuing.",
  "pendingDescription": "The original result is being checked",
  "refresh": "Refresh"
};
export const zh={
  "errorTitle": "操作未完成",
  "unknownTitle": "提交结果暂未确认",
  "unknownDescription": "请保留当前页面，先核对原操作结果。",
  "checkOriginal": "只读核对原操作",
  "stillUnknown": "暂未查到确定结果，请稍后再次核对。",
  "conflictTitle": "工单已有更新",
  "conflictDescription": "请先查看最新进度，再明确发起新操作。",
  "resetConflict": "使用最新版本重新填写",
  "requestRejected": "当前无法执行此操作，请刷新核对最新权限。",
  "originalOperationDone": "已核对原操作结果",
  "syncFailure": "已提交，页面同步失败。请刷新后再继续操作。",
  "pendingDescription": "正在核对原操作结果",
  "refresh": "刷新"
} satisfies Record<keyof typeof en,string>;
i18n.addResourceBundle('en','command',compiledEn);
i18n.addResourceBundle('zh-CN','command',compiledZh);
