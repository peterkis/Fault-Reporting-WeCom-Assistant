# P2-G2 Direct Session 续接与新故障分界修复

负责人授权见 `p2-g2-direct-session-repair-authorization.md`。原始语料、001–032迁移及历史RED不改写；没有新增表。当前为准备中的领域修复，不构成READY或Gate PASS。

## 契约与实现

P1 Intake增加可选的既有Intake选择器；缺省仍按90秒碎片窗口工作。P2 Runtime、P2-012/P2-016 Gateway与G2装配显式注入同一选择器。选择在原Inbox事务及同身份advisory lock内执行，检查同Provider/Bot/Reporter、唯一活动Direct Session、Intake/Journey留存、既有Leg/Session身份及未结束状态。空闲上限按P2配置30分钟独立判断，保留期不延长。

明确追加故障切新Intake；“另外补充”、否定和假设不能只因含故障词就切换。P2新增空闲/明确新话题原因写入既有追加式`intake.received`事件，Session投影保留相应`close_reason`。P1独立路径的既有行为保留。

Session是入站提交后的投影，因此还需检查同身份流中已提交、晚于已投影Intake的待投影新Intake。该分界按持久化消息顺序确定，补充归入新问题；有历史但旧Session已结束时同样适用，不能复活旧会话或拆第三张单。待投影Intake空闲边界使用源消息`received_epoch_ms`，不以秒级展示时间丢失毫秒精度。

## 实际RED/GREEN

| 范围 | 实际结果 | TAP目录 | SHA-256 |
|---|---|---|---|
| 本次授权后原3项复现 | 1/3，2 fail，exit1 | `tmp/p2-g2-tests-dcc3e832-c6d4-40e0-a87a-acaf5add887e` | `255fad56789295a78be39e22aabe8a1fd4feb7aa280509877f68771a5fd1b24e` |
| 续接与新故障首轮GREEN | 3/3，exit0 | `tmp/p2-g2-tests-40740cb7-19d4-42aa-9154-6d0a601310e1` | `f735735197daeb67de208647c2e59af439b75b9fadbaa63869497054ffa9d82d` |
| P1与初始扩展边界 | 35/35，exit0 | `tmp/p2-g2-tests-42afe629-8db3-482c-a5dc-975bcf7428f6` | `d46bd99379a5a7dc9235b994cd707413d43a08facb0d37e16cc13c36d0a8675a` |
| 复核：投影延迟、否定/假设/空格补充及审计原因 | 12/17，5 fail，exit1 | `tmp/p2-g2-tests-49eca42e-931b-48f8-9e7c-73c8662498a9` | `219d3d6667b07f7fd104c342ddc1b31af2d205b612aa27dbf117c8b86b2e2def` |
| 上述反例修复 | 17/17，exit0 | `tmp/p2-g2-tests-1245055d-84af-4544-9f87-022c230df860` | `aa343096eeadd3d425a5d1c3a8fb138227b94d0de333c9325a0443665acee903` |
| 旧Session已结束的待投影边界 | 17/18，1 fail，exit1 | `tmp/p2-g2-tests-3869c2e8-d7cb-4457-8bac-13cf824f42ae` | `b7c09d530a0a6243d268d64b94956fccfbc9705718458c9827d426bf40bd23d8` |
| 18边界、76单文本及P1联合 | 117/117，exit0 | `tmp/p2-g2-tests-1caef4f9-b8f1-49e8-a3e0-443323815365` | `7817977a10e3e752c79c576bfdeae2b58d9769f17e4fcc491b2b7cb7970fc0dc` |
| 留存期限及待投影毫秒边界 | 20/21，1 fail，exit1；留存通过，毫秒边界失败 | `tmp/p2-g2-tests-a50ce984-d462-4050-ad4e-61e168eeeef8` | `87f9f270ac4ba21b9a49b87af9bf1f26881a4160c9080b0181bf1332e1fb9d91` |

表中SHA均对应目录中的`result.tap`；运行参数和实际退出码在同目录`run.json`。首次扩展35项曾有一项测试假设错误：空闲间隔从首条接收时钟计算，未考虑后续Ticket投影推进Session活动时间；原34/35日志保留于`tmp/p2-g2-tests-6c202edf-8b79-4175-970b-dc32aa248f8e`。已改为从实际Session最后活动epoch精确测试边界，不把该假设错误当作业务复现。

两名独立Reviewer发现上述投影/否定/审计问题后复核收口；Spec Reviewer独立运行17/17，以及旧Session已结束的精确1/1数据库用例。Standards最终结论为限定源码PASS，不冒充独立数据库全量验证。毫秒修复后的联合回归另行追加。

所有数据库测试使用独立合成库；机械结束/关闭/缩短留存夹具不计作正常报修识别。无真实发送、P2-008、Gate关闭或新提交；完整202、Gate矩阵、工具与最终全仓回归仍继续。

毫秒修复后联合49/49通过，exit0，fail/cancelled/skipped/todo均0，范围为21项Direct Session边界、三角色实际装配、P1聚合与Direct Leg。TAP：`tmp/p2-g2-tests-888de81f-854a-4b3a-9d2f-b675b9126a53/result.tap`，SHA-256 `80a4d5b8b829cc6f71c1253b7b463f0d6a760a5911c36bdff62d8455f168d9f7`。测试正常停止所属进程/浏览器、检查连接与隔离库残留；不代表已完成全仓回归或正式观察。
