---
name: sec-architecture-change
description: "分析或规划 SEC canonical IR、identity/revision、Semantic Contract/Responsibility、Pipeline、transaction/recovery、provenance、Registry/Block 或 AI 权限边界变化；普通局部实现不要触发。"
---

# SEC Architecture Change

本 Skill 用于高影响架构变化的 contract-first 分析。默认先审查和冻结边界，再实现。

## 必读

- `docs/00`、`docs/02`、`docs/03`、`docs/04`
- 与变化对应的 `docs/05–14`
- 公共类型、canonical builder/producer、facade/orchestrator
- contract/invariant/integration tests
- 当前 active Work Package plan

## 分析维度

对每个变化明确：

1. canonical state 与唯一 owner；
2. 输入、输出和 public boundary；
3. stable Entity/Fact identity 与 revision 算法；
4. lifecycle、状态机和允许 transition；
5. error taxonomy、diagnostic precedence；
6. transaction、journal、atomicity、rollback/recovery；
7. determinism、idempotency、reentrancy、fixed-point；
8. concurrency、single-writer、lease/CAS；
9. provenance、Explain/Review projection 与 impact；
10. compatibility、migration、versioning；
11. AI/Workbench mutation permission boundary；
12. 可能形成的第二事实源、旁路或职责泄漏。

## 执行顺序

```text
current evidence
→ authority conflict/unknowns
→ canonical ownership decision
→ contract/schema/state machine
→ invariant tests
→ implementation DAG
→ consumer migration
→ verification and closeout
```

不得因为现有代码容易修改而降低理论目标；不得用 consumer 形状反推 canonical IR；不得复用语义不同的 journal、lock、projection 或 evidence 结构。

可委派 `architecture-reviewer` 做 read-only 独立审查。输出必须给出具体 file/symbol 证据、推荐 owner、禁止重叠范围、兼容/恢复策略和验收条件。长期裁决归位到对应 authority，当前执行编排归位到 active Work Package plan。
