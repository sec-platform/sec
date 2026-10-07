---
name: worker-development
description: 用于在 frozen Task Envelope 内实现一个 SEC 产品、修复或重构纵切片，提交 Reconciliation Delta，并把已明确授权的仓库终态推进到 settlement/readback；不用于 DAG、凭空取得 hosted Gate/merge 权限或跨 owner 改动。
---

# worker-development

## 当前归属
准入、读取和角色回交归[仓库行为路由](../../../docs/开发/AI协作/规则装载与任务恢复.md#engineering-behavior-routing)；验证与证据复用归[测试发现与执行](../../../docs/开发/测试发现与执行.md#developer-check-loop)，提交/未知效果归[持久化恢复](../../../docs/运行/持久化提交与恢复.md)，依赖代际与路径保留归[宿主生态](../../../docs/运行/宿主生态与技术约束.md#依赖解析物化与垃圾回收)。只消费与本Envelope相交的合同。

## 触发
- 已收到 exact base、branch、owned/forbidden paths、acceptance、focused verification closure，且需要的测试语义已经冻结。

## 不触发
- 需要改 Work Package、authority、跨 owner 设计，或必须改变 Claim/oracle/测试退役判断；后一类返回 `test-design-required`。active pointer unresolved阻断依赖它的正式实施／作用准入；已有明确授权的有界源码提案按下述前置条件判断，不凭Skill补发operation。

## 输入
- Task Capsule/Operation Envelope、相关 owner/types/source、当前 failing reproduction 与已选择的 Action closure。
- 当前用户授权的可观察仓库终态，以及该授权是否只到本地候选、分支检查点、目标远端/default ref 或产品发布。

## 前置门禁
- Envelope完整、固定base与必要前像可核、用户修正已reconcile；原Capsule能定位[完整变化闭包](../../../docs/维护/规格写作与完整性.md#complete-change-closure)。设计引用缺失或不能解释相交消费者／失败恢复时，先回原owner补齐，不能边改局部代码边默认架构已闭合。
- 区分固定提案主体、独立分支检查点与当前集成资格：main前进不自动改变旧base、owned前像或已有Evidence。若已经明确授权在隔离写集中继续源码提案，先核main delta是否与必需owner、输入闭包或读写前像相交；只重算相交部分，保持原patch和有效证据。正式activation、Work Package freeze与集成仍由各自owner绑定当前对象；源码提案不携带commit、push或merge资格，独立检查点逐动作消费下述既有准入。
- status因rolling/live-main不匹配而未能给出continuation时，保留准确失败交原resolver／Work Package owner；未取得上述独立提案授权或无法界定交集时不继续依赖该准入的写入。不得手改控制投影、重放旧grant或以相同源码冒称新main已验证；缺失的机器continuation属于原owner实现缺口，修改Skill不等于该路径已接通。

## 执行
1. 读取 Capsule 指定的 authority/types/source 与 unresolved frontier，并核AGENTS要求的同版相交产品/原则/设计是否已取得；缺必要依赖时向原read-plan owner补闭包，不以Capsule省略推定不适用。禁止默认全仓扫描。
2. 实现最小完整纵切片；检查与变换保持不同 effect owner，检查不得隐式改写 source/index。
3. 可以 materialize 已冻结的 test body/fixture/adapter；若出现新的 proof 缺口或必须改变测试语义，向主协调者（当前机器角色 `a0`）回交 `test-design-required` 及最小反例。该协调者在已有授权内补齐设计后续交同一任务；这一内部回交不形成新的授权边界，超出现有授权的作用仍由原 owner 重新准入；Worker 不在 implement 中自行改变 Claim/oracle。
4. 开发中只执行会改变当前实现选择的 failing/focused sentinel；即将被后续编辑失效的 Action 不启动。
5. candidate稳定后消费selector的`RequiredClosure ∩ MissingOrStale`；在取得新依赖projection或启动进程前先查fresh PASS、unchanged FAIL与authenticated in-flight，分别reuse、stop、join。重试资格由原owner按attempt/错误分类决定；不得把“每个ActionKey一次”扩大为禁止合同允许的瞬态恢复。新物理开始由真实资源owner准入，配置worker数不是已执行并发证明。
6. 经真实提交准入只 stage Envelope owned paths，按下述独立检查点与最终集成的边界materialize 同一 logical run 的新 generation；finding 在同一 worktree/ref 修复，不创建 successor worktree。**Branch/ref 是进行中差异的临时载体，不是历史档案。** 每个非默认 ref 在创建时必须有当前 owner、唯一任务/候选身份、可观察终态与 retirement responsibility；同一任务默认复用原 ref，只有确有独立并行主体、不可变审查主体或恢复前置时才允许新 ref。新候选替代旧候选后，旧 ref 不得因 checkpoint/source/recovery/qualification/transport 命名而自动保留；在确认其唯一源码/证据/恢复消费者已由 main、后继对象或 durable receipt 承接后，由原 lifecycle owner 按 exact identity、recovery、CAS 与 readback 合同及时退役。工作完成若仍留下无独立消费者的临时 ref，属于未结算 residue，不能报告仓库终态完成；禁止以递增 `-v2/-v3/-newN/-isolated` 分支替代同一 ref 上的正常修复、重基或候选更新。
7. 完成前检查本次维护者修正或行为变化是否触发[heuristic-governance](../heuristic-governance/SKILL.md)；相交时调用该既有owner并消费其完成证据，不在Worker中重建纠错算法。核对相交规则、唯一owner入口、实际消费者与持久决策的一致性，并在各自原owner同步真实变化；已有规则已覆盖反例时修复执行或接合，不另写重复规则或操作规程。规范语义未变时遵守AGENTS的docs写入准入；未闭合项保留owner、影响与恢复条件，不能仅在聊天中确认后宣称完成。
8. 返回exact base/head/tree、changed symbols、Action/Evidence delta、blocker与next seam；分开源码检查、fixture/隔离运行、真实平台作用及未验证范围。冻结patch/manifest等交付保存在有明确保留责任的任务制品位置并回读，不能只交指向可淘汰cache的路径；这不授权归档整套依赖或另建恢复owner。

## 独立源码检查点与最终集成

- 独立性先按源码owner、必需输入与读写前像判断。源码已稳定且具有明确授权的独立任务scope时，使用正式`dev commit`的staged-candidate与提交Effect owner形成source-only分支检查点；它绑定准确本地ref、parent、index/tree和规范化结果，不以先改共享Work Package投影为条件。按[原owner分流](../../../docs/开发/AI协作/规则装载与任务恢复.md#source-checkpoint-publication)，独立检查点消费明确用户授权、固定scope与具体提交／传输Effect准入，不依赖正式工作选择、active Work／operation、MainHealth或Gate；不伪造这些结果。先用`dev:status -- --source-checkpoint --base <exact-sha> --expected-head <exact-sha> --owned-path <exact-path>`取得有界观察，再由原Effect owner重验；入口参数和观察结果都不是授权，既有未结Git操作与未知作用继续交原owner结算。
- source-only检查点只包含本次owned源码，不为证明进度预先生成或搬运最终集成的共享控制投影。冻结exact head/tree后由独立Reviewer完成相交源码审查，再在已明确授权的目标分支范围内推送并回读。任何会自动触发hosted检查的发布动作仍受AGENTS的hosted evidence budget约束；源码检查点不签发active Work、正式Gate、adoption或merge资格。
- 共享active pointer、rolling、前任manifest退役及需组合源树重算的派生制品，由原integration owner在实际集成base与写入窗口就绪后，调用各自正式producer生成并核验。不要让每个独立源码分支提前争写这些控制，也不把等待最终控制、验收或merge变成独立合法源码工作的前置。需要改变Work Package的Worker仍回交其原owner，不自行手改投影或制造第二冻结入口。
- 集成时复用准确绑定且未失效的源码、focused Evidence与源码审查结论，只重算main delta实际影响的前像、owner和输入闭包。旧head/tree的Review、Gate与控制投影保留原绑定，不能直接充作新集成候选的通过；当前base/head/tree、Work Package与组合结果仍须原owner重新准入和核验。仅最终候选就绪后取得所需exact-head审查与缺失／失效的hosted证据；旧候选的恢复、迁移和残留义务不因延后投影或采用新main消失。

## 已授权提交与中断续接

- 提交前重新发现当前可用动作，不能继承前轮“只读”或“可写”的结论。带关键词的发现为空只证明过滤没有命中；在断言能力缺失前，读取一次未过滤的当前工具目录及具体写动作合同。区分未发现动作、暂时读取失败、服务端拒绝和结果未知，不以历史聊天代替当前事实。
- 只使用当前授权范围内的正式提交入口或已暴露且合同匹配的 Git/GitHub 写动作。动作存在不补齐 Work Package、Scope/Effect、机器准入或合并资格；真实权限、保护或安全拒绝不能靠换身份、换 Provider、关门禁、强推或隐藏写入来绕过。
- 授权绑定可观察效果，不绑定最初尝试的命令名。先把授权规范化为`local-candidate | branch-checkpoint | target-ref-updated | product-released`及目标仓库/ref；普通“修复/完成”不得臆造外部写入，明确要求推送或更新目标远端/default ref也不得被降格为只做本地commit。
- 先接续同一任务已有候选。绑定当前分支 HEAD、完整文件前像、文件模式和候选 blob；源文件只读到片段时不得用片段替换完整文件。保留未变字节和无关并发改动；前像或授权变化才重建受影响部分，不从旧计划重新实现已完成代码。
- 复用原工作记录保存最小发布断点：目标仓库与 ref、基准 commit、候选文件对象、tree、commit、ref 写入结果及最后一次回读。记录是可重建的操作回执，不是新的权限或完成台账，不保存凭据、令牌或私有下载授权参数。
- blob/tree 已存在不是入库。commit 已创建但 ref 尚未推进时，续接这个 commit，不重建一个只改提交说明的副本。正常更新必须保留并发历史；拒绝非快进时先读当前 ref、比较祖先与文件变化，再重算必要合入，不能强制覆盖。
- 写入超时或响应遗失时，先查询对应对象和 ref：目标已在分支历史中则记录实际成功；未能证实则保留“结果未知”，不自动重发可重复副作用。只有在原动作支持且前置身份仍成立时才重试。
- “已入库”必须以远端 ref 的精确 commit 或已验证祖先关系，以及目标文件内容回读为依据。之后在原台账更新已实现、已验证、已入库、待验收和下一未闭合入口。台账更新失败不撤销已确认源码提交；源码未入库也不能用评论或 ZIP 顶替。
- 分支检查点、目标ref更新和产品发布是不同效果，分别授权和记录。授权只有`branch-checkpoint`时不得自行合并；授权已明确覆盖`target-ref-updated`时，Provider强制的最小branch→PR→required Gate→仓库允许的merge method只是同一效果的传输闭包，不是要求用户重复授权的新增效果，必须持续到远端ref与内容readback。路径不得扩大候选内容、目标ref、受众、权限或发布范围；若需要force、修改保护规则、绕过Gate或额外发布，则只阻断该新增效果。开发检查点的验证缺口必须显式保留，不因推送成功标绿，也不因PR为Draft就把已推送源码重新说成未入库。

## 完成证据
- 在原任务的Reconciliation Delta中记录相交规则、owner入口、消费者与持久决策的同步结论及准确修订；无需修改的给出已有覆盖依据，缺失执行的定位修复，仍未闭合的保留责任和恢复条件。
- `local-candidate`或`branch-checkpoint`授权：Reconciliation Delta、exact base/head/tree、changed symbols、Action results与Evidence delta。
- `target-ref-updated`授权：上述证据，加远端目标ref与内容readback、必需Gate结果、集成身份及本任务branch/worktree residue结算；commit、push或PR任一中间状态都不是完成。

## 停止与恢复
- acceptance满足并提交 Reconciliation Delta；或触发 proof reset/authority blocker/`test-design-required`。
- 已授权`target-ref-updated`且仍有合法下一动作时不得在本地验证、commit、push、PR创建或传输路径拒绝后停止；按原候选和授权终态恢复。发现 blocker 先交还协调 owner／对应 owner，并继续独立合法工作；只有缺用户才能提供的授权或决定时才要求用户介入。 回交时把blocker绑定到具体被阻断动作、所缺owner结果和恢复条件，并指出仍可推进的已授权动作；不能仅报“等验证／等合入”后把整个任务挂起。分支检查点可独立准入不等于验收通过，缺验收也不自动撤销已成立的检查点准入；Hosted evidence budget和未知作用的结算义务保持不变。
- 普通失败回实现；重复 frozen root-cause invalidation 交给 failure owner 产生 typed proof-reset decision。

## 禁止捷径
- 不运行重复 Action、日常 Full 或未被 selector 选择的 Risk。
- 不自行改变 Claim/oracle/测试退役语义，不弱化 assertion、扩大 timeout、增加 sleep/retry/skip 来换绿色。
- 普通测试失败不自动计为 candidate invalidation。
