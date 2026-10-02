---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-02
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:07caf2047b50031b5e4198d7c879cac091c00f310b3fc83c7aa0b12686cd4ad2",
    "manifestPath": "config/repository/work-packages/maintenance-diagnostic-adoption-20261002.md",
    "packageId": "maintenance-diagnostic-adoption-20261002",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "a005513b5a1f60fac0d6163e49144c4a17148f89",
  "exactMainTree": "548a5e913c13560ad1ad9ffe46b6e9fb5e2c94aa",
  "projectionDigest": "sha256:ff5c9524cce0bb5123ba2d23e68be942c58a1eb8901d30005f6b4232cf40e08a",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### maintenance-diagnostic-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/maintenance-diagnostic-adoption-20261002.md` at `sha256:07caf2047b50031b5e4198d7c879cac091c00f310b3fc83c7aa0b12686cd4ad2`, based on exact main `a005513b5a1f60fac0d6163e49144c4a17148f89` and tree `548a5e913c13560ad1ad9ffe46b6e9fb5e2c94aa`.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 2. operation-read-plan-authority-canary-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 3. sec-static-convergence-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 4. candidate-control-transaction-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 5. typescript-7-checker-acceleration-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
