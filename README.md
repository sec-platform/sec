# Engineering Workspace Compiler

> Engineering intent, maintainable authoring, and available implementations compiled into controlled changes to real software workspaces.

[中文说明](README.zh-CN.md)

This repository retains the historical name `sec`; that name is not the current project definition or acronym. SEC is a local-first **Engineering Workspace Compiler** for connecting product goals, structured engineering semantics, governed source facts, implementation choices, verification evidence, and target-environment constraints.

The long-term direction is for people and AI to work primarily with intent, semantics, constraints, responsibilities, effects, and evidence, while conventional source code increasingly serves as a lower-level realization target. Existing languages and ecosystems remain essential implementation targets and interoperability layers.

## What the system does

SEC supports two input paths: it can reconstruct relevant engineering facts from an existing workspace, or consume deliberately authored goals and constraints. Both paths feed the same responsibility chain:

```text
Goal / Existing Workspace
          ↓
Governed Engineering Content
          ↓
Meaning + Requirements
          ↓
Implementation Selection
          ↓
Target Artifacts + Controlled Effects
          ↓
Readback + Verification + Evidence
```

The requested outcome determines where a task ends. Analysis, a bounded design, an implementation candidate, a generated artifact, an executed operation, and a verified delivery are distinct results.

## Core boundaries

SEC is not an unrestricted whole-repository AI code generator, a low-code runtime, or a template marketplace. Files, generated output, test results, tool responses, and AI statements do not become authoritative merely because they exist. Their identity, source, scope, effects, and evidence must remain explicit at the boundary where they are consumed.

The system keeps author content, semantic interpretation, compilation, verification, external effects, recovery, and publication as separate responsibilities. A plan does not grant write authority; generated code does not prove adoption; a process exit does not prove that an external effect settled; and a documented target design does not claim that its implementation is complete.

## Read the design

The canonical design corpus currently uses Chinese titles and paths:

| Question | Canonical entry |
|---|---|
| What is the product and what constraints apply? | [Product scope and constraints](docs/产品/README.md) |
| How is the complete system divided and connected? | [System architecture](docs/架构/总体设计.md) |
| Where is a subsystem, interface, or concrete design? | [Documentation index](docs/README.md) · [Task routes](docs/任务路线.md) |
| What can an authored product contain? | [Author deliverables](docs/作者/成品/README.md) · [Complete examples](examples/开发成品/README.md) |
| Why was a design chosen, and what remains unresolved? | [Decisions](docs/决策/README.md) · [Open status](docs/状态/README.md) |
| How is this specification maintained? | [Documentation maintenance](docs/维护/README.md) |

The summaries in this root directory are reader-facing projections. Canonical definitions remain in their owning documents under `docs/**`; document identity and generated inventory are maintained under `.documentation/**`. The current corpus digest and delivery number are recorded in [`.documentation/baseline.json`](.documentation/baseline.json); they describe documentation content and do not certify implementation or release status.

## Project status

The project is under active research and development. It contains substantial implementation, tests, documentation, examples, and verification infrastructure, but documented capabilities can be at different stages of specification, implementation, verification, adoption, and retirement.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the maturity boundary and a reproducible starting path.

## Development and licensing

Repository development rules are in [AGENTS.md](AGENTS.md), and contributor guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).

Repository-owned software, tests, tools, executable examples, and build or workflow material are licensed under [MPL-2.0](LICENSE). Repository-owned documentation and specifications are licensed under [CC BY 4.0](LICENSES/CC-BY-4.0.txt). See the [license map](LICENSES/README.md), [authors](AUTHORS.md), and [citation metadata](CITATION.cff) for the exact scope and attribution.

MPL-2.0 is used without Exhibit B. Using SEC on another project does not by itself apply MPL-2.0 to that project's source or generated output; copied SEC implementation material retains its license. Third-party components remain subject to their own licenses and notices.
