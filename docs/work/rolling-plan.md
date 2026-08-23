---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-23
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:54c1f6cb8f103093cd9481021e470eec85cfccbffbe858ae7058683fe4fbcaf4",
    "manifestPath": "docs/work-packages/git-worktree-physical-closeout-v1.md",
    "packageId": "git-worktree-physical-closeout-v1",
    "tracking": "issue-186"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "1a7ffe0845265757bc77db2fa50c5ade8e12dff9",
    "sourceManifestDigest": "sha256:74a319caa07ec283b4af6fe4bb1cbc5232b683d009de5ebec70a2c406a2e1602",
    "sourcePointerRevision": "sha256:fd6a3879810fb38d97e2efdac2ffe4a43de432736de62f1eb9caa11969bf6b08",
    "sourceRollingRevision": "sha256:ba6adb96718a562c869f3e5b6bc2887eda5c6fcfd5e67fee45957528adae7117",
    "sourceTree": "c335a3463416f2d4a6d229a973c9ef9d6b215851"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "489518c3bd8b28753473e43ecb2e236452dee0b9",
  "exactMainTree": "2078e2accab07775ce0da60ef3c93aafe0b11a09",
  "projectionDigest": "sha256:19da89774266731d19e3b2b6e5c5db7d2a7dc4336e1b37a72ce0bee49e78b9ce",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### git-worktree-physical-closeout-v1

Existing active package replan bound to exact source head `1a7ffe0845265757bc77db2fa50c5ade8e12dff9`, source tree `c335a3463416f2d4a6d229a973c9ef9d6b215851`, manifest `sha256:54c1f6cb8f103093cd9481021e470eec85cfccbffbe858ae7058683fe4fbcaf4`, and authority `sha256:7d1eb4756eb43a407c3ad3d591f421a9bdd95ae42e345d5505c2b92587e0592f`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:7d1eb4756eb43a407c3ad3d591f421a9bdd95ae42e345d5505c2b92587e0592f`.

### 2. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:7d1eb4756eb43a407c3ad3d591f421a9bdd95ae42e345d5505c2b92587e0592f`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:7d1eb4756eb43a407c3ad3d591f421a9bdd95ae42e345d5505c2b92587e0592f`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:7d1eb4756eb43a407c3ad3d591f421a9bdd95ae42e345d5505c2b92587e0592f`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
