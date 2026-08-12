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

## 权限与路径
- 仅修改Envelope owned paths；forbidden paths和其他owner只读。

## 允许工具与操作
- 代码编辑、Envelope 已授权的显式 transform、selector 选择的 focused Action、Git candidate materialization。

## 前置门禁
- Envelope完整、base未漂移、用户修正已reconcile。

## 执行
1. 只读 Capsule 指定的 authority/types/source 与 unresolved frontier；禁止默认全仓扫描。
2. 实现最小完整纵切片；检查与变换保持不同 effect owner，检查不得隐式改写 source/index。
3. 开发中只执行会改变当前实现选择的 failing/focused sentinel；即将被后续编辑失效的 Action 不启动。
4. candidate 稳定后消费 selector 的 `RequiredClosure ∩ MissingOrStale`，每个 ActionKey 最多一次 physical start；fresh PASS、unchanged FAIL 与 authenticated in-flight 分别 reuse、stop、join。
5. 只 stage Envelope owned paths，materialize 同一 logical run 的新 generation；finding 在同一 worktree/ref 修复，不创建 successor worktree。
6. 返回 exact base/head/tree、changed symbols、Action/Evidence delta、blocker 与 next seam。

## 完成证据
- Reconciliation Delta、exact base/head/tree、changed symbols、Action results与Evidence delta。

## 停止与恢复
- acceptance满足并提交 Reconciliation Delta；或触发 proof reset/authority blocker。
- 普通失败回实现；重复 frozen root-cause invalidation 交给 failure owner 产生 typed proof-reset decision。

## 禁止捷径
- 不运行重复 Action、日常 Full 或未被 selector 选择的 Risk。
- 不删除测试、弱化 assertion、扩大 timeout或顺手重构。
- 普通测试失败不自动计为 candidate invalidation。

## 权威
- `AGENTS.md`
- `docs/development-governance.md`
- `docs/verification-governance.md`
