---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-16
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:d4e44f548dcef9ee0512ce990a091107443ff4b37ff99f8783decedce5dafb6b",
    "manifestPath": "docs/work-packages/sec-086-cutover.md",
    "packageId": "sec-086-cutover",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "a873494b81f702ed57924c243b2d190f59ab9334",
  "exactMainTree": "a43713bdaa4ab6668fd28c24bdf9c575c4b96fda",
  "projectionDigest": "sha256:ca7faf059b97db32da439650e3717bb2a0866e96f8f8d4769e089467f950da70",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### sec-086-cutover

Proposal-only target manifest `docs/work-packages/sec-086-cutover.md` at `sha256:d4e44f548dcef9ee0512ce990a091107443ff4b37ff99f8783decedce5dafb6b`, based on exact main `a873494b81f702ed57924c243b2d190f59ab9334` and tree `a43713bdaa4ab6668fd28c24bdf9c575c4b96fda`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 2. sec-static-convergence-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 3. candidate-control-transaction-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
