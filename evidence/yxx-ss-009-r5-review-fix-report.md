# SS-009 PR19 r5 完整执行与汇总绑定修复

状态：本地实现、正式全量、两轴独立审查及严格门禁通过；当前候选远端复审待请求。

被测源码 HEAD：dcf688038a76e471b443be33af4aad6278d72bd2；tree：4c8b81110b02155b9994018fd28b41b49367b21d；指纹：91a6b21bacf35dd937e005e8b469bb10598b472cb2c3a9c9583941f10ad671dd。

## 两项审查问题

4052130551：旧入口只检查trace总量和PASS，未覆盖完整测试名称的重复次数及collector文件归属。真实隔离worktree中替换未被验收矩阵/历史映射引用的row，并重算trace、run、时间审计、验收矩阵的全部相关hash，旧入口仍接受重复row和未知测试文件。新verifyYxxCaseTrace比较完整TAP成功名称、嵌套层级的多重集，并逐条检查run.files归属、成功状态和配对观察时间；Binder和严格入口复用同一检查。

4052130553：旧入口不核对report.full_regression。新校验精确比较run全部计数、run.files.length与candidate_unchanged；缺失字段或伪造值均拒绝。

最初三个诊断TAP（bypass-red、rehashed-bypass-red、complete-rehash-red）只复现汇总问题，trace因尚未重算全部关联引用而被旧hash检查拦住。all-reference-rehash-red才是完整内容绕过证明：正向1项通过、3项期望拒绝断言失败。修复后的bypass-green为同一脚本4/4；没有把初步不完整复现当作漏洞证明。

STANDARDS预审还发现旧Run检查把已转义的字面名称# SKIP误判为指令。literal-directive-red真实复现为9/10；修复仅识别未转义指令后10/10。组合测试用实际Node24 TAP reporter，串联Run→Trace，覆盖控制字符、反斜杠、字面#、嵌套及同名同层级重复次数。真实skip/todo拒绝保留。

## 验证边界

29类实际变造保留既有23类，新增重复未引用trace、未知文件、错误层级，以及汇总计数、文件数、候选未变标志三类伪造。变造同步更新所有依赖引用，不能借旧hash造成假拒绝。

业务Runtime、API、数据库Schema、持久开关均未改变。旧r4及更早证据不修改。SS010 PLANNED，SS011 NOT_AUTHORIZED，父Gate不推进。正式自然GC/2C4G/60分钟现场未运行，历史202来源语义例外保持原结论。

预存tmp/ss009-pr19-history-verification诊断克隆仍保留，未重试此前被自动审批拒绝的删除操作；仅清理本轮自有资源，不宣称整个tmp清空。

## 当前候选最终结果

正式原入口1182/1182、191文件，fail/cancelled/skipped/todo均0、exit0；Node24.18.0、--expose-gc，候选未变化。完整实际trace与TAP多重集一致，历史171/183文件、48成员/37G2与202来源重新核验，原语义例外仍为保留限制。独立SPEC/STANDARDS无未解决P1/P2。

八个既有验证器和29类实际严格入口变造通过；待完成报告exit1，内部准备返回明确未完成状态，完成报告exit0。机器报告full_regression已与原run精确对照。13份本轮清理收据残留0；外部网络0，模拟Provider调用单独记录；390/1440截图人工核验只含合成数据。两种profile规定负载均通过，Web外发产物0。

未操作厂家/云端，未真实OAuth/SDK/医院业务数据/发送，未P2-G2-LIVE或AI，未合并PR或推进SS010/011。