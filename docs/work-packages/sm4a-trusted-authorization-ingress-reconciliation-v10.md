---
schema: codex-development-work-package-v1
id: sm4a-trusted-authorization-ingress-reconciliation-v10
tracking: issue-132
base: 470f2172dca8ff443efb854bdbc78cd888d53c87
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v11
tasks:
  - id: reconcile-trusted-local-authorization-ingress
    owner: a0
    ownedPaths:
      - docs/work-packages/sm4a-trusted-authorization-ingress-reconciliation-v10.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - platform/compiler/index.ts
      - platform/compiler/semantic-mutation/source-adapter-registry.ts
      - platform/compiler/semantic-mutation/trusted-authorization-ingress.ts
      - tests/contract/semantic-mutation-source-adapter-contract.test.ts
      - tests/unit/semantic-mutation-source-adapter.test.ts
forbiddenPaths:
  - .claude/
  - .github/
  - .gitattributes
  - .githooks/
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/05-编译器核心实现规格.md
  - docs/06-Registry与Block协议规范.md
  - docs/07-Pass状态机、错误码与恢复机制.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/09-AI Runtime、任务信封与治理规范.md
  - docs/10-升级迁移与Override规范.md
  - docs/11-Workbench与可视化规范.md
  - docs/12-编译管道与行为流图示.md
  - docs/13-独立工具分发与打包规划.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - docs/scripts/
  - platform/compiler/compose/
  - platform/compiler/emit/
  - platform/compiler/ir/
  - platform/compiler/parse/
  - platform/compiler/projection/
  - platform/compiler/semantic-impact/
  - platform/orchestrator/
  - platform/shared/
  - scripts/
  - source/
  - tests/e2e/
  - tests/fixtures/
  - tests/helpers/
  - tests/integration/
acceptance:
  - "One trusted local ingress derives source owner and writable path authority only from the canonical source-adapter registry after normalized request and provenance validation."
  - "Caller policy input cannot provide authorizationRevision, task/envelope identity, source owner IDs, or path prefixes; missing, duplicate, read-only, forged, stale, or non-canonical sources fail closed."
  - "The existing resolveSemanticMutationSource public behavior and sourceResolutionRevision remain unchanged because it consumes the same extracted internal authority seam."
  - "The compiler facade exposes the trusted ingress and authority-free policy types without exposing the internal source-authority seam."
  - "Only the five retained product/test paths are replayed from bca9102; its old roadmap, Work Package, and three control-plane blobs remain absent."
  - "Focused contract and unit tests, typecheck, docs doctor, changed-only imports, control-plane lifecycle, manifest scope, and patch hygiene pass on the frozen head."
  - "The ready PR has no unresolved review or REQUEST_CHANGES, enters main, and the superseded V9 source branch is deleted only after integration."
tests:
  - "focused-source-authority: bun test tests/contract/semantic-mutation-source-adapter-contract.test.ts tests/unit/semantic-mutation-source-adapter.test.ts --timeout 180000"
  - "typecheck: bun run typecheck"
  - "docs-doctor: bun run docs:doctor"
  - "control-plane-lifecycle: bun test tests/contract/document-control-plane-lifecycle.test.ts --timeout 180000"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=470f2172dca8ff443efb854bdbc78cd888d53c87 with bun run imports:check"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 470f2172dca8ff443efb854bdbc78cd888d53c87 HEAD --"
---

# SM-4A Trusted Authorization Ingress Reconciliation V10

本包只把 `bca9102` 中仍未被 `main` 吸收的五路径产品/测试 delta 重放到 V11 runtime authority 之后。trusted local policy 只能声明 operation、target、condition 与 minimum verification；source owner、writable prefix 与 authorization revision 必须由 canonical source registry 和 normalizer 生成。

```text
normalized request + Fact Delta endpoint + loaded source candidates + authority-free policy
→ canonical source authority resolution
→ normalized authorization
→ existing SM-2/SM-3 source planning and transaction
```

CLI 与 Workbench 后续只能作为这个 shared ingress 的薄 transport；本包不扩展 operation catalog，不引入 Task Envelope v2，也不创建第二 authorization 或 source writer。
