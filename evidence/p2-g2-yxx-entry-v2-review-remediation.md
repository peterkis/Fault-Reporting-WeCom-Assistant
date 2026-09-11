# P2-G2-YXX-TICKET-ENTRY 修复与验证 chronology

当前最终候选 a9a98feb4e48bed956d3fdce0ba6e93b52707f4956ef79ee7544356507c54e88，1029/1029全量PASS。历史失败均保留，不把首轮或中间候选写为当前验收。

- 初始Contract/member RED为模块尚未接入的失败，不能单独证明授权逻辑；后续真实PostgreSQL/HTTP与浏览器测试提供行为证据。canonical卡片及浏览器独立intent的RED另有明确断言失败。
- HTTP首跑421/401源于测试fetch未按预期设置Host，改用实际http.request精确Host；格式ref、Grant时钟与FULL profile认证配置的首跑记录保留。它们是开发/夹具修正，不伪称全部都是线上缺陷。
- 不协作Provider旧实现超出6500ms测试期限，记录为cancelled=1。修复加入5秒deadline与未结束Provider单飞隔离；后续断言验证502与后续503/单次调用。原取消记录没有改成普通assertion RED。
- SPEC P1：两个携带相同旧Cookie快照的重叠回调可使较早身份读取晚到。真实SQL在途测试先观测200而预期401；改为服务端browser group身份替换，覆盖共享binding与首次并行导航binding。独立SPEC验证过该修复。
- SPEC P2：复用browser binding未刷新期限导致新begin/prepare被旧20分钟截止截断。完整中间候选1022/1022虽通过，仍因该确认问题被取代。新增RED复现后，仅显式begin/prepare刷新binding，Session固定期限与轮询行为不变。
- 规范11缺口：过期/重启continuation原返回application/json，新增失败断言后改为通用404 HTML提示重新点击原卡片；原归属拒绝和业务无副作用仍在。
- STANDARDS P2：48场景可引用无关通过名称；成员run可与父级TAP/文件hash不同。4个独立反向子测试均先失败，后以冻结定义重建名称/文件并要求父子run/ref一致解决。
- 修复后定向36/36及Contract/真实浏览器11/11通过；两个独立轴确认SOURCE_PASS，然后冻结源码运行最终完整回归。1028候选在最终台账组装时触发ARCH-006将当前报告误归入历史证据的旧门禁。先记录失败、保留1028原TAP/run/reviews及主报告快照，再按ADR0018限定两个M路径、原字节快照和READY校验，拒绝删除/重命名/其他历史变动。新增治理测试后完整重跑，1028/1029的一项初始浏览器相对跳转Uncaught失败按原样保留。20次独立重现未再次出现原异常，明确about:blank的初始文档用例复现同类异常后，测试改为浏览器原生绝对导航并断言导航错误；刻意暂停OAuth的测试在释放响应后才等待导航，登录/归属/晚到响应断言保持。完整浏览器用例复验通过后再次完整重跑，新证据使用v2路径；最终绑定审查引用本指纹、实际TAP、场景与来源审计，未解决项0。

RED输出中的合成浏览器token及合成Grant URL在发布前脱敏；断言行为、失败数及chronology保留。详情见 p2-g2-yxx-entry-v2-regression-history.json。真实身份对应、定向现场、P2-G2-LIVE及负责人Gate批准均NOT_RUN。
