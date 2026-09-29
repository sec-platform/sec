---
name: worker-development
description: 用于在 frozen Task Envelope 内实现一个 SEC 产品、修复或重构纵切片，提交 Reconciliation Delta，并把已明确授权的仓库终态推进到 settlement/readback；不用于 DAG、凭空取得 hosted Gate/merge 权限或跨 owner 改动。
---

# worker-development

## 触发
- 已收到 exact base、branch、owned/forbidden paths、acceptance、focused verification closure，且需要的测试语义已经冻结。

## 不触发
- active pointer unresolved；需要改 Work Package、authority、跨 owner 设计，或必须改变 Claim/oracle/测试退役判断；后一类返回 `test-design-required`。

## 输入
- Task Capsule/Operation Envelope、相关 owner/types/source、当前 failing reproduction 与已选择的 Action closure。
- 当前用户授权的可观察仓库终态，以及该授权是否只到本地候选、分支检查点、目标远端/default ref 或产品发布。

## 前置门禁
- Envelope完整、base未漂移、用户修正已reconcile。

## 执行
1. 只读 Capsule 指定的 authority/types/source 与 unresolved frontier；禁止默认全仓扫描。
2. 实现最小完整纵切片；检查与变换保持不同 effect owner，检查不得隐式改写 source/index。
3. 可以 materialize 已冻结的 test body/fixture/adapter；若出现新的 proof 缺口或必须改变测试语义，向主线程 A0 回交 `test-design-required` 及最小反例。A0 在已有授权内补齐设计后续交同一任务，这不是用户审批点；Worker 不在 implement 中自行改变 Claim/oracle。
4. 开发中只执行会改变当前实现选择的 failing/focused sentinel；即将被后续编辑失效的 Action 不启动。
5. candidate 稳定后消费 selector 的 `RequiredClosure ∩ MissingOrStale`，每个 ActionKey 最多一次 physical start；fresh PASS、unchanged FAIL 与 authenticated in-flight 分别 reuse、stop、join。
6. 只 stage Envelope owned paths，materialize 同一 logical run 的新 generation；finding 在同一 worktree/ref 修复，不创建 successor worktree。
7. 返回 exact base/head/tree、changed symbols、Action/Evidence delta、blocker 与 next seam。

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
- `local-candidate`或`branch-checkpoint`授权：Reconciliation Delta、exact base/head/tree、changed symbols、Action results与Evidence delta。
- `target-ref-updated`授权：上述证据，加远端目标ref与内容readback、必需Gate结果、集成身份及本任务branch/worktree residue结算；commit、push或PR任一中间状态都不是完成。

## 停止与恢复
- acceptance满足并提交 Reconciliation Delta；或触发 proof reset/authority blocker/`test-design-required`。
- 已授权`target-ref-updated`且仍有合法下一动作时不得在本地验证、commit、push、PR创建或传输路径拒绝后停止；按原候选和授权终态恢复。只有外部authority不可得、需要扩大效果或typed控制面阻塞时才返回用户。
- 普通失败回实现；重复 frozen root-cause invalidation 交给 failure owner 产生 typed proof-reset decision。

## 禁止捷径
- 不运行重复 Action、日常 Full 或未被 selector 选择的 Risk。
- 不自行改变 Claim/oracle/测试退役语义，不弱化 assertion、扩大 timeout、增加 sleep/retry/skip 来换绿色。
- 普通测试失败不自动计为 candidate invalidation。
