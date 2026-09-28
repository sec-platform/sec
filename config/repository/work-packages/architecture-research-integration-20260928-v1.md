---
schema: codex-development-work-package-v1
id: architecture-research-integration-20260928-v1
tracking: none
base: 00f1b21f2d01237c50dbe96e28a5442d8eec9ec3
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: integrate-cross-system-architecture-research
    owner: architecture-research-owner
    ownedPaths:
      - docs/架构/约束强制与整体一致性.md
      - docs/作者/组合/模块封装与复用库.md
      - docs/开发/编辑审查与客户端.md
      - docs/编译/查询增量与性能.md
      - docs/编译/内核/确定性与自举.md
      - docs/编译/有条件实现与公共行为保持.md
      - docs/编译/内核/变换接纳与分析保持.md
      - docs/编译/实现选择与设计搜索.md
      - docs/运行/跨实现调用与数据寿命.md
      - docs/运行/原生边界与模块驻留.md
      - docs/运行/权限与资源管理.md
      - docs/运行/持久化提交与恢复.md
      - docs/架构/协作与状态边界.md
      - docs/领域/计算基础/通用计算与任务语义.md
      - docs/运行/发布运行与资源生命周期.md
      - docs/运行/宿主生态与技术约束.md
      - docs/演进/兼容迁移与退役.md
      - docs/信息/对象关系与配置基线.md
      - docs/运行/验收/方法与独立证据.md
      - docs/运行/验收/控制与演进案例.md
      - docs/运行/验收/实现与运行案例.md
      - docs/依据/来源/工程信息组织依据.md
      - docs/依据/来源/构建分发与迁移.md
      - docs/依据/来源/语言编译与目标工具.md
      - .documentation/source-manifest.json
      - config/repository/work-packages/architecture-research-integration-20260928-v1.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
acceptance:
  - the candidate is a direct child of exact current main 00f1b21f2d01237c50dbe96e28a5442d8eec9ec3 and contains only the frozen owned paths
  - the merged Rust-kernel/game-runtime architecture from PR 680 is preserved; the overlapping language/tool evidence source is extended rather than replaced
  - existing canonical SEC responsibilities remain authoritative; external systems contribute bounded counterexamples and mechanism conditions, not copied architectures
  - cache validation distinguishes passive observation-token comparison from algorithms that actively re-execute historical dependencies
  - dependency and cycle claims state their node domain and do not change merely because ownership partitions are regrouped
  - canonical identity encoding remains versioned across implementation-language changes and accounts for expansion work before publication
  - optimizations preserve actual evaluation domain, error, termination, effect, ordering, lifetime and declared resource observations
  - transform publication binds base IR and dependent indexes/analysis to one coherent generation
  - zero-copy and cross-runtime exchange account for selection/validity/dictionary coordinates, retained allocations and release-code lifetime
  - recovery progress binds object generation, accepted-history evidence, deduplication horizon and consistent source/operator/channel/control cut
  - independent writes do not bypass shared predicates, budgets or cross-object invariants
  - readback consistency, history gaps, field-management topology, editor partial application and observation loss remain explicit instead of collapsing to boolean success
  - validation keeps model, implementation, host and independent-oracle evidence scopes separate
  - documentation source manifest exactly reflects the changed authoritative Markdown bytes on the post-PR-680 main generation
  - no runtime, workflow, dependency, release or product implementation is changed by this design-only packet
tests:
  - bun run docs:doctor
  - bun run audit:static
---

# Cross-system architecture research integration

This design-only Work Package integrates verified counterexamples and mechanism constraints into their existing canonical SEC owners. It deliberately avoids a second architecture ledger, universal manager, mandatory ordered query trace, automatic owner-SCC merging, or line-count-driven restructuring. Runtime/provider conformance and product implementation remain separate obligations.
