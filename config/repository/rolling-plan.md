---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-01
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:e8922b86c3f23f39030e9250fb05b7c70f8be1cdc64cfac3d3c7e16d3ed4d731",
    "manifestPath": "config/repository/work-packages/workflow-provider-decisions-20261001.md",
    "packageId": "workflow-provider-decisions-20261001",
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
  "exactMain": "f389347ecd68002537ac6781f6209bb69cd97e1b",
  "exactMainTree": "7f7c6e685213c8d16edd2c7cc608c77b7f64c388",
  "projectionDigest": "sha256:ef16ebbf41175453f9dfc0feeb66c3d3b6ba7528cab9e19ac08207840955f9d4",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### workflow-provider-decisions-20261001

Proposal-only target manifest `config/repository/work-packages/workflow-provider-decisions-20261001.md` at `sha256:e8922b86c3f23f39030e9250fb05b7c70f8be1cdc64cfac3d3c7e16d3ed4d731`, based on exact main `f389347ecd68002537ac6781f6209bb69cd97e1b` and tree `7f7c6e685213c8d16edd2c7cc608c77b7f64c388`.

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
