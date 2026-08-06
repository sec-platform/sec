---
schema: codex-development-work-package-v1
id: active-documentation-corpus-convergence-v2
tracking: issue-235
base: 2d7187f4fc16301e25a142bdd62340d9670a4a9f
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: documentation-corpus-lifecycle-closure
    owner: documentation-maintainer
    ownedPaths:
      - docs/README.md
      - docs/archive/
      - docs/authority.json
      - docs/evidence/
      - docs/scripts/docs-doctor.ts
      - docs/superpowers/
      - docs/work/README.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/active-documentation-corpus-convergence-v2.md
      - docs/work-packages/branch-ref-lifecycle-v1.md
      - platform/shared/documentation-authority-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - tests/contract/docs-doctor-byte-exact.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/documentation-corpus-census.test.ts
      - tests/contract/documentation-ownership-closure.test.ts
      - tests/contract/test-impact.test.ts
      - tests/fixtures/documentation-history/
      - tests/fixtures/work-package-gate-manifests/
      - tests/unit/active-documentation-contract.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/documentation-authority-registry-v2.test.ts
      - tests/unit/work-package-gate-contract.test.ts
forbiddenPaths:
  - .agents/
  - .github/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - platform/compiler/
  - platform/runtime/
  - scripts/
  - tests/e2e/
  - tsconfig.json
acceptance:
  - "The two repository-wide audits are reconciled with current main and each durable decision is routed to one existing canonical owner or focused Issue."
  - "Rolling plan contains this package and at most five conditional successors; it does not duplicate stable architecture or live GitHub state."
  - "Registry v2 assigns one lifecycle and one canonical owner to every active document; proposal disposition, targets, activation, reversal and retirement are explicit."
  - "Every tracked current-looking Markdown, YAML and JSON document is registered or has an explicit machine-only lifecycle; unclassified documents and duplicate authority fail closed."
  - "docs/README.md is a byte-exact generated projection of docs/authority.json."
  - "docs/archive is absent; narrative Markdown under docs/evidence and docs/superpowers is removed, externalized or migrated to an explicit fixture."
  - "Raw ChatGPT transcripts, private conversation URLs and historical authority copies are absent from the current documentation tree."
  - "Historical bytes still required by tests move to explicit fixtures with test-impact ownership and unchanged Git blob identity."
  - "Stable owners record the unified direction: Physical Workspace and Source Program precede Responsibility reconstruction; all product writes converge on Semantic Operation/Mutation; Verification has one physical-result truth; IR layers land only with a real consumer and legacy-writer deletion."
  - "Information lifecycle, publisher removal, external-input security, CI/Git hygiene, TCB/bootstrap and package/provider work remain owned by their focused Issues."
  - "Old PR #273 is closed as superseded; its tree is implementation input only and no old Review, Evidence or identity is reused."
  - "Exact-head scope, candidate-as-SUT validation, independent Review, required Gate, expected-head merge and new-main readback close Issue #235."
tests:
  - tests/contract/docs-doctor-byte-exact.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/documentation-corpus-census.test.ts
  - tests/contract/documentation-ownership-closure.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/active-documentation-contract.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/unit/documentation-authority-registry-v2.test.ts
  - tests/unit/work-package-gate-contract.test.ts
---

# active-documentation-corpus-convergence-v2

Issue #235 的 latest-main 重建包，固定基线为
`main@2d7187f4fc16301e25a142bdd62340d9670a4a9f`。旧 PR #273 的删除、
fixture 迁移和 registry v2 只作为差异来源；旧 base/head、Review、Evidence、
manifest digest 与 merge authority 全部失效。

## 控制面缺陷与修复

两次全仓审计最初只进入聊天、Issue #282 和旧候选，没有完成三层落点：

1. 稳定结论进入 `docs/authority.json` 已登记的唯一 owner；
2. 近期排序进入 `docs/work/rolling-plan.md`；
3. latest-main Work Package 原子接管 `active-work-package.md`。

当时 #280 处于 post-merge repair，禁止第二 formal writer。PR #283 进入
`main@2d7187f4` 后，#282 与 rolling plan 没有同步重算，形成“方案存在但当前计划
不可执行”的漂移。本包修复该漂移，不建立第二架构总纲。

## 统一架构裁决

```text
Physical Workspace
→ Source Program Model
→ Responsibility candidates
→ canonical Engineering Semantics
→ Delta / Impact
→ Engineering Operation / Authorization
→ Semantic Mutation transaction
→ physical Verification / Evidence
→ accepted canonical revision
→ Application IR / Behavior IR / Target Program IR
→ Backend / Artifact
```

- `main` 只证明 Presence；Integration Authority、Verification Health 与 Trust
  Eligibility 分别由各自机器 owner 和 physical Evidence 证明。
- 治理系统只服务产品主链。新通用 schema/receipt/registry/selector/kernel 必须有
  当前 consumer、唯一 owner、明确删除目标和停止条件，否则保持 Issue/Proposal。
- Workbench、CLI、HTTP 与 AI 只提交 Engineering Operation；受治理写入最终统一进入
  Semantic Mutation 的 authorization、CAS、journal、Verification 与 recovery。
- Physical execution 直接产生 canonical Gate Result；CI、tracked report、GitHub status、
  CLI 与 PR summary 只是投影。占位 identity、自报 health 和 legacy reconstruction
  不取得 authority。
- 当前 Engineering IR/Semantic Contract 是有效声明内核，但下一产品纵切片必须从真实
  TypeScript source/symbol/type/span/control/data/effect/state 生成 Responsibility
  candidates 并保留 unknown/opaque。
- Application/Behavior/Target Program IR 只随真实 artifact owner 落地，并在同一迁移
  删除旧 template/writer，禁止无 consumer 空壳。
- 当前 Git tree 只保留当前产品、stable authority、机器控制状态、有效结构化 Evidence、
  必要 fixture 和有现实 consumer 的工具。原始聊天、叙事审计、旧 authority、运行日志、
  本机路径和临时交接物退出 current lookup。

## 唯一 owner 路由

| 决策族 | Owner |
|---|---|
| 文档生命周期与当前树收缩 | #235 |
| 全 tracked-tree 信息分类 | #282 |
| 默认分支 Integration authority | #279 |
| 外部文本非指令边界 | #244 |
| public publisher / history-preserving release | #247 |
| commit、Action、AI attribution hygiene | #248 |
| Verification 单真值 / legacy 退役 | #237 / #239 |
| TCB/bootstrap | #178 / #279 |
| package/provider 分层 | #193 |
| Physical Workspace / Source Program | Brownfield owner |
| Responsibility reconstruction | #224 |
| 多包并行 | #207；只在单候选集成闭环稳定后激活 |

## 执行

```text
freeze latest-main manifest/pointer
→ migrate durable audit decisions to canonical owners
→ transplant old #273 deletion/fixture changes
→ remove archive/raw-chat/narrative copies
→ enforce registry v2 and byte-exact navigation
→ exact-tree census and focused validation
→ independent exact-head Review
→ required Gate / trust transition
→ expected-head squash merge and new-main readback
→ close #235 and superseded #273
→ activate #282
```

## 非目标

不修改 workflow、ruleset、publisher、package/lock、Agent Skill 或产品 Compiler；
不提交两次审计全文；不新建第二 audit、roadmap 或 Integration state machine；
不把文档删除冒充 Source Program、Verification migration、release 或并行完成。
