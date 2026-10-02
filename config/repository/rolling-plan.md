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
    "manifestDigest": "sha256:d42d000af3d09ed2cddb2191ee278aefacff0c61e99ba4abf7515f857d261a14",
    "manifestPath": "config/repository/work-packages/import-config-cache-adoption-20261002.md",
    "packageId": "import-config-cache-adoption-20261002",
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
  "exactMain": "8271988e92e130a30f3bde530013217d0ac96b28",
  "exactMainTree": "f7727910bf2b4b6bde94a0512b98dde71fb0bd2a",
  "projectionDigest": "sha256:c4c0f3972c65a34d5a3c7ea4932807757206c59de082e262e1dc4d5333636214",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### import-config-cache-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/import-config-cache-adoption-20261002.md` at `sha256:d42d000af3d09ed2cddb2191ee278aefacff0c61e99ba4abf7515f857d261a14`, based on exact main `8271988e92e130a30f3bde530013217d0ac96b28` and tree `f7727910bf2b4b6bde94a0512b98dde71fb0bd2a`.

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
