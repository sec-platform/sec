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
    "manifestDigest": "sha256:2601adc37bb9777b0f1ea8fe58579b186105ac414e59be342347beb05b59f3e0",
    "manifestPath": "config/repository/work-packages/hook-recovery-owner-boundaries-20261001.md",
    "packageId": "hook-recovery-owner-boundaries-20261001",
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
  "exactMain": "95725b00abc26fbee4457254e811634fa6f8e4cb",
  "exactMainTree": "f9c2b151441cb775ffeedab24ae8c69740cb4164",
  "projectionDigest": "sha256:75c166f82973ae3617ffe10e43396f5bd9d265fbbb9b9a1253e363f8993fe1c6",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### hook-recovery-owner-boundaries-20261001

Proposal-only target manifest `config/repository/work-packages/hook-recovery-owner-boundaries-20261001.md` at `sha256:2601adc37bb9777b0f1ea8fe58579b186105ac414e59be342347beb05b59f3e0`, based on exact main `95725b00abc26fbee4457254e811634fa6f8e4cb` and tree `f9c2b151441cb775ffeedab24ae8c69740cb4164`.

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
