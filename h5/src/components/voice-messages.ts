import i18n from '../i18n';
const en={
 setupFailed:'WeCom voice is temporarily unavailable. Try again later or add an audio file.',
 nativeStartFailed:'WeCom could not start recording. Try again or add an audio file.',
 browserUnavailable:'This browser cannot record audio. Add text or an audio file.',
 browserDenied:'This page cannot access the microphone. Check page access or add an audio file.',
 browserFailed:'Web recording could not start. Try again or add an audio file.',
 finishFailed:'The recording could not be saved. Record again or add an audio file.',
};
const zh={
 setupFailed:'企业微信录音暂不可用，请稍后重试或添加音频文件。',
 nativeStartFailed:'企业微信未能开始录音，请重试或添加音频文件。',
 browserUnavailable:'当前浏览器不支持录音，可补充文字或添加音频文件。',
 browserDenied:'网页暂时无法访问麦克风，可检查网页访问权限或添加音频文件。',
 browserFailed:'网页录音未能开始，请重试或添加音频文件。',
 finishFailed:'录音未能保存，请重新录音或添加音频文件。',
} satisfies Record<keyof typeof en,string>;
i18n.addResourceBundle('en','voice',en);
i18n.addResourceBundle('zh-CN','voice',zh);
