---
title: Semantic Mutation 事务
status: stable
domain: semantic-mutation
last-reviewed: 2026-07-28
---

# Semantic Mutation 事务

本文拥有受限语义意图到 Authoring Source transaction 的状态机、权限分层和恢复不变量。精确请求、计划、结果、journal、diagnostic、路径算法和 retention 由 `platform/compiler/semantic-mutation/**`、共享 writer lease 与合同测试拥有。

## 权力模型

Caller 只提交 intent。Platform 独立提供 authorization、base snapshot、source ownership、operation registry 和 minimum Verification。Proposal 不能携带 path、source bytes、Fact Delta、Impact、risk、rollback、lease 或 verification reduction。

权限是交集：

```text
allowed operation
∩ semantic target
∩ source owner
∩ physical path
∩ pre/postconditions
∩ policy
∩ minimum Verification
```

## 计划与执行

```text
validate request and authorization
→ preflight without live writes
→ resolve unique source owner/adapter/path
→ isolated deterministic transform and canonical rebuild
→ actual Fact Delta
→ exact expectation and postconditions
→ Impact
→ conservative Verification union
→ acquire workspace writer lease and re-plan
→ source-byte and semantic CAS
→ atomic publish
→ live canonical rebuild
→ accepted | rejected | rolled-back | recovery-required
```

Dry-run 不写 live source。Apply 不信任旧 staging；必须在 lease 内重新读取、重新 plan 和重新验证 CAS。

## 原子性与恢复

所有 live writer 服从同一 workspace lease。发布前完成可隔离验证；发布后任何失败都进入 CAS-safe rollback。只有恢复 exact bytes 并重建 base canonical state 才能声明 rolled-back，否则保留 durable record 和 backup，进入 recovery-required。

不存在 partial-success 或 accepted-with-warning。Journal 是 transaction governance state，不是 Engineering IR 或 Authoring Source；terminal replay 只能返回 retained result，不能重新执行副作用。
