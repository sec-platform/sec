# Engineering Workspace Compiler

> **Engineering intent and semantics above source code. Source code becomes an increasingly assembly-like realization layer.**

[中文](README.zh-CN.md)

This repository retains the historical name `sec`; that name is not intended as the current project definition or acronym. The project has evolved into a local-first **Engineering Workspace Compiler**.

The compiler explores a software-engineering model in which humans and AI work primarily with intent, semantics, constraints, responsibilities, evidence, and controlled operations, while conventional programming-language source code becomes a lower-level realization target rather than the sole authoritative representation of a system.

The long-term thesis is that, in AI-native software development, source code can increasingly play a role analogous to assembly language today: still essential, still inspectable, and still executable through existing ecosystems, but no longer necessarily the highest-level interface through which software is designed and evolved.

## What the compiler does

The system is designed to turn product intent, structured engineering semantics, governed source facts, implementation choices, verification evidence, and target-environment constraints into controlled changes to real software workspaces.

At a high level:

```text
Intent / Constraints / Existing System
                ↓
      Engineering Semantics
                ↓
   Resolution + Exact Bindings
                ↓
       Delta + Impact Plan
                ↓
 Controlled Mutation / Generation
                ↓
   Readback + Verification + Evidence
                ↓
        Target Workspace
```

The current product definition is more precise than a generic AI coding agent: canonical engineering facts are reconstructed or admitted through governed contracts, and AI is a participant in that system rather than an unrestricted authority over the repository.

## What it is not

The Engineering Workspace Compiler is not:

- an unrestricted whole-repository AI code generator;
- a low-code runtime that replaces source code with a GUI;
- a template marketplace;
- a wrapper that attempts to absorb every external tool into one framework;
- a claim that conventional programming languages are obsolete.

Existing languages and ecosystems remain important targets and interfaces. The goal is to move the primary engineering abstraction upward while keeping lower layers explicit and verifiable.

## Architecture

The architecture separates engineering meaning from implementation and runtime effects. It centers on a governed semantic model, exact observations, resolution and binding, controlled workspace evolution, independent readback, evidence, and lifecycle/evolution rules.

See:

- [Public architecture overview](ARCHITECTURE.md)
- [Project status](PROJECT_STATUS.md)
- [Canonical product definition](docs/product.md)
- [Canonical system architecture](docs/system-architecture.md)
- [Semantic model](docs/semantic-model.md)
- [Compiler and target IR](docs/compiler-target-ir.md)
- [Canonical documentation index](docs/README.md)

The documents under `docs/**` remain the canonical design authority. Public-facing summaries are projections of that design and do not create a second source of truth.

## Development status

The project is under active research and development. The repository contains substantial implementation work together with an evolving architecture and verification system. A design being documented does **not** imply that the corresponding capability is complete, verified, released, or adopted.

The engineering model deliberately distinguishes proposal, acceptance, specification, implementation, verification, enforcement, adoption, and retirement of superseded paths.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the public maturity boundary.

## Origin and development model

The project began as an independently developed effort in 2026 around the idea that AI-native software engineering needs a higher-level authoritative engineering representation than conventional source code alone.

It is currently developed independently and self-funded, including AI-model and token costs used during research and development.

## Open source

The repository is being prepared for public release under the **MIT License**. Project-owned implementation, specifications, architecture and design documentation, tests, and other copyrightable engineering materials are intended to be distributed under that license. The engineering knowledge embodied in those materials will therefore be openly inspectable and reusable subject to the license and any applicable third-party notices.

Repository visibility and software maturity are separate facts: making the repository public will not by itself mean that every documented capability is complete or that a stable API has been declared.

## Development

Repository development instructions are in [AGENTS.md](AGENTS.md). Contributor-facing guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).

---

This is an engineering project under active development. Statements in this README describe the current project direction and architecture; they should not be read as claims that every described capability is already production-ready.