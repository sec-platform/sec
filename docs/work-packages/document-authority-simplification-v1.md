---
schema: codex-development-work-package-v1
id: document-authority-simplification-v1
tracking: issue-132
base: 2513f640c91eafbe6eaecd1d33227fbfa59da11c
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: simplify-document-authority
    owner: a0
    ownedPaths:
      - AGENTS.md
      - docs/00-文档索引与一致性规则.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/governance/agent-skills-and-development-run-kernel.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work/active-work-package.md
      - docs/archive/work-packages/repository-audit-trust-root-closure-v2.md
      - docs/work-packages/repository-audit-trust-root-closure-v2.md
      - docs/work-packages/document-authority-simplification-v1.md
      - platform/shared/agent-skill-contract.ts
      - tests/contract/agent-skills.test.ts
forbiddenPaths:
  - .github/workflows/
  - .agents/skills/
  - docs/scripts/docs-doctor.ts
  - docs/test-architecture.md
  - docs/test-feedback-and-ci-lanes.md
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/test-impact-rules/
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/work-package-contract.ts
acceptance:
  - "AGENTS, docs/04 and the Skill/Kernel design document have non-overlapping responsibilities and do not maintain parallel execution protocols."
  - "Repository facts, executable hard contracts, Agent heuristics, dynamic state and exact-revision Evidence are explicitly separated; prose cannot claim enforcement without a machine owner."
  - "Unregistered Markdown under docs/ fails classification instead of inheriting catch-all Skill coverage."
  - "The fail-closed and non-blocking prose regressions live in the existing agent-governance fast test, so future governance-source changes select them without modifying verifier trust-root ownership."
  - "Product and architecture authority paths retain explicit bounded coverage; historical, Evidence and Work Package paths remain lifecycle-classified."
  - "current-state keeps only reusable resolver prerequisites and no longer acts as a manually maintained capability ledger."
  - "The previous selected Work Package is archived only after the new manifest atomically takes over the pointer."
  - "Focused Agent governance, docs doctor, repository audit, typecheck and imports verification pass on the exact candidate."
tests:
  - "bun test tests/contract/agent-skills.test.ts tests/contract/docs-doctor.test.ts tests/contract/repository-audit.test.ts tests/contract/test-impact.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run imports:freeze"
---

# 文档权威与约束生效模型简化

本包收口 SEC 仓库开发文档的权威边界和可执行性，并在现有 Agent governance fast test 内修正旧文案断言、加入 fail-closed 回归；不修改产品语义、Compiler、Workbench、CI workflow、Skill 行为或 test-impact trust root。

核心变化是删除跨 `AGENTS.md`、`04`、治理文档的平行执行协议；把能由代码、Schema、parser、test、Hook 或 CI 判断的规则称为硬合同，把必须由 Agent 判断的触发、选择、回退和停止留给唯一 Skill。任何仅存在于 prose、无法被机器观察的指标不得再冒充 merge gate。

Markdown coverage 从宽泛路径兜底改为显式受限分类：当前 canonical docs 继续被识别，新出现但未登记的 `docs/**/*.md` 必须 fail closed。回归直接进入既有 `tests/contract/agent-skills.test.ts`，因此以后修改 `AGENTS.md`、Skills、registry 或 audit source 时仍会被现有 `agent-governance` ownership 自动选择。动态控制面不再维护完整能力清单；能力事实继续由 `main` 代码、公共合同、路线图完成定义和 exact-head Evidence 共同证明。
