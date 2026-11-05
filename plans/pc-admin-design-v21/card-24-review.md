# 卡24本地独立双轴审查与发布前验证

2026-11-05；用户授权以本地两端评审替代暂不可用的Codex Review，后续CI成功且无major后合并并只清理本卡。未请求远端Codex Review，也未改变保护规则。

| 轴 | 初审对象 / 覆盖 | 发现 | 修复复核 |
| --- | --- | --- | --- |
| Standards | f71a1cb8…293551f868c78b2fc2b2be04131289005a10767c；74/74路径，跳过0 | 0项可执行问题 | 293551f8…bdf2ad714a4683523955281aaff9ea233994f63e，5/5路径，新增0 |
| Spec | 同一固定base/head；74/74路径，跳过0 | F1 P2：数字继承遗漏，真实热度/列表计数normal | 根级继承同Token和真实控件断言；独立读回before/after、构建、types和manifest哈希，P2关闭，新增0 |

两轴独立只读，未让已写实现/既有PASS代替需求核对。详细原始报告、逐路径覆盖、OCR规则分组在 `D:/CodexEvidence/pc-admin-v215-card24-publish-20261105/`（standards-review.md、spec-review.md、standards-recheck.md、spec-recheck.md）。OCR delegate只做确定性文件/规则选择，不调用LLM端点；其不识别.mts等的排除未减少人工74路径覆盖。

## bdf2ad71验证

- 正式统一build通过，922/922实际Node语法检查，max_active2；strict/types、Stylelint/ESLint与verify-artifact通过。输入hash为56c24f9c1499bfa8a6f50385738b9d119bcc66c97bf643dfe3058fa61b9d5247，manifest为1ae9ed7625e00d6ead43a8016cc0d39a8ccb4cdffb148e45f0b615509d1ed244。
- F1实际20样本before/after：4热度、3列表计数由normal变tabular，13原时间/阶段计数保持。Spec独立复核确认关闭P2。
- 当前PC/read-safety并集及直接字体/登录风险18入口共135项；首轮134PASS/1FAIL，失败是既有登录工牌翻面等待超时。首次失败、TAP、not_run空集合保留。
- 登录产物与修补前逐字节相同。原参数隔离复跑1/1自然PASS，仅说明未再复现；没有修改登录源码、超时或业务断言。完整同入口11/11重跑PASS后，该135项所选范围全部实际到达并通过，原FAIL不覆盖。
- 具名Windows Electron1/1 PASS，三人真实PG/合成OAuth、200/409并发、闭环、后台通知、隐藏读/活动写0和失权/退出均保持。
- 上述原件为build-reviewed.log、types-reviewed.log、artifact-reviewed-final.log、numeric-before/after.json、local-reviewed/、desktop-session-retry/、native-reviewed.log。此为本地合成验证，不是CI、full/certify、真实发送或Gate。

## 发布文档预检

真实提交差异的pr-plan --check-docs发现design-system-v2.1.md既有FilterChip旧锚点失效，修为当前6.2.1标题的真实锚点。只变链接，未改规范含义或代码。此纯记录/链接后继不重新生成业务候选；保留bdf2ad71为本地被测代码祖先，最终PR head另由CI构建和验证。

原实现与数值/截图见[卡24执行记录](card-24.md)及[Evidence](../../docs/ui/evidence/v215-card24/README.md)。后续PR/CI/合并和清理回执在外部发布根集中维护，避免只为更新状态反复构建或重跑CI；CI未完成前不声明发布通过。

## 首次CI失败与登录采样修补

PR #150、ed3f53835bb7d1e7d6637d9147bc5b38555dcd66的首次TypeScript运行41989455590未通过。Linux普通入口已执行234项、233PASS/1FAIL，12个后续H5入口NOT_RUN；失败为既有登录开场采样range0/lateRange0/samePanel true。Windows在原生业务验证前因测试库WIN1252报22P05；另保留setup改写既有lock URL的源码漂移及清理预期退出码3的步骤失败。未据此合并或更改任何合并条件。

登录测试在scene ready后通过另一次CDP往返安装采样器，无法保证仍在一次性2600ms开场内。真实编译产物探针：ready起采样15.8277px/收敛0px；延后3100ms安装旧采样器为0px/0px，而同页提前采样仍15.8361px/0px（外部probe-login-motion.json）。这证明测试同步存在缺口；首次CI没有开场/采样时刻，尚不能排除首物理帧阻塞等其它原因。

仅将原3600ms rAF采样提前安装到新文档，在ready和iframe首次同时出现时开始；新增timeOrigin守卫和全动态媒体断言，保留摆幅≥6px、后段<1px及同一iframe断言。首物理帧过晚造成真正无摆动仍会失败，未改登录动画、超时、权限或业务断言。后续实际验证与两轴复核另绑定修补提交。

用户另明确授权三项最小CI配置修复：Windows测试initdb明确UTF8；desktop:setup的registry与既有lock的npmmirror一致，保留两套Electron依赖原版本、下载URL和integrity；清理在确认停止、预期status3、路径及数据删除后显式成功退出。没有移除或放宽原检查，也未修改合并汇总/分支保护。既有pr-plan工具测试增加对应Windows资源合同断言。

本地自有PG18、C locale下的编码差分：WIN1252执行同一中文SELECT得到22P05；UTF8完整读回「卡24（合成）」。两套探针库均实际停止并仅删除其已核绝对路径数据目录，脚本退出0；首次探针无效locale、Windows导入路径错误的日志同样保留，未记通过。详见外部probe-ci-encoding-final.log；此差分证明编码修复，不替代Windows CI后续整套实际结果。

## 第二次CI与图形验证配置

ca893d6d的本地build 922/922、types/Stylelint/ESLint、工具/文档33/33、完整登录11/11和制品校验通过（manifest 62bfc604568b2aa499eebc7baeb2b70e5956c705e5e74689db3530738e39679a）；PR运行41993088540仍失败。Linux提前采样为range0、late0、同iframe、reduce=false、samples2，说明3600ms窗口内出现严重帧饥饿，不能继续归为单纯晚装采样。Windows通过前轮UTF8/registry/清理修复和strict/制品检查，首次到达原生导航测试后因硬编码开发机D盘OpenSSL而ENOENT。两份新原始日志保留于ci-second-database-actual.log、ci-second-windows-actual.log；未据此合并。

本地正式ca893产物A/B：旧helper的--disable-gpu得到no-adapter背景回退；仅去除该参数、不加unsafe或blocklist豁免后，实际shader ready，工牌摆幅15.8406px、后段0px、209帧、最大间隔116.8ms。显式unsupported回退对照也通过，但未把量化摆动移到该对照或删除任何原GPU分支。探针原件为probe-login-gpu-isolation.json和probe-login-normal-graphics.json；早期额外开关探针单列，不冒充最终配置。

只让正式登录3D测试通过graphics=true使用浏览器正常图形路径；helper默认仍为false，全部其它调用继续禁用GPU。原组合摆幅≥6px、后段<1px、同iframe、完整动效以及所有GPU/恢复/认证断言保持，增加背景模式、可见性和最大帧间隔日志。未改登录应用动画、布局或全局系统设置，也不据Windows结果提前宣称Linux问题已消失。原生导航测试只复用既有helper的D/C两盘OpenSSL候选定位并在缺失时明确失败；证书参数与后续全部原生断言保持。后继结果另绑定新提交。
