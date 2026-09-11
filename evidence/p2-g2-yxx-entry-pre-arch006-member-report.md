# P2-G2-YXX-TICKET-ENTRY 本地交付报告

本子任务实现及隔离自动化完成，等待独立定向现场授权。状态为 READY_FOR_TARGETED_LIVE_VALIDATION / IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING。P2-G2 / ASSEMBLY 的当前候选准备证据已更新；父 Gate 未 PASSED，最后完成 Gate 仍为 P2-G1，P2-008 保持阻断。

本任务相对固定base的实际文件清单及字节摘要见 `p2-g2-yxx-entry-change-inventory.json`，完整候选输入另见 `p2-g2-yxx-entry-candidate-inventory.json`。完成态离线检查见 `p2-g2-yxx-entry-final-checks.json`；这些记录与全量Runtime测试职责不同。

1. Git：分支 phase2/yixiaoxiu-member-ticket-entry；base 4cecdb5551da455a8b0a6c877f7f0a63ffa6eec9；独立授权提交 c1b33218521dc5dba3c07ce57452473c367e7ad6（chore(p2): authorize yixiaoxiu member ticket entry）。完整回归在该授权提交之上的未提交实现候选运行。实施提交为包含本报告的后续独立 feat(p2) 提交，实际 SHA/tree 由最终交付消息给出；不把授权提交当作实现源码提交。

2. 当前验证：候选 238e75165605015ceb844f140c5be4e79076cb3a1e65446c25615c02f4c13a2a，607 文件；1028/1028 全量 PASS，165 测试文件，fail/cancelled/skipped/todo 均0，exit0，candidate_unchanged=true。命令 node scripts/p2-g2-synthetic-e2e.mjs --suite=full；原始目录 tmp/p2-g2-tests-a6f54f22-e5c3-4e9d-a38c-d85481c63d00。原976项/158文件是 PR #7 历史结果；其全部158文件包含在本次运行，新增场景与测试并未替换旧基线。P2-012冻结基线92个根文件及2个P2-007嵌套文件也全部保留。

3. URL：新卡片两个点击区域均为 https://<批准域名>/wecom/yixiaoxiu/tickets/<32字符public_ref>，只定位、不授予权限。旧入口为 /reporter/open#grant=<旧凭据>，前端立即清除fragment，经 /api/reporter/member-entry/prepare 与 /wecom/yixiaoxiu/continue/<64字符entry_ref> 完成定位。/wecom/yixiaoxiu/ 是认证主页；/login 开始认证；/callback 只处理 OAuth code/state，固定跳回站内目的地。以上不是现场已部署地址。

4. 身份依据：本轮只证明 ISOLATED_TEST 中的 synthetic identity correspondence。官方97104/97106说明身份口径可能不同，不能推出实际一致；既有 OAuth-only 真实认证记录也未证明 Bot userid 与应用 OAuth userid 的对应关系。本次真实身份对应仍 UNVERIFIED。部署必须补充可信对应证据及企业/应用/Agent/Bot范围；不会按姓名、手机、大小写转换或部门猜测，也不会自动调用转换API。

5. 每次详情、Timeline和304都先验证当前内存OAuth身份，再从权威ref/Ticket/source Intake核对企业配置、provider、Bot、Reporter、现有绑定摘要、撤销状态及业务保留期。事务使用 REPEATABLE READ、ref/Ticket/Intake共享锁及2秒SQL等待上限；提交前后和HTTP返回前再次校验当前身份。跨账号、Bot、篡改ref和失效保留期均失败关闭；ETag不是权限依据。已经交付的内容不能被撤回。

6. 持久约束：无DDL，reporter_access_session.grant_id 的 NOT NULL UNIQUE及Grant消费语义不变。网页登录只创建有界内存身份，不新建持久Reporter Session或Grant。授权Timeline使用既有访问审计，session_id/grant_id/actor_principal_id为NULL；缺失身份可在DB前拒绝。没有第二套Ticket事实源。

7. 旧Grant：ISSUED、CONSUMED、EXPIRED在当前HMAC/原始摘要仍有效且ref/归属/业务保留期有效时，仅作定位；不消费、不复活、不延长权限。REVOKED、签名伪造、密钥轮换失效、错误绑定拒绝。缺失、过期、重启后或跨浏览器continuation返回统一404 HTML，提示重新点击原卡片，不披露工单。

8. 旧API：MEMBER_REQUIRED下exchange始终拒绝；bootstrap只返回安全成员状态；logout两个别名语义一致。旧Reporter Cookie、Grant、public_ref及混入另一账号Cookie均不能绕过当前成员归属。17条实际路由/方法与两个OpenAPI同步；Host、Origin、POST、query/body、重定向均闭集校验。详见 p2-g2-yxx-entry-route-audit.json。

9. 浏览器：真实Edge测试多标签、同浏览器并行首跳/回调、重复点击、认证过期、退出、账号替换及晚到SQL/页面响应。每个intent保留独立ref；服务端身份替换不依赖旧Cookie快照。显式begin/prepare刷新20分钟binding，15分钟Session不随轮询续期。实际history back与合成persisted pageshow分支均验证清空及重鉴权；没有声称Edge在该次导航实际命中BFCache。桌面1440和移动390截图保存在screenshots目录；Shanghai时间在UTC/Tokyo/NewYork浏览器保持一致。

10. 页面复用既有Reporter布局、安全详情及Safe Timeline，Incident里程碑经同一适配器按当前资格过滤。内部备注、原始消息和其他报告者信息不外露；关闭工单仍可在保留期内只读。五秒可见页轮询、单次在途、取消与generation fence防止旧内容回显；详情加Timeline都成功后才接受ETag，Timeline503恢复可补齐。

11. Profile：OAUTH_ONLY零DB、无业务API；MEMBER_TICKET_READONLY只启唯一App、认证、单Ticket查询和访问审计；FULL_SERVICE_LOOP复用原App装配，成员Cookie不是工作台身份。三者均在隔离夹具运行，包含真实Node子进程停启。生产启动器--serve、云端切换及真实服务均未执行；没有新增Worker或发送器，原完整回归使用模拟传输。

12. 证据：48个YXX场景、37个G2场景、202条来源执行分账及10条PR #6不变量都绑定本指纹与实际TAP。SPEC/STANDARDS独立PASS，未解决项0。成员矩阵重建冻结场景对应名称及文件hash，成员run必须与父级已验证run/ref完全一致。失败与中间1022 PASS按原顺序保留在regression-history；最终来源以JSON sources及父报告source_evidence为准。

13. 历史分母：122条正常输入、80条机制/其他引用保持不变；分类指标仍基于106个可比终态、109个可测场景，不把安全路由覆盖率写成分类准确率。每个分类/建单/审核实际诊断重新核验；既有语义限制没有被本入口消除。PR #7原始证据及就绪快照保留。

14. 副作用：migrations001–032、package.json、package-lock.json无变更；目录含columns/constraints/indexes/functions/triggers/extensions前后摘要相同；业务表摘要相同（明确排除允许的访问审计）。网页登录不建立Direct Leg、不授予私人发送资格。真实企业微信接口/SDK、真实业务数据、真实发送及AI/OCR/RAG调用均0；持久Feature Flag默认false。仅隔离夹具使用测试开关。

15. 资源与清理：100个认证会话、32个同时读取、33rd=503；pool峰值4，结束排队0；该短时测量428ms，RSS 91934720→97763328字节。用--expose-gc，非自然GC整栈2C4G/60分钟验收。测试finally关闭自有App、代理、浏览器、子进程、连接池并删除独立DB/TLS/profile；外部pool留给调用方。Evidence、截图、忽略的tmp运行/资料副本有意保留，历史受保护profile与全局Temp未清理。最终清理复核另见cleanup receipt。

16. 用户.gitignore：工作区字节SHA256 8852c9ee0697ae9926740b9fcce83326cfb88f2022a205e878bcd508c1c21233；index blob f30bbeadaa0304c2436e8298514c76d550c51246。保持原用户修改，未修改、未暂存、未提交；其他源码和文档仅按明确allowlist提交。

17. 后续最少许可：确切commit/tree/fingerprint、批准企业/应用/Agent/Bot身份对应证明、合成别名A/B与指定既有测试工单/保留期、只读数据范围、唯一App/proxy发布及回滚窗口、责任人和停止条件。发送新卡片需额外目标/数量许可；secret经受保护配置交付，不要求在聊天粘贴。完整模板见 docs/runbooks/yixiaoxiu-member-ticket-entry.md。

18. 停止：本轮无push、PR、merge、tag、release、云端发布、真实发送、正式60分钟观察或负责人Gate批准。P2-G2-LIVE、P2-008、后续AI/OCR/RAG、医院内网、P3、Phase2 Go及生产/临床上线均未启动或授权。
