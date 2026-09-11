# P2-G2 判定器与有限装配复核

2026-09-08。本文记录此前限定判定器验证。后续领域修复已取得独立授权并完成定向验证，当前准备为 `IN_PROGRESS`，最新装配见 `p2-g2-send-hardening.md`。没有实际现场PASS、负责人关闭批准或READY候选。

## 判定器反例与修复

第一轮10项反例实际RED：37 tests / 27 pass / 10 fail，exit1。原始TAP：`tmp/p2-g2-tests-c4b6e085-338b-4fd8-bd36-44a736a594d0/result.tap`，SHA-256 `aa950e4c4359a3cd8a322002918af38131196afe7089e913366a85f795687e87`。

覆盖就绪晚于观察、批准早于清理、整小时停机冒充稳定运行、隐式重启、路由早于持久化、sample_gap缺失、启动批准源未绑定、业务集中于开始后空等、缺最终回归、无效manifest导致非稳定异常。修复严格验证输入绑定与源引用；累计就绪STEADY区间；校验角色uptime与故障角色范围；现场业务及负责人时间分开约束。首次现场前固定15分钟最大业务活动间隔，仅属测试节奏约束，非响应SLO，详见docs54。

第二轮两名独立只读Reviewer复现：完整END/CLEANUP旧记录与新的空PASS记录可拼接；唯一DIRECT_ORGANIC可落在观察之后。新增3反例实际RED：40 tests / 37 pass / 3 fail，exit1。TAP：`tmp/p2-g2-tests-bd83250d-65c7-4622-a0b3-f7ee99209c22/result.tap`，SHA-256 `73105ae5f8a360bf77144fedb4f24a7e410fac1667f1bab4aada65232c51f45d`。

修复后END/CLEANUP的同一条完整事实同时满足内容与时间；必需现场Receipt/Client Observation绑定观察窗口。另有合法故障正向测试：Gateway批准故障扣除相邻30秒，得到INCOMPLETE/3,570,000ms；恢复并延长30秒后达到PASSED/3,600,000ms。全部为内存夹具，无实际Gate证据写入。两名Reviewer各自执行41/41、exit0，对上述缺口给出限定PASS；不覆盖尚未实现的source-reader或CLI。

## 配置、契约与三角色验证

- 角色最小配置反例：App/Worker不持有Gateway WSS配置时错误拒绝。RED 5/6：`tmp/p2-g2-tests-3a01a605-329d-4e78-a2b0-284cb2fad031/result.tap`，SHA `028dc2b16e7708a06206f82f608234bdaddb4b682af832327ff797ac31c7a2e0`。限定Controller/Gateway检查WSS后GREEN6/6：`tmp/p2-g2-tests-f2be0dbf-6e8e-496c-91a6-4deb16b24dcc/result.tap`，SHA `1ae79d479944dfc25c9024ad856bf5d3c02711daf1471807e07b5cdb354b31ca`。纯配置校验不授予真实启动许可。
- F02误允许Gateway进程控制反例：RED0/1，`tmp/p2-g2-tests-e760f147-1380-4264-8360-5adffc2a6a5b/result.tap`，SHA `f4f9549a4b7161d6c60ec938a774d8de26bc55ab727c8fc0fb51f0f9716a9ed7`。现仅App/Worker可使用F02，Gateway仅既有F01接口。
- OpenAPI全局`/api`与Incident路径`/api/...`形成双前缀。新增实际HTTP/解析反例后，仅24个Incident Path Item设置根server，保留原路径键；实际新旧契约联合12/12，exit0，`tmp/p2-g2-tests-bf13cfba-c2f2-4877-bbfd-01e4d406c593/result.tap`，SHA `68e1937ee91c212ccd74df7a8f0992eba911c542691d5410c25d95bac54de1e9`。

最终定向联合63/63，exit0，fail/skipped/cancelled/todo均0。TAP：`tmp/p2-g2-tests-2ca2a8ed-c009-4475-b16f-e431d782717c/result.tap`，SHA-256 `4efb2ad234ecc9973af79602097259f9949df94e09e70f719a708d30cd5b9fea`。范围为三角色实际进程/PostgreSQL/HTTP/浏览器、evaluator、evidence、validation-config、OpenAPI路由和原P2-012 schema/live guards共6文件。三角色测试终止所属进程、关闭浏览器、检查池连接与隔离库清理；临时DEBUG-G2-RESTART诊断已移除。此前一次Worker重启超时未证明根因，历史失败不删除，后续五次精确重跑及本轮联合通过不替代最终全仓回归。

## 停止线

Direct Session的120秒续报重复建单与“另外”新故障误合并仍为实际2项RED，见`p2-g2-direct-session-gap.md`。本63项绿色子集不含这两项，也没有将其skip或删除。原202条仅完成有限单文本实际验证；完整矩阵、现场发送预算/控制器/证据读取、完整577基线加新增测试与就绪候选提交仍未完成。AI保持关闭，LIVE装配仍明确拒绝；未真实发送、关闭Gate或push/merge/tag。
