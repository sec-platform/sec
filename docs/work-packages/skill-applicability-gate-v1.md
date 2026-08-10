---
schema: codex-development-work-package-v1
id: skill-applicability-gate-v1
tracking: issue-275
base: 7543d37ad733432cbc2ddddd205c98f574e882c4
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: skill-applicability-gate
    owner: development-governance-maintainer
    ownedPaths:
      - AGENTS.md
      - docs/development-governance.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/skill-applicability-gate-v1.md
      - docs/work-packages/verification-action-trusted-cutover-v10.md
      - platform/shared/agent-skill-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - scripts/codex/skill-applicability.ts
      - tests/contract/skill-applicability.test.ts
      - tests/unit/skill-applicability-decision.test.ts
forbiddenPaths:
  - .codex/
  - .github/workflows/
  - .githooks/
  - docs/product.md
  - docs/roadmap.md
  - docs/verification-governance.md
  - platform/compiler/
  - platform/orchestrator/pipeline-orchestrator.ts
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/windows-appcontainer-executor.ts
  - scripts/ci-verification.ts
  - scripts/codex/branch-closeout-contract.ts
  - scripts/codex/branch-lifecycle-command.ts
  - scripts/codex/branch-lifecycle-inventory.ts
  - scripts/codex/branch-lifecycle.ts
  - scripts/codex/integration-authorization-publication.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/sec-merge-bootstrap-contract.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/verification-action-journal.ts
  - scripts/codex/verification-action-runner.ts
  - scripts/codex/verification-candidate-tree.ts
  - scripts/codex/verification-session-github.ts
  - scripts/codex/verification-session-journal.ts
  - scripts/codex/verification-session-runtime.ts
  - scripts/codex/verification-session.ts
acceptance:
  - 所有运行时 Skill 选择为 zero-or-one、trusted、operation-scoped
  - 简单 operation 无候选时返回 none-required，不制造额外流程
  - 多候选无唯一 operation 证据返回 ambiguous，不按文件顺序或 ID 选取
  - Skill 要求超出 authorized write/resource/Gate 返回 conflict
  - goal、role、operation、capsule 或 trusted revision 变化使旧 decision 失效为 stale
  - candidate 修改 AGENTS、.agents、Skill registry 或 applicability 代码时绑定 trusted revision guidance，不得自授权
  - superseded Skill 即使格式与 coverage 正确也不得加载
  - zero 候选不得触发 catch-all 自动创建
  - path coverage 只作候选提示，不再冒充 runtime selector
  - 至少一个真实 repository operation 消费 decision
  - 不实现 LLM 自然语言评分、通用行为 DSL 或新的 Agent OS
tests:
  - tests/contract/agent-skills.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/skill-applicability.test.ts
  - tests/contract/test-impact.test.ts
  - tests/unit/agent-skill-markdown-classification.test.ts
  - tests/unit/skill-applicability-decision.test.ts
---

# Work Package: Skill Applicability Gate v1（Issue #275）

## 本窗口事实（V10 收口）

前一 Work Package `verification-action-trusted-cutover-v10` 已按 frozen manifest 合入
`main@7543d37ad733432cbc2ddddd205c98f574e882c4`（2026-08-10）。merge commit 携带：

- `Manifest-Digest: sha256:91a06d6c531efeb6a7078e07de7b5ccdf7bfec61729eddf7f2ce5e41d1bdd15b`，
  与已删除的 bridge manifest 无关，与当前 main 上同名文件字节一致；
- `Independent-Exact-Head-Review: P0=0 P1=0 P2=0`；
- `Manual-Transition-Receipt: sha256:151d931ac882716aa948560819c8ee923d9e5a2ce0aaa5ddf177aa15d625ced9`
  与 `Manual-Control-Digest`、`TCB-Trust-Revision` 绑定 exact base/head/tree；
- new-main readback 由 merge 后的 exact tree 完成；旧 Review/Gate/Evidence/Session/
  bootstrap receipt 全部 stale，不得复用为本包证据。

`TASK_RESTART_REQUIRED` 由本新会话满足：本包在 V10 收口后的新 main 上独立启动，
不再续用旧运行态。

## 目标（Issue #275 第一实施切片）

1. 从当前真实 Skill registry（`platform/shared/agent-skill-contract.ts`）提取 minimal
   machine metadata，不新增 Skill；
2. pure applicability validator/decision：状态
   `applicable | none-required | ambiguous | stale | conflict | not-applicable | unresolved`；
3. `none-required` first-class：简单读取、格式修复或已明确 Operation 无需加载 Skill；
4. multi-match 无唯一 operation 证据 → `ambiguous`，不得按文件顺序/ID/最新修改选取；
5. scope/capability intersection：Skill 要求的 write/read path、authority、resource、
   tool、Gate 必须是授权集合子集，否则 `conflict`；
6. trusted-vs-candidate Skill revision quarantine：candidate 修改 AGENTS、.agents、
   Skill registry、router 或 applicability 代码时，decision 与 Review 绑定 trusted
   base/main 版本，candidate 内容只作为 SUT 差异；
7. 一个真实 repository operation（`scripts/codex/skill-applicability.ts`）消费 decision；
8. path coverage 只作候选提示，不再冒充 runtime selector；
9. `docs/development-governance.md` 与 `AGENTS.md` 同步
   "zero or one applicable trusted Skill" 规则。

## 完成定义

- 所有运行时 Skill 选择为 zero-or-one、trusted、operation-scoped；
- path coverage 不再冒充 runtime selector；
- candidate guidance 无法自授权（quarantine 绑定 trusted revision）；
- Skill 无法扩大 WorkPackage/Operation/Task Capsule 范围；
- hard machineable rules 从 prose 下沉到真实代码 owner
  （`platform/shared/agent-skill-contract.ts` 与其测试）；
- 无新 catch-all Skill 或 Agent runtime；
- focused/adversarial tests、独立 Review、merge 与 new-main readback 完成。

## 重新规划硬触发器

任一条件成立立即停止并从 then-latest main 重算：

1. main、PR、branch、manifest、trust revision 或 runner input 发生未处理漂移；
2. 本包 changed path 超出 ownedPaths 或命中 forbiddenPaths；
3. decision 状态机、quarantine 或 scope intersection 的 focused/adversarial 测试缺失；
4. 任何 Skill 正文、registry 或 applicability 代码出现第二事实源；
5. 未先完成 exact-head 独立 Review 就宣称 merge-ready；
6. merge 后未先完成 exact new-main readback 就继续后续治理工作。
