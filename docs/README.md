---
title: SEC 文档导航
status: active
domain: documentation
generated-from: docs/authority.json
---

# SEC 文档导航

本页由 `docs/authority.json` 生成，只提供导航，不拥有产品、架构、状态或 Gate。

| 类型 | 领域 | 路径 | 拥有 | Proposal 处置 |
| --- | --- | --- | --- | --- |
| registry | documentation | `docs/authority.json` | documentation.identity、documentation.lifecycle、documentation.ownership | — |
| authority | agent-constitution | [`docs/agent-constitution.md`](agent-constitution.md) | agent.action-admission、agent.adversarial-reasoning、agent.continuation、agent.delegation、agent.epistemics、agent.knowledge-crystallization、agent.recovery、agent.self-correction | — |
| authority | agent-user-interface | [`docs/agent-and-user-machine-interface.md`](agent-and-user-machine-interface.md) | ai.bounded-proposal、ai.context-packet、interface.cli、interface.machine-json、interface.projection | — |
| authority | brownfield | [`docs/brownfield-import.md`](brownfield-import.md) | brownfield.external-library-onboarding、brownfield.lifecycle、brownfield.source-program-model、brownfield.typed-invocation、brownfield.unknown-opaque | — |
| authority | capability-block | [`docs/capability-and-block-model.md`](capability-and-block-model.md) | capability.block、capability.block-resolution、capability.contract、capability.generator、capability.port、capability.registry、capability.slot-retirement、capability.typed-extension | — |
| authority | change-management | [`docs/change-management.md`](change-management.md) | change.compatibility、change.compensation、change.forward-recovery、change.implementation-binding-migration、change.migration、change.override、change.upgrade | — |
| authority | compiler-target-ir | [`docs/compiler-target-ir.md`](compiler-target-ir.md) | compiler.application-ir、compiler.behavior-ir、compiler.implementation-resolution、compiler.lowering、compiler.pipeline、compiler.target-profile、compiler.target-program-ir、compiler.type-algebra | — |
| authority | delta-and-impact | [`docs/delta-and-impact.md`](delta-and-impact.md) | implementation.binding-delta、implementation.impact、semantic.fact-delta、semantic.impact | — |
| authority | design-calculus | [`docs/design-calculus.md`](design-calculus.md) | design.admission、design.constraint、design.evolution、design.principle-language、design.relation-algebra、design.simulation | — |
| authority | development-governance | [`docs/development-governance.md`](development-governance.md) | development.agent-operation、development.external-capability-governance、development.fact-sources、development.operation-envelope、development.plan-layering、development.resume、development.roles、development.skill、development.work-package | — |
| authority | engineering-constitution | [`docs/engineering-constitution.md`](engineering-constitution.md) | engineering.authority、engineering.capability、engineering.derivation、engineering.effect、engineering.evolution、engineering.identity、engineering.ownership、engineering.proof、engineering.recovery、engineering.resource、engineering.structure、engineering.truth | — |
| authority | external-provider | [`docs/external-provider-policy.md`](external-provider-policy.md) | provider.adapter、provider.adoption、provider.authority、provider.conformance、provider.onboarding、provider.retirement、provider.security | — |
| authority | implementation-architecture | [`docs/implementation-architecture.md`](implementation-architecture.md) | architecture.workspace-zones、implementation.architecture、implementation.change-locality、implementation.entity-realization、implementation.intent-compilation、implementation.manual-provider、implementation.placement、implementation.source-generation、implementation.transition | — |
| authority | product | [`docs/product.md`](product.md) | product.boundary、product.problem、product.success、product.value | — |
| authority | roadmap | [`docs/roadmap.md`](roadmap.md) | delivery.exit-criteria、delivery.stage-dag | — |
| authority | runtime-distribution | [`docs/runtime-and-distribution.md`](runtime-and-distribution.md) | runtime.distribution、runtime.environment、runtime.host-profile、runtime.implementation-materialization、runtime.layout、runtime.support、runtime.toolchain | — |
| authority | semantic-model | [`docs/semantic-model.md`](semantic-model.md) | semantic.assertion、semantic.authority、semantic.entity、semantic.fact、semantic.responsibility、semantic.revision、semantic.validated-boundary | — |
| authority | semantic-mutation | [`docs/semantic-mutation.md`](semantic-mutation.md) | semantic.mutation、semantic.source-ownership、semantic.transaction-recovery | — |
| authority | system-architecture | [`docs/system-architecture.md`](system-architecture.md) | architecture.authority-flow、architecture.cross-domain-reference、architecture.layering、architecture.maturity、architecture.single-writer | — |
| authority | verification-governance | [`docs/verification-governance.md`](verification-governance.md) | verification.aggregate、verification.applicability、verification.claim、verification.environment、verification.evidence、verification.gate、verification.implementation-conformance、verification.layering、verification.merge-authority、verification.provenance、verification.result | — |
| proposal | proposal | [`docs/proposals/development-run-kernel.md`](proposals/development-run-kernel.md) | — | adapt |
| proposal | proposal | [`docs/proposals/engineering-workspace-domains.md`](proposals/engineering-workspace-domains.md) | — | adapt |
| machine-ledger | external-provider | `docs/governance/external-capability-ledger.yaml` | provider.state | — |
| control | current-control | [`docs/work/active-work-package.md`](work/active-work-package.md) | control.active-work-package | — |
| control | current-control | `docs/work/current-state.yaml` | control.resolver-authority | — |
| control | current-control | [`docs/work/rolling-plan.md`](work/rolling-plan.md) | control.rolling-plan | — |
| agent-projection | development-governance | [`AGENTS.md`](../AGENTS.md) | — | — |
| navigation | current-control | [`docs/work/README.md`](work/README.md) | — | — |
| navigation | entry | [`README.md`](../README.md) | — | — |

新增、移动、裁决或退役文档必须先修改 registry；未登记 active 文档、无处置 draft proposal、重复 owner 或失效生成投影均 fail closed。
