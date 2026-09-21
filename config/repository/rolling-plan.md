---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-21
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:e67697dd0a9e3903b1e9a6a24438ebcb7274ee652fa17b046928c5cedbb4bbb4",
    "manifestPath": "config/repository/work-packages/sec086-current-main-convergence-v1.md",
    "packageId": "sec086-current-main-convergence-v1",
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
  "exactMain": "69b321e4eeac478a5400d456a5fff92ceb37ace8",
  "exactMainTree": "49943fb5f3f26de2e02c8803f13c6f7692d9f9c0",
  "projectionDigest": "sha256:952f4fc6ebdb58f8b61261d34fa8cdc72afe5db678434f5beade5f643c4290db",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### sec086-current-main-convergence-v1

Proposal-only target manifest `config/repository/work-packages/sec086-current-main-convergence-v1.md` at `sha256:e67697dd0a9e3903b1e9a6a24438ebcb7274ee652fa17b046928c5cedbb4bbb4`, based on exact main `69b321e4eeac478a5400d456a5fff92ceb37ace8` and tree `49943fb5f3f26de2e02c8803f13c6f7692d9f9c0`.

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
