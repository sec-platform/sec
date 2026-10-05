# SEC: Engineering Workspace Compiler

[中文说明](README.zh-CN.md)

SEC is a local-first engineering system being developed to turn software requirements and existing workspace content into maintainable programs and authorized changes. It connects structured authoring, implementation selection, compilation, verification, and delivery.

The project is a **development preview**. Start with [PROJECT_STATUS.md](PROJECT_STATUS.md) for the available source examples and their limitations. The repository retains the historical name `sec`; it is not an acronym for the current project definition.

The design aims to let people and AI express goals, behavior, and constraints while reusing existing languages, libraries, and tools to produce conventional source code. Its scope includes creating software and maintaining existing workspaces.

## Design overview

The design has two input paths: reading relevant facts from an existing workspace and accepting authored goals and constraints. Both feed the same sequence:

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

A task may end with analysis, a design, a candidate, generated files, an executed operation, or verified delivery. Each result needs evidence appropriate to that scope.

## Core boundaries

The design separates author content, compilation, verification, external effects, recovery, and publication. Operations must identify their inputs, authority, intended changes, and evidence. Plans and generated code alone do not authorize writes or establish that a change was adopted.

SEC is not an unrestricted whole-repository AI code generator, a low-code runtime, or a template marketplace. The specifications describe the target design; implementation and verification status must be checked separately. External operations also require readback of their actual effects.

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

The repository contains a TypeScript implementation, tests, design specifications, examples, and verification infrastructure. Capabilities are at different stages of implementation and validation.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the maturity boundary and a reproducible starting path.

## Development and licensing

Repository development rules are in [AGENTS.md](AGENTS.md), and contributor guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).

Repository-owned software, tests, tools, executable examples, and build or workflow material are licensed under [MPL-2.0](LICENSE). Repository-owned documentation and specifications are licensed under [CC BY 4.0](LICENSES/CC-BY-4.0.txt). See the [license map](LICENSES/README.md), [authors](AUTHORS.md), and [citation metadata](CITATION.cff) for the exact scope and attribution.

MPL-2.0 is used without Exhibit B. Using SEC on another project does not by itself apply MPL-2.0 to that project's source or generated output; copied SEC implementation material retains its license. Third-party components remain subject to their own licenses and notices.
