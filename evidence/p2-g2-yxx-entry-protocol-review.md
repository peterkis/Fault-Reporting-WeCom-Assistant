# 官方协议核对

2026-09-11，Firecrawl 连接器强制刷新6页并核对正文。CLI 不在 PATH；普通网页工具无法打开该站，随后连接器返回200。正文摘要、更新时间和SHA见 `p2-g2-yxx-entry-protocol-sources.json`，临时摘取的正文保存在本次专属tmp目录。

- [96440：开始开发](https://developer.work.weixin.qq.com/document/path/96440) 要求配置准确可信域名，并说明认证身份缓存；这不构成本地工单授权。
- [96441：构造授权链接](https://developer.work.weixin.qq.com/document/path/96441) 支持既有snsapi_base、state、agentid及固定回调流程。本轮没有扩大敏感信息scope。
- [96442：获取访问用户身份](https://developer.work.weixin.qq.com/document/path/96442) 明确GET auth/getuserinfo、code一次使用、最多512字节、未使用5分钟到期；成员userid与非成员openid不同，互联企业身份带企业前缀。本轮维持成员/跨企业拒绝边界。
- [97164：应用token](https://developer.work.weixin.qq.com/document/path/97164) 说明应用secret换取gettoken凭据、expires_in缓存和提前失效处理。既有Provider/token实现复用；Bot secret不作为应用secret。
- [97104：安全性升级](https://developer.work.weixin.qq.com/document/path/97104) 说明应用授权历史及服务商命名空间会影响corpid/userid，密文大小写敏感；不能把两个入口的字符串身份默认视为等价。
- [97106：userid转换](https://developer.work.weixin.qq.com/document/path/97106) 区分已明确和未明确企业身份两种转换场景，后者包含source_botid。这里只记录存在的协议边界，未执行转换接口，未增设身份迁移或猜测匹配。

结论：本次真实身份对应关系仍为 `IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING`。以上文档与既有OAuth-only成功记录均不能代替本次真实A/B上报身份对应证明。模拟证明只允许ISOLATED_TEST配置；默认UNVERIFIED拒绝。
