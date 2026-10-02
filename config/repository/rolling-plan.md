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
    "manifestDigest": "sha256:46312052d197504c4c0bd70cf58b0c02430389737cd7470efa8c97f78da629be",
    "manifestPath": "config/repository/work-packages/linux-provider-native-owner-adoption-20261002.md",
    "packageId": "linux-provider-native-owner-adoption-20261002",
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
  "exactMain": "6d426e5df4991c9f1249059f64bcc5a4cd0b8146",
  "exactMainTree": "13ad8d8704c6b050bc7271e57a351d3b059fac9e",
  "projectionDigest": "sha256:0b984a4375ba308b17dc876e773f34f1b0a7f7a2ed101c6f6284b27e29b51ccf",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### linux-provider-native-owner-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/linux-provider-native-owner-adoption-20261002.md` at `sha256:46312052d197504c4c0bd70cf58b0c02430389737cd7470efa8c97f78da629be`, based on exact main `6d426e5df4991c9f1249059f64bcc5a4cd0b8146` and tree `13ad8d8704c6b050bc7271e57a351d3b059fac9e`.

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
