---
name: sec-worker-development
description: 用于在 frozen Task Envelope 内实现一个 SEC 产品、修复或重构纵切片并提交 Reconciliation Delta；不用于 DAG、merge、hosted Gate 或跨 owner 改动。
---

# sec-worker-development

## 触发
- 已收到 exact base、branch、owned/forbidden paths、acceptance和focused tests。

## 不触发
- active pointer unresolved；需要改 Work Package、authority或跨 owner设计。

## 输入
- Task Capsule/Operation Envelope、相关 owner/types/source、当前 failing reproduction 与已选择的 Action closure。

## 前置门禁
- Envelope完整、base未漂移、用户修正已reconcile。

## 执行
1. 只读 Capsule 指定的 authority/types/source 与 unresolved frontier；禁止默认全仓扫描。
2. 实现最小完整纵切片；检查与变换保持不同 effect owner，检查不得隐式改写 source/index。
3. 开发中只执行会改变当前实现选择的 failing/focused sentinel；即将被后续编辑失效的 Action 不启动。
4. candidate 稳定后消费 selector 的 `RequiredClosure ∩ MissingOrStale`，每个 ActionKey 最多一次 physical start；fresh PASS、unchanged FAIL 与 authenticated in-flight 分别 reuse、stop、join。
5. 只 stage Envelope owned paths，materialize 同一 logical run 的新 generation；finding 在同一 worktree/ref 修复，不创建 successor worktree。
6. 返回 exact base/head/tree、changed symbols、Action/Evidence delta、blocker 与 next seam。

## 已授权提交与中断续接

- 提交前重新发现当前可用动作，不能继承前轮“只读”或“可写”的结论。带关键词的发现为空只证明过滤没有命中；在断言能力缺失前，读取一次未过滤的当前工具目录及具体写动作合同。区分未发现动作、暂时读取失败、服务端拒绝和结果未知，不以历史聊天代替当前事实。
- 只使用当前授权范围内的正式提交入口或已暴露且合同匹配的 Git/GitHub 写动作。动作存在不补齐 Work Package、Scope/Effect、机器准入或合并资格；真实权限、保护或安全拒绝不能靠换身份、换 Provider、关门禁、强推或隐藏写入来绕过。
- 先接续同一任务已有候选。绑定当前分支 HEAD、完整文件前像、文件模式和候选 blob；源文件只读到片段时不得用片段替换完整文件。保留未变字节和无关并发改动；前像或授权变化才重建受影响部分，不从旧计划重新实现已完成代码。
- 复用原工作记录保存最小发布断点：目标仓库与 ref、基准 commit、候选文件对象、tree、commit、ref 写入结果及最后一次回读。记录是可重建的操作回执，不是新的权限或完成台账，不保存凭据、令牌或私有下载授权参数。
- blob/tree 已存在不是入库。commit 已创建但 ref 尚未推进时，续接这个 commit，不重建一个只改提交说明的副本。正常更新必须保留并发历史；拒绝非快进时先读当前 ref、比较祖先与文件变化，再重算必要合入，不能强制覆盖。
- 写入超时或响应遗失时，先查询对应对象和 ref：目标已在分支历史中则记录实际成功；未能证实则保留“结果未知”，不自动重发可重复副作用。只有在原动作支持且前置身份仍成立时才重试。
- “已入库”必须以远端 ref 的精确 commit 或已验证祖先关系，以及目标文件内容回读为依据。之后在原台账更新已实现、已验证、已入库、待验收和下一未闭合入口。台账更新失败不撤销已确认源码提交；源码未入库也不能用评论或 ZIP 顶替。
- 分支检查点、PR 合并、产品发布分别授权和记录。开发检查点的验证缺口必须显式保留，不因推送成功标绿，也不因 PR 为 Draft 就把已推送源码重新说成未入库。工具暴露与外部权限可变化，本路由不承诺永久可写。

## 完成证据
- Reconciliation Delta、exact base/head/tree、changed symbols、Action results与Evidence delta。

## 停止与恢复
- acceptance满足并提交 Reconciliation Delta；或触发 proof reset/authority blocker。
- 普通失败回实现；重复 frozen root-cause invalidation 交给 failure owner 产生 typed proof-reset decision。

## 禁止捷径
- 不运行重复 Action、日常 Full 或未被 selector 选择的 Risk。
- 不删除测试、弱化 assertion、扩大 timeout或顺手重构。
- 普通测试失败不自动计为 candidate invalidation。
