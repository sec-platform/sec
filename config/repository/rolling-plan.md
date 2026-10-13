---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-13
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:e7748e4393fedb1c7eb98c6baf578b9668fe7b882ba5cb8fb33a8c16ab5733ae",
    "manifestPath": "config/repository/work-packages/audit-worker-boundary-20261013.md",
    "packageId": "audit-worker-boundary-20261013",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [],
  "exactMain": "a1f3f0d0797dc141d470976d3dc7ef31ce561f09",
  "exactMainTree": "13ffc0b07e4cf68d69bd933b4ba05e9b5e4ad9b1",
  "projectionDigest": "sha256:d7b1360d324f711c02c88bbb2a7fa97abc6fa9222110bc0536023d530b61e31d",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### audit-worker-boundary-20261013

Proposal-only target manifest `config/repository/work-packages/audit-worker-boundary-20261013.md` at `sha256:e7748e4393fedb1c7eb98c6baf578b9668fe7b882ba5cb8fb33a8c16ab5733ae`, based on exact main `a1f3f0d0797dc141d470976d3dc7ef31ce561f09` and tree `13ffc0b07e4cf68d69bd933b4ba05e9b5e4ad9b1`.

## 候选 Work Package


## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
