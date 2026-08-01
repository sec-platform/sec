---
name: sec-govern-toolchain
description: 对 SEC dependency、runtime/toolchain version、package/lock、Hook、build、package surface和release工具变化执行唯一writer、真实consumer、兼容性和退役治理；不把包管理或版本事实复制成Skill状态。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: govern-toolchain
  sec-risk: branch-write
---

# sec-govern-toolchain

## 目标

使每个dependency/toolchain具有唯一domain、真实consumer、version authority、runtime/platform范围、package surface和retirement条件，并由一个operation独占package/lock writer。Skill负责adopt/retain/move/replace/remove裁决，不拥有包解析算法或动态版本表。

## 触发

- 新增、升级、降级、移动或删除dependency。
- Bun/Node/TypeScript/package manager、lockfile、package scripts、Hook、build/package/release入口变化。
- Core、Host、Toolchain、Target、Workbench、Verification或External Provider边界需要调整。
- 安装/缓存/native lifecycle或public package surface出现缺陷。

## 不触发

- 普通产品源码变化，toolchain identity与package surface未改变。
- 外部工具是否值得采用仍未裁决：先`sec-govern-capability`。
- Host/Target长期架构或public contract需要重建：转`sec-design-change`。

## 必需输入

- operation envelope与package/lock exclusive grant；
- current package/lock/toolchain identities；
- dependency consumer census、public reachability、runtime/platform capability Evidence；
- official release/license/security information；
- migration、rollback、clean install和package surface requirements。

## 权限边界

- 默认`branch-write`；package/lock、Hook或CI trust root可能升级为`trust-root-write`。
- 一个operation是package.json、lockfile和dependency generation的唯一writer。
- 不使用全局PATH、ambient install、相邻worktree或未登记cache满足依赖。
- 不因Skill描述自动获得network、credential或publication权限。

## 执行

1. 解析真实consumer：static/dynamic import、script/workflow、generated target、native/install hook和public package reachability。
2. 将能力归入Core Runtime、Node Host、Bun Toolchain/Host、Verification Provider、Target Profile、Workbench、External CLI或Build/Release。
3. 获取绑定exact version/runtime/platform/filesystem的能力、license、maintenance和security Evidence；README或“兼容Node”声明不能替代物理cells。
4. 比较adopt、retain、move-to-provider、replace、remove、defer和reject；没有consumer或Evidence时不新增依赖，unknown时不猜删。
5. 在最窄scope修改manifest/lock及直接消费者；同步install/build/package/Hook/CI/Skill/documentation projection，但不复制版本真值到prose。
6. 对optional Provider建立lazy boundary，使缺失不阻断Core；对Node-only/Bun-only能力建立显式adapter，不强迫整个仓库双Host。
7. 运行manifest-lock consistency、cold/warm install、corruption recovery、runtime/platform compatibility、package surface、clean packed install和适用release checks。
8. 删除旧入口、配置和依赖时确认没有动态/生成consumer，并保留可执行rollback/retirement readback。
9. 若变化改变Target/Host/semantic contract，返回`design-required`；若属于外部Provider治理，转`govern-capability`。

## 输出合同

```yaml
schema: sec-toolchain-governance-delta-v2
decisions:
  - subject:
    disposition: adopt | retain | move | replace | remove | defer | reject
    domain:
    consumers: []
    evidenceRefs: []
manifestChanges: []
lockChanges: []
providerBoundaryChanges: []
packageSurfaceChanges: []
compatibilityResults: []
securityAndLicense: []
migrations: []
retirements: []
trustRootChanged: true | false
nextOperation: review-change | design-change | integrate-change | no-change
outcome: completed | blocked | design-required | no-change
```

## 失败与转移

- runtime/platform Evidence缺失 → blocked/defer，不用单环境成功外推。
- package/lock writer冲突 → reconcile-required。
- capability价值/权限边界未知 → `govern-capability`。
- Host/Target架构改变 → `design-change`。
- candidate完整 → `review-change`，trust root变化最终走trust migration。

## 示例

Playwright只被browser acceptance使用：移动为Browser Verification Provider，不让非Web Core安装和下载browser。

某dependency无static import但被package script动态调用：consumer census必须保留，不能依据dead-code工具单独删除。

## 资源

- `../../registry.yaml`
- `../../README.md`
- package/lock authority、runtime capability ledger、dependency graph、package surface tests
- official release/license/security sources

## 禁止

- 不为“以后可能用”加入依赖。
- 不手工维护会漂移的version表。
- 不以安装成功证明runtime/target/support完整。
- 不用ambient/global依赖、未知cache或相邻worktree冒充当前closure。
- 不同时引入多个重叠职责库而无明确迁移和退役计划。
