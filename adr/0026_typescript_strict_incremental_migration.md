# ADR-0026：严格 TypeScript 的增量迁移边界

- 状态：ACCEPTED_ON_AUTHORIZED_MERGE；仅在 PR #24 经审查及授权合并后生效，不代表业务迁移验收或生产批准。
- 日期：2026-09-28
- 起点：main `9cb71da1370781670faedbc5a24668720e8df0be`。
- 范围：语言政策、迁移范围与基线记录；不改变业务架构、接口或 Gate。
- 关联：[技术栈](../docs/03_technology_stack.md)、[迁移入口](../plans/typescript-migration/README.md)。

## 背景

当前后端是 Node.js 24 ESM：183 个 src MJS、77 个脚本 MJS；测试目录的 247 个 MJS 包含 205 个测试入口及 42 个支持文件，另有 2 个审核测试入口。13 个声明文件不等于实现受到严格类型检查。前端原型使用独立的 TypeScript 配置，不代表根后端已经类型化。

恢复 TypeScript 的目的，是约束端口、配置、状态、数据库行和跨模块演进，不以 GitHub 语言占比或批量改后缀作为完成条件。当前清单与原计划一致，见 [baseline.json](../plans/typescript-migration/baseline.json)。T00 已补齐独立完整 Git 与 Node24/PG18 基线，结论限于政策基线记录，不等于应用全量验收。

## 决策

1. 活动后端的目标是 Node.js 24 + TypeScript strict + ESM。生产源码 `.mts` 编译为 `.mjs`，NodeNext 下相对运行时 import 保留 `.mjs`。T00 不安装 TypeScript 或更改启动命令；准确编译器和类型包版本在 T01 核实并锁定。
2. 先在 T01/T02 建立类型检查和双树测试，再迁移第一个既有生产模块。源码树承载 Git/Schema/当前候选检查；生成运行树承载应用、资源及子进程；固定历史对象使用原 REF 的独立完整 checkout 和原 CRLF 策略。混合测试必须显式区分 sourceRoot/runtimeRoot，不能制造编译目录的 Git 身份。
3. 只保留一张运行模块图。禁止同名 `.mjs/.mts` 源码并存、源码跳板、缺资源时回退源码和重用失败构建遗留产物。未迁移 MJS 复制保持原字节；已迁移模块只能使用本轮编译产物。生产运行 JavaScript，不增加常驻编译器。
4. 主线目标为 scope.json 精确列出的 173 个非 G0 模块和 8 个活动启动脚本。10 个 G0 文件先保留；其中 `g0-002-sdk-lifecycle.mjs` 的 `createSafeSdkLogger` 仍被 Gateway 适配链调用，后续须验证窄类型边界，不能把遗留实现宣称为严格 TS。现有工具和测试按命名清单保留，不赋予目录级新 JS 豁免。
5. 本迁移分支及本 PR 合并后的新生产模块不得使用 JS/MJS。管线尚未建立时先完成 T01/T02，不通过新增 JS 扩张范围。现有 JS 的必要缺陷修复仍可单独执行，不等于允许新生产 JS。临时工具 JS 只能经独立变更登记具体文件、理由和删除阶段；T00 的 bootstrap 例外清单为空。
6. 新增/迁移实现采用 strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes、useUnknownInCatchVariables。外部输入仍从 unknown 经原运行时守卫归一化。不得通过 any、ts-ignore、ts-nocheck、as unknown as、空 include 或降低严格选项获得通过。带原因的 ts-expect-error 仅用于负向类型测试；具体第三方声明例外须登记，不能谎称无类型泄漏。
7. 保持 JSON/SQL/时间/哈希/事务/身份/可靠投递的既有语义。不得为类型报错补参数默认值、截断目录归属、改变 Token 策略、扩张角色白名单或去掉运行时验证。只做最小类型修改，不捆绑 ORM、框架或业务重写。
8. 源码身份、构建制品和冻结历史证据分别记录。历史 Evidence、SQL 迁移、tested_head 和原批准保持不变；同 tree 只能说明内容相等，不能代替祖先关系。T00 不改变 plans/current_phase.json、业务 backlog、生产开关或现有 Gate 状态。

## T00 出口与后续

T00 的必要执行缺口已补齐，状态为 POLICY_BASELINE_RECORDED。独立只读验证分支对外部 GitHub API 确认的 PR head 执行原计划工具 exact/descendant、原历史身份预检、17 文件选择集及架构检查。Node 24.21.0 / PostgreSQL 18：96/96 目标测试通过、零跳过；原 P2-016 固定 REF/CRLF 历史入口通过。

当前和原 main 的原始 `--require-ready` 均 exit 1，公共错误为 `YXX_VERIFICATION_REJECTED`，内部守卫均为 `YXX_LOCAL_VALIDATION_SCOPE_INVALID`。依 T00 任务记录为 KNOWN_BASELINE_NOT_READY，绝不改为当前严格验收通过；旧环境失败保留在原提交回执。完整结果见 [T00 基线记录](../plans/typescript-migration/verification/T00-baseline.json)。types/build 为 NOT_APPLICABLE_T00。

人员目录 CI 仍保留原路径过滤。本 PR 不改源码或现有 workflow，不创建任何写入型工作流；验证专用分支仅持有读取权限，检出独立被测对象，不合入本 PR 或 main。其测试通过不替代自审、Codex 复审及用户条件授权。

完成 T00 的必要环境基线、精确非就绪原因记录、自审、独立复审和用户授权合并后，T01 才能从新的 main 开始。所有后续批次仍为 PLANNED。迁移最终通过也不授权 P2-G2-LIVE、P2-008、P3、真实 Provider、发送、部署或生产写库。

## 回滚

未合并时保留本分支及日志并停止下一批；合并后通过单独 revert PR 撤销本政策增量。不重置用户 main、不删除用户文件、不重写历史。本次无数据库或运行配置变更，因此没有数据库回滚步骤。
