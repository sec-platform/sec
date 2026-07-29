---
title: 升级、迁移与变更管理
status: stable
domain: change-management
last-reviewed: 2026-07-28
---

# 升级、迁移与变更管理

本文拥有 Upgrade、Migration、Override 和 Rollback 的稳定语义。精确 migration union、文件操作和诊断由代码与测试拥有。

## Upgrade

升级必须同时回答 identity、compatibility、migration 和 Verification。它不是文件替换命令集合；Block、Contract、Entity/Fact、State/Data、Generator、Artifact 与 Acceptance 的变化必须被显式映射。

## Override

- Manual Override：对 generated target 的直接修改，只是 Drift，不成为 semantic source。
- Rule-backed Override：受治理、可重放、可版本化。
- Emergency Patch：有明确过期和回收计划。

改变 Contract、Effect、Permission 或 Ownership 的 patch 必须成为显式 Contract/Semantic Mutation，而不是只留下源码差异。

## Migration

新增 migration kind 必须有唯一类型、dry-run summary、apply/rollback语义、diagnostic 和 targeted integration test。生产数据迁移只有在 adapter、job identity、checkpoint、Verification、rollback boundary 和 deployment coordination 闭合后，才能声明相应安全性质。

## Rollback

- Authoring rollback：恢复被接受前的 source/plan revision。
- Artifact rollback：从 accepted canonical revision 重建。
- Data rollback：取决于 migration strategy，不能假设可逆。

冲突优先级是 Safety/Policy、Data integrity、Authoritative Contract、受治理 Override、官方升级、Manual Override。AI confidence 不参与越权裁决。
