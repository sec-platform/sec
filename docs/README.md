---
title: SEC 文档导航
status: active
domain: documentation
last-reviewed: 2026-08-02
generated-from: docs/authority.json
---

# SEC 文档导航

本页由 `docs/authority.json` 生成，只提供导航，不拥有产品、架构、状态或 Gate。

| 类型 | 领域 | 路径 | 拥有 | Proposal 处置 |
| --- | --- | --- | --- | --- |
| registry | documentation | `docs/authority.json` | documentation.identity、documentation.lifecycle、documentation.ownership | — |
| authority | brownfield | [`docs/brownfield-import.md`](brownfield-import.md) | brownfield.lifecycle、brownfield.source-program-model、brownfield.unknown-opaque | — |
| authority | capability-block | [`docs/capability-and-block-model.md`](capability-and-block-model.md) | capability.block、capability.contract、capability.generator、capability.port、capability.registry、capability.slot | — |
| authority | change-management | [`docs/change-management.md`](change-management.md) | change.migration、change.override、change.rollback、change.upgrade | — |
| authority | compiler-target-ir | [`docs/compiler-target-ir.md`](compiler-target-ir.md) | compiler.application-ir、compiler.behavior-ir、compiler.lowering、compiler.pipeline、compiler.target-profile、compiler.target-program-ir、compiler.type-algebra | — |
| authority | delta-and-impact | [`docs/delta-and-impact.md`](delta-and-impact.md) | semantic.fact-delta、semantic.impact | — |
| authority | development-governance | [`docs/development-governance.md`](development-governance.md) | development.fact-sources、development.resume、development.roles、development.skill、development.work-package | — |
| authority | external-provider | [`docs/external-provider-policy.md`](external-provider-policy.md) | provider.adoption、provider.authority、provider.retirement、provider.security | — |
| authority | product | [`docs/product.md`](product.md) | product.boundary、product.problem、product.success、product.value | — |
| authority | roadmap | [`docs/roadmap.md`](roadmap.md) | delivery.exit-criteria、delivery.stage-dag | — |
| authority | runtime-distribution | [`docs/runtime-and-distribution.md`](runtime-and-distribution.md) | runtime.distribution、runtime.host、runtime.layout、runtime.target-profile、runtime.toolchain | — |
| authority | semantic-model | [`docs/semantic-model.md`](semantic-model.md) | semantic.assertion、semantic.authority、semantic.entity、semantic.fact、semantic.revision、semantic.validated-boundary | — |
| authority | semantic-mutation | [`docs/semantic-mutation.md`](semantic-mutation.md) | semantic.mutation、semantic.source-ownership、semantic.transaction-recovery | — |
| authority | system-architecture | [`docs/system-architecture.md`](system-architecture.md) | architecture.authority-flow、architecture.layering、architecture.single-writer、architecture.workspace-zones | — |
| authority | verification-governance | [`docs/verification-governance.md`](verification-governance.md) | verification.evidence、verification.gate、verification.layering、verification.merge-authority、verification.provenance | — |
| authority | workbench-ai | [`docs/workbench-and-ai-operations.md`](workbench-and-ai-operations.md) | ai.bounded-operator、ai.context-packet、ai.task-envelope、workbench.projection、workbench.semantic-operation | — |
| corpus-contract | nexus-corpus | [`docs/corpus/nexus/contract.md`](corpus/nexus/contract.md) | corpus.nexus.conformance | — |
| proposal | proposal | [`docs/proposals/development-run-kernel.md`](proposals/development-run-kernel.md) | — | adapt |
| proposal | proposal | [`docs/proposals/engineering-workspace-domains.md`](proposals/engineering-workspace-domains.md) | — | adapt |
| machine-ledger | external-provider | `docs/governance/external-capability-ledger.yaml` | provider.state | — |
| machine-ledger | nexus | `docs/governance/nexus-absorption-ledger.yaml` | corpus.nexus.state | — |
| control | current-control | [`docs/work/active-work-package.md`](work/active-work-package.md) | control.active-work-package | — |
| control | current-control | `docs/work/current-state.yaml` | control.resolver-authority | — |
| control | current-control | [`docs/work/rolling-plan.md`](work/rolling-plan.md) | control.rolling-plan | — |
| agent-projection | development-governance | [`AGENTS.md`](../AGENTS.md) | — | — |
| navigation | current-control | [`docs/work/README.md`](work/README.md) | — | — |
| navigation | entry | [`README.md`](../README.md) | — | — |

新增、移动、裁决或退役文档必须先修改 registry；未登记 active 文档、无处置 draft proposal、重复 owner 或失效生成投影均 fail closed。
