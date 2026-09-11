# P2-G2 延迟会话投影的空引用补齐

三进程正常入站后追加人工回复测试，实际发现 Direct Leg 的 conversation_session_id 为空；对应内部会话查询返回404。失败保存在 `tmp/p2-g2-tests-24bfaf54-a435-4e01-9791-78f9ca61d898`，TAP SHA256 `1ff0ae160ae4f24f103e05fb2fe0d7fde640f464c3c23194e2374a356e2e8d5c`。

源码原因：Worker可以先完成规则/建单，随后App才创建Conversation；ensureLeg重放直接返回已有Leg，空引用不会回填。修复沿用持续缺口授权，不把会话投影变成报修持久化或建单的前置条件。

补齐契约：仅规则开关开启的现有Worker周期执行，单批不超过20；只填写空的Thread/Session引用。可信来源必须是同一Intake的唯一Conversation，provider、Bot、渠道、原始Reporter、primary Message、Journey/Leg身份全部一致。已有非空引用不替换、不跨人、不按时间猜测。原始Decision/来源及Ticket不改写；Journey的origin/current空指针只指向其原始/最高序号Leg，已有指针不替换。没有数据库结构变更，也没有新增后台进程。

独立数据库测试明确让Worker先执行，再运行真实会话投影；空闲Worker周期补齐、错误Reporter拒绝、重复周期幂等。此文记录修复范围；最终通过数和候选绑定以本轮完整回归及独立审查为准。
