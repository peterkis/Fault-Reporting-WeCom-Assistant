# 2026-09-23 分类器比较历史归档

本目录记录 2026-09-23 已完成的研究，不是当前 main 的运行验收。原研究对象为 `38b6af4ab22a6a9a5bd3f5fe7752d691c56c7f38`；版本、环境、源码摘要和局限分别见 [source-snapshot.json](source-snapshot.json)、[analysis.md](analysis.md) 和各结果文件。132 条输入均为人工构造的合成案例，不含真实聊天、患者或职工原始数据。

2026-10-02 归档时保留原报告、输入、返回及脚本的字节，不重新计算历史测量，不把旧报告中的“未提交”工作状态解释为当前 Git 状态。本目录的 .gitattributes 防止跨平台换行转换破坏原始 SHA-256，尤其是样本及 Jev 请求模板摘要。

按 [ADR-0026](../../../adr/0026_typescript_strict_incremental_migration.md)，原实验的 `run_rules.mjs` 和 `run_jev.mjs` 以 [run_rules.mjs.txt](run_rules.mjs.txt) 和 [run_jev.mjs.txt](run_jev.mjs.txt) 保存为历史源文本，不增加活动 JavaScript 工具或迁移例外。原分析中的重跑命令属于当时环境；不得直接视为当前版本的执行入口。未来如需重跑，应单独建立符合当前 TypeScript 政策的工具、固定被测源码和环境，并输出到新的研究目录。

归档核对仅执行本地静态检查、132 条样本及五组逐条结果的一致性、请求模板摘要和汇总指标复算。未调用 Jev 或第三方人员接口，未读取真实聊天或人员明细，未运行数据库、修改 Feature Flag 或推进业务 Gate。
