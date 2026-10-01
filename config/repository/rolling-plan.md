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
    "manifestDigest": "sha256:e872ce73d606e603d4608ecb74cf505fe0a7974081d92557de09f2ff97e49288",
    "manifestPath": "config/repository/work-packages/verification-session-closeout-owner-20261001.md",
    "packageId": "verification-session-closeout-owner-20261001",
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
  "exactMain": "e60a1c2c5103540afcc73083388f75c55e1f0ade",
  "exactMainTree": "9a22f545b42890b2497837cdd703da5b4dd8bcab",
  "projectionDigest": "sha256:e74c5415d1f67da4f091088f6c379a1d404d420590e21f6655beacafd9759598",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### verification-session-closeout-owner-20261001

Proposal-only target manifest `config/repository/work-packages/verification-session-closeout-owner-20261001.md` at `sha256:e872ce73d606e603d4608ecb74cf505fe0a7974081d92557de09f2ff97e49288`, based on exact main `e60a1c2c5103540afcc73083388f75c55e1f0ade` and tree `9a22f545b42890b2497837cdd703da5b4dd8bcab`.

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
