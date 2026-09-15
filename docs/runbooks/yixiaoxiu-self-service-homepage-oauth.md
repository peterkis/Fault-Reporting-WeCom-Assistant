# 医小修固定主页认证行为

本地候选固定入口为 `/wecom/yixiaoxiu/`，厂家确认的长期 URL 是
`https://chengdu.mobimedical.cn/wecom/yixiaoxiu/`。本文件描述本地实现的
有限行为；它不证明厂家后台配置或真实 OAuth 已验证。

## 主页流程

1. 裸主页 GET 没有会话 Cookie 时只调用一次现有 OAuth begin，并保存一个
   有界的 `?auth_return=1` 返回标记。
2. 合法 callback 只回到该标记。标记页有会话时 303 到裸主页；裸主页显示
   原有“认证成功，请从工单卡片进入”提示。
3. 已登录裸主页不会再次 begin，也不会访问 provider。
4. 浏览器自然丢弃过期会话 Cookie 后重新打开裸主页，可以开始一次新的
   有界认证。仍带着重复、格式错误或不可用会话 Cookie 的请求直接显示终止
   提示，避免用坏 Cookie 无限重定向。

## 终止行为

错 state、重复 callback、成员不支持（403）、provider/配置/关闭异常
（502/503）都直接显示安全错误页，不自动重试，不恢复原 POST，也不把成员
身份放进 URL、页面或日志。Cookie 被完全禁用时 callback 或返回标记页会以
401 终止；不会形成 302 循环。

登录、callback 和返回标记只接受固定站内路径。Ticket 深链接继续由原入口
处理，主页 handler 不吞掉 `/tickets/{public_ref}` 或旧 continue 路径。

验证入口：`node --test tests/yxx-ss-001-homepage-oauth.test.mjs`

