---
schema: codex-development-work-package-v1
id: open-control-evolution-v1
tracking: none
base: e5880a5805260b3c478f9a3eed46cab13a79ba80
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: integrate-open-control-and-evolution
    owner: open-control-evolution-owner
    ownedPaths:
      - config/repository/work-packages/open-control-evolution-v1.md
      - .documentation/documents.json
      - .documentation/requirements.json
      - .documentation/source-manifest.json
      - docs/产品/产品要求与工作约束.md
      - docs/作者/组合/稀疏控制与目标限定.md
      - docs/作者/组合/语义扩展与领域接合.md
      - docs/依据/来源/语言编译与目标工具.md
      - docs/信息/存储保留与恢复.md
      - docs/信息/对象关系与配置基线.md
      - docs/内容索引.md
      - docs/决策/设计理由-目标与核心.md
      - docs/开发/AI协作/委派安全与持续交接.md
      - docs/开发/测试发现与执行.md
      - docs/架构/README.md
      - docs/架构/实现供给与替换.md
      - docs/架构/实现语言与机制演进.md
      - docs/架构/总体设计.md
      - docs/架构/装配/源绑定与解释映像.md
      - docs/状态/作者与接口.md
      - docs/状态/信息约束与验证.md
      - docs/状态/编译与目标.md
      - docs/编译/实现选择与设计搜索.md
      - docs/编译/查询增量与性能.md
      - docs/编译/表示/目标运行与观测.md
      - docs/运行/保证/系统不变量与组合.md
      - docs/运行/保证/要求证据与裁决.md
      - docs/运行/发布运行与资源生命周期.md
      - docs/运行/权限与资源管理.md
      - docs/运行/验收/README.md
      - docs/运行/验收/会话集成与结果复用.md
      - docs/运行/验收/控制与演进案例.md
      - docs/运行/验收/方法与独立证据.md
      - docs/运行/验收/测试生成与形式方法.md
forbiddenPaths:
  - .github/
  - src/
  - tests/
  - tools/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
acceptance:
  - existing require prefer reset and sec.controls/1 remain the single author-control authority
  - explicit user control and delegated automatic choice share typed constraints without a second decision database
  - control expression interpretation actuation observation qualification takeover and recovery remain distinct responsibilities
  - future semantic and mechanism changes use distinction witnesses and bounded evolution paths instead of opaque metadata
  - semantic identity revision runtime handle physical location memory encoding persistent format and ABI remain distinct
  - verification evidence binds exact ProofObligation and VerificationMethodSelection revisions through downstream consumers
  - documentation projections and requirement ownership remain internally consistent after the normative changes
  - no product source dependency workflow or test implementation changes are introduced by this package
tests:
  - tests/contract/docs-doctor-ledgers.test.ts
  - tests/unit/active-documentation-contract.test.ts
  - tests/unit/documentation-source.test.ts
---

# Open control and evolution integration

This frozen Work Package binds the already-reviewed open-control, mechanism-evolution,
migration, takeover, and verification-responsibility design to the exact main preimage
above. It owns only the listed normative documents, documentation projections, and this
manifest. Product source, workflows, tests, package state, active control-plane pointers,
and concurrent repository work are explicitly outside this packet.

The package does not create a second DecisionDimension, Binding database, scheduler,
permission root, or verification schema. It extends the existing owners and requires
actual consumers, exact revisions, migration semantics, evidence qualification, and
runtime settlement where the corresponding capability is used.

The quick profile is sufficient for this documentation-only candidate; repository
documentation checks and the focused canonical contract/unit modules remain separate
from CodeQL, independent review, merge authorization, and new-main readback.
