import i18n from '../i18n';
import {en as compiledEn,zh as compiledZh} from 'virtual:yxx-i18n/interaction';
export const en={
  "supplementHint": "Add useful information for this same fault.",
  "supplementPlaceholder": "Add details for the support team…",
  "sendSupplement": "Send information",
  "rateTitle": "How was the service?",
  "rating": "{{count}} star(s)",
  "ratingLabel": "Service rating",
  "ratingRequired": "Choose a rating from 1 to 5.",
  "ratingComment": "Comment (optional)",
  "ratingSubmit": "Confirm resolved & submit rating",
  "feedbackTitle": "The same fault is still unresolved",
  "feedbackHint": "Confirm that the same fault is still unresolved. This reopens the original ticket.",
  "feedbackSubmit": "Submit unresolved feedback",
  "profileHint": "Details come from your verified member profile. Missing details do not prevent reporting.",
  "phoneMissing": "Phone not available",
  "imagePreviewHint": "Tap the image to zoom or reset. The original remains available.",
  "imageZoom": "Zoom image",
  "imageReset": "Reset image"
};
export const zh={
  "supplementHint": "为同一故障补充有用信息。",
  "supplementPlaceholder": "请填写需要补充给工作人员的信息…",
  "sendSupplement": "提交补充",
  "rateTitle": "本次服务体验如何？",
  "rating": "{{count}} 星",
  "ratingLabel": "服务评分",
  "ratingRequired": "请选择 1 至 5 星评分。",
  "ratingComment": "评价内容（选填）",
  "ratingSubmit": "确认解决并提交评价",
  "feedbackTitle": "同一故障仍未解决",
  "feedbackHint": "请确认同一故障仍未解决，原工单将重新进入处理。",
  "feedbackSubmit": "提交未解决反馈",
  "profileHint": "资料来自已核验的成员信息，资料缺失不影响报修。",
  "phoneMissing": "电话资料暂缺",
  "imagePreviewHint": "点击图片放大或复位，也可查看原图。",
  "imageZoom": "放大图片",
  "imageReset": "复位图片"
} satisfies Record<keyof typeof en,string>;
i18n.addResourceBundle('en','interaction',compiledEn);
i18n.addResourceBundle('zh-CN','interaction',compiledZh);
