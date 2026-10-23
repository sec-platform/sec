# 六工具的设计结构载体

本目录是[六工具规范](../../docs/开发/工具协议/六工具与请求.md#tool-schema-design-boundary)的设计结构，未接入生产 handler，不代表当前产品支持。准确协议修订必须在发布时绑定结构内容、严格 decoder、真实语义消费者与符合性向量；名字中的 `/2` 不替代这些条件。

| 结构 | 原责任及消费范围 | Schema 外仍须验证 |
|---|---|---|
| blueprint-read-1 | 协商后 query(view=blueprint) 的严格 Target root/section 读取及只读 TargetProjectPlanProjection | Plan producer、当前根和权限、分页覆盖、投影代、新鲜度、非公开位置；不拥有第二份计划源码 |
| cli-session-1 | strict JSONL 会话九类帧；ready以id→准确修订固定本会话的decoder/consumer选择 | 首Call前接受/拒绝、重复字节键拒绝、六工具独立解码、callId重放与真实requestId查回、升级重连、受限输出、保留与关闭责任 |
| check-method-1 | 经协商在原 check 上请求一个固定的 VerificationMethodSelection、准确被检主体与必要输入 | 原Claim/Assurance判断、真实Runner/权限与证据来源，不能借MethodRef自签检查绿灯 |
| debug-session-1 | 协商后的 launch/attach、query(debug-targets) 及 pause/continue/step/breakpoints/detach/terminate 精确互斥字段 | 暂停和配置代、Host/Driver真实停止与披露、效果权、未决命令、源映射和读取不执行目标代码 |
| compute-run-1 | 协商后的 operation start 三分支：完整制品构建、制品运行、候选入口即时编译运行；不同入口/参数互斥 | 当前Artifact/Candidate、Runner/Target/Grant、环境、启动/完成/取消/重试与RunRecord真实读回 |
| input-preparation-1 | 协商后 propose.draft(prepare-input) 的 arguments/cases/observation被动值与process-input准确字节、互斥主体及prepared/needs-input结果 | 真实类型/端点合同、严格编码与有界捕获、当前值绑定、准备方法、寿命/权限；不执行表达式、发现测试、推进输入头或发送进程输入 |
| semantic-change-1 | 单一作者候选变化：set-input/replace-expression/rename 和受限定扩展、仅在合格创建声明内使用的局部标签、前提与真实联合组 | 原SourceOwner句柄/类型/效果、真实前像、组依赖、Method登记与权限；不是另一种直接写盘协议 |
| authoring-assist-1 | 可协商 query(candidateRef,assist) 七类位置请求和 propose.draft(author-edit)；逐kind条目与源坐标的封闭机器联合 | 真实版本/编码/权限、Language/Native Provider、EditPlan全体修改与已接受写者同义；旧端严格拒绝 |
| intent-authoring-1 | 可协商的 query intentCatalog/intentOccurrence 与 propose.draft(intent-action) 精确输入；Catalog/Occurrence 投影的封闭条目 | 描述符、源身份、角色/值 codec、默认、权限/披露、负依赖、操作实际写入资格；结构成立不产生Method或Effect |
| query-2 | 基础 at/find/view/limit/cursor | find 的对象领域、引用/范围、当前披露、真实分页覆盖；Json 只证明载体形状 |
| propose-2 | 六个互斥候选输入槽；无原作者前像的 source / files(new) 禁止 `return=diff`；files 保留现行 context | 源/路径角色、base 与前像、edits 唯一匹配、return=diff 的源基础、区域权限、形成候选的语义 |
| preview-2 | source/candidate/context+entry/draft 四个槽及 compareTo 条件 | 固定解释、Target、Artifact 关联、真实 lowering 与范围 |
| check-2 | types/cases 方法选择，cases 要求 artifactRef/casesRef | 真实方法执行、被测主体、独立期望、Evidence 资格与复用 |
| apply-2 | save-source/write-output；后者必需 artifactRef | 当前授权、准确前像、作用身份/去重、真实输出与持久 readback |
| operation-2 | 原操作状态；带 controlRef 的控制；scopeRef+requestId 事前查回 | controlRef 的真实当前代/关联、查回先于新作用、原 Operation/Attempt 的未决和结算 |
| generated-edit-1 | 仅在准确协商时接入显式 draft | Artifact/SourceMap、occurrence/definition 范围、保持与回源写权 |
| structured-files-1 | 可选 fileProfiles 扩展，不撤销旧 files/context；无作者base不得请求 diff | 映射只覆盖本批实际新角色、删除无 profile、已有角色不得借此迁移、引用可解析与路径安全 |
| result-view-2 | 独立协商的紧凑结果投影；代码非空、Claim通过/失败有证据引用、字节范围成对 | requested/complete/incomplete 集合关系、各路径唯一及合法归属、真实 basis/引用/字节定位、Claim/Evidence资格、效果存在性与披露 |

propose/preview 基础结构中 `draft:false` 是尚未装入任何已协商扩展时的拒绝槽。实际消费者从准确已锁定扩展注册表编译选择相应联合；不能以 false 声称所有 draft 已支持，也不能改成任意 JSON 放弃验证。intent-action、input-preparation、author-edit、compute-run、debug/process 等扩展仍由现行对应规范定义，未选择的能力明确拒绝。query 的新 view 同理不能直接混进基础枚举。

所有结构先经过有界严格字节解码；解析器须在重复键被覆盖前拒绝，禁止非法 UTF-8、非有限数字、非法数值域和原型污染路径。JSON Schema 检查已解析值，不能补回这些已丢区别，也不能验证真实身份、权限、外部状态或副作用。缺失、null、未知和显式默认各按原合同解释。

生成类型/静态结构校验、生产 decoder 加载、方法真实执行、当前采用、外部效果和系统符合性分别报告。当前只提供设计结构与其有限静态验证，生产进程加载及行为均为 UNVERIFIED。
