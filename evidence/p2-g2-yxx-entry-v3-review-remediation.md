# P2-G2-YXX-TICKET-ENTRY 修复与验证 chronology

当前最终候选 9e6aa8a001fc0fde9c4f364888d5ecbaa28dd3350269e1af72e18d3c4a502048，1044/1044全量PASS。历史失败均保留，不把首轮或中间候选写为当前验收。

- 初始Contract/member RED为模块尚未接入的失败，不能单独证明授权逻辑；后续真实PostgreSQL/HTTP与浏览器测试提供行为证据。canonical卡片及浏览器独立intent的RED另有明确断言失败。
- HTTP首跑421/401源于测试fetch未按预期设置Host，改用实际http.request精确Host；格式ref、Grant时钟与FULL profile认证配置的首跑记录保留。它们是开发/夹具修正，不伪称全部都是线上缺陷。
- 不协作Provider旧实现超出6500ms测试期限，记录为cancelled=1。修复加入5秒deadline与未结束Provider单飞隔离；后续断言验证502与后续503/单次调用。原取消记录没有改成普通assertion RED。
- SPEC P1：两个携带相同旧Cookie快照的重叠回调可使较早身份读取晚到。真实SQL在途测试先观测200而预期401；改为服务端browser group身份替换，覆盖共享binding与首次并行导航binding。独立SPEC验证过该修复。
- SPEC P2：复用browser binding未刷新期限导致新begin/prepare被旧20分钟截止截断。完整中间候选1022/1022虽通过，仍因该确认问题被取代。新增RED复现后，仅显式begin/prepare刷新binding，Session固定期限与轮询行为不变。
- 规范11缺口：过期/重启continuation原返回application/json，新增失败断言后改为通用404 HTML提示重新点击原卡片；原归属拒绝和业务无副作用仍在。
- STANDARDS P2：48场景可引用无关通过名称；成员run可与父级TAP/文件hash不同。4个独立反向子测试均先失败，后以冻结定义重建名称/文件并要求父子run/ref一致解决。
- 修复后定向36/36及Contract/真实浏览器11/11通过；两个独立轴确认SOURCE_PASS，然后冻结源码运行最终完整回归。1028候选在最终台账组装时触发ARCH-006将当前报告误归入历史证据的旧门禁。先记录失败、保留1028原TAP/run/reviews及主报告快照，再按ADR0018限定两个M路径、原字节快照和READY校验，拒绝删除/重命名/其他历史变动。新增治理测试后完整重跑，1028/1029的一项初始浏览器相对跳转Uncaught失败按原样保留。20次独立重现未再次出现原异常，明确about:blank的初始文档用例复现同类异常后，测试改为浏览器原生绝对导航并断言导航错误；刻意暂停OAuth的测试在释放响应后才等待导航，登录/归属/晚到响应断言保持。完整浏览器用例复验通过后再次完整重跑，当时证据使用v2路径且已通过1029项；它是本轮PR #8修复前的历史候选。当前v3证据重新绑定本指纹、实际TAP、场景与来源审计。

- PR #8远端P1：成员卡片在Grant超过30分钟后DEAD_LETTER。真实Worker RED后，改为持久通知/投递/消息/Ticket事件/Reporter绑定和保留期校验，不读、不续期、不重建Grant；原legacy保持。新增CONSUMED/缺失Grant、篡改/撤销/保留期、数据库重试与UNKNOWN不重发测试。
- PR #8独立SPEC P2：畸形33项数组可在SDK前hash抛错并误判UNKNOWN；RED后将快照/hash置于CARD_INVALID catch，GREEN确认零SDK、永久拒绝。
- PR #8独立STANDARDS P2：当前结构化Evidence增加成对Shanghai事件时间和字符串epoch，父/成员报告守卫拒绝缺失、ISO和不匹配时间。原始历史文件保留，追加p2-g2-yxx-entry-pr8-historical-time-corrections.json。当前完整回归及复查重新执行。
- PR #8首次完整回归1042/1043：既有三进程拓扑就绪超时。重复夹具第7次重现投影积压与失败，进一步诊断发现较晚Ticket先于早期Channel投影。真实事务屏障稳定复现App Session→Realtime与Worker Realtime→Session的40P01；以可选事务起始钩子令P2-016 Timeline先锁Realtime，默认其他装配行为不变。GREEN保持消息先后、积压清零与幂等，相关54项定向通过，原三进程用例连续10次通过后才重跑当前完整回归。未放宽readiness、超时、失败计数或业务时间。
- 诊断过程中的初始Proxy夹具屏障失败，以及未建立预期交错的resolver探查，不作为已确认业务RED或已修复问题；准确分类见p2-g2-yxx-entry-pr8-diagnostic-classification.json。临时观测模块仅在ignored tmp使用，正式全量无诊断预加载。
- 后续完整回归1043/1044：运行时、事务屏障与原拓扑通过，唯一失败为移动端时区测试在异步reload后接受旧文档的ready状态。用受控100ms延迟与旧文档标记确定性复现两种宽度的RED，再要求旧标记消失且新文档工单可见，保留三个时区一致性及OAuth不重放断言，浏览器GREEN及复跑均5/5。只有该测试文件变化；v3-reload-provenance.json精确重建前一候选指纹，证明10次拓扑复跑对应的运行时代码保持不变。最终完整回归重新验证当前全部输入，不把前一候选的循环次数冒称为新测试字节上的执行。

RED输出中的合成浏览器token及合成Grant URL在发布前脱敏；断言行为、失败数及chronology保留。详情见 p2-g2-yxx-entry-v3-regression-history.json。真实身份对应、定向现场、P2-G2-LIVE及负责人Gate批准均NOT_RUN。
