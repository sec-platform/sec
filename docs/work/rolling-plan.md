---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-28
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:203fd28a777c445abcd2ae16abbec221be24b7d42295962de121f3f50bf44db8",
    "manifestPath": "docs/work-packages/default-branch-health-repair-36b174ebc783bb2b2e0c079d58fb825f0966b60b-848e6d50f2852dc05566c9d272c71782a7c39fb6c1badea43b1f74e9064b3c8e.md",
    "packageId": "default-branch-health-repair-36b174ebc783bb2b2e0c079d58fb825f0966b60b-848e6d50f2852dc05566c9d272c71782a7c39fb6c1badea43b1f74e9064b3c8e",
    "tracking": "none"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "21160041eb8cdbffd72e91d63501491eb7051061",
    "sourceManifestDigest": "sha256:0369fe25da6990f295a690f93d7d9d6b9a9265c059e7a4f454c8ac111f81308c",
    "sourcePointerRevision": "sha256:193887829b361aaa1df27aed49753cf7af38db3a91751db0663adf7cc81cc4cd",
    "sourceRollingRevision": "sha256:b3d61721fce5659e6c147c949be064c2d24d57eec0bd5b39bc933af21131c4d7",
    "sourceTree": "d73030fb9244aacde19e8502426e9ad541398afc"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "36b174ebc783bb2b2e0c079d58fb825f0966b60b",
  "exactMainTree": "f7dd21a385a00589ecf04a41e98fe9d9e4fb43d6",
  "projectionDigest": "sha256:a776d5651185c7e84f4d863db91cf05321ece2d32c7abc2c4735d970fbc8b53e",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### default-branch-health-repair-36b174ebc783bb2b2e0c079d58fb825f0966b60b-848e6d50f2852dc05566c9d272c71782a7c39fb6c1badea43b1f74e9064b3c8e

Existing active package replan bound to exact source head `21160041eb8cdbffd72e91d63501491eb7051061`, source tree `d73030fb9244aacde19e8502426e9ad541398afc`, manifest `sha256:203fd28a777c445abcd2ae16abbec221be24b7d42295962de121f3f50bf44db8`, and authority `sha256:4881437c944ac29140b56b1d692f9bc3d452ad521b2663067e0fadc889dd6d21`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:4881437c944ac29140b56b1d692f9bc3d452ad521b2663067e0fadc889dd6d21`.

### 2. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:4881437c944ac29140b56b1d692f9bc3d452ad521b2663067e0fadc889dd6d21`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:4881437c944ac29140b56b1d692f9bc3d452ad521b2663067e0fadc889dd6d21`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:4881437c944ac29140b56b1d692f9bc3d452ad521b2663067e0fadc889dd6d21`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
