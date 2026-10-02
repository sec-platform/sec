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
    "manifestDigest": "sha256:422dd5e18e7edcd1f1a62187354af460e133865e2608fb1c65e446925e642e65",
    "manifestPath": "config/repository/work-packages/release-parent-atomic-adoption-20261002.md",
    "packageId": "release-parent-atomic-adoption-20261002",
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
  "exactMain": "0394d330eb765f0b0e2fdf8a41f63bc78adda7cd",
  "exactMainTree": "d89ea21bdef6e90c2f49dd6844a4e8a6a92398d8",
  "projectionDigest": "sha256:105ce03bda87b774de515ceef0ce3dc68a6467871f105464937c342e88d61c4c",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### release-parent-atomic-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/release-parent-atomic-adoption-20261002.md` at `sha256:422dd5e18e7edcd1f1a62187354af460e133865e2608fb1c65e446925e642e65`, based on exact main `0394d330eb765f0b0e2fdf8a41f63bc78adda7cd` and tree `d89ea21bdef6e90c2f49dd6844a4e8a6a92398d8`.

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
