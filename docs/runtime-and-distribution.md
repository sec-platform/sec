---
title: 运行时与分发
status: stable
domain: runtime-distribution
last-reviewed: 2026-08-03
---

# 运行时与分发

本文唯一拥有 **Host Runtime Profile、Toolchain Provider、Optional Capability Adapter、package/runtime layout、公开分发和 Support Claim maturity**。生成目标的 **Target Profile** 只由 `docs/compiler-target-ir.md` 拥有；Verification Result/Evidence 只由 `docs/verification-governance.md` 拥有；Compatibility 只由 `docs/change-management.md` 拥有。

精确版本、依赖清单、可执行路径、release schedule、当前支持矩阵和 physical Gate 结果属于 package metadata、代码合同、release profile 与 Evidence，不复制到稳定 prose。

## 唯一轴与禁止推断

- **Host Runtime Profile**：执行 SEC CLI、Workbench server 或 adapter 的 OS、runtime family、filesystem、process、network 与 capability identity。
- **Toolchain Provider**：install、test、typecheck、bundle、format 等工程命令的 executable、version、argv 和 environment authority。
- **Optional Capability Adapter**：native、FFI、container、browser、OS hardening 或平台专有能力。
- **Package Profile**：公开 package、bin、exports、resources、templates、migrations、optional assets 与 runtime layout。
- **Distribution Profile**：artifact、container、native bundle、registry、install/update/rollback 与 release channel。
- **Support Claim**：对一个明确 identity 的成熟度陈述；不等于 Verification、Compatibility 或“曾经成功运行”。

禁止以下推断：

```text
当前 Host 成功 ≠ 其他 Host 受支持
当前 Host         ≠ 生成 Target
process.execPath   ≠ Toolchain Provider
package built      ≠ package deployed
physical test pass ≠ product-supported
```

## Host Runtime Profile

Host Profile 至少绑定：

- OS family/version、architecture 与 filesystem assumptions；
- runtime family/version、process model、signal/termination、environment allowlist；
- browser/container/native availability；
- writable roots、cache roots、temporary roots 与 isolation boundary；
- capability result：`available | unavailable | unsupported | unresolved`；
- profile revision 与 invalidation rules。

Host probing 只产生 Observation/Evidence。它不能修改 Semantic、Compiler Target、Compatibility 或 Support truth。

## Toolchain Provider

每类命令只有一个 provider owner。Provider contract 至少包含：

```text
providerId
providerRevision
executableIdentity
argvContract
environmentBinding
workingDirectoryPolicy
inputDigest
outputProtocol
settlementProtocol
```

同一命令不得同时由 PATH、package script、runtime shim 与 native helper多路猜测。未解析 executable/version/environment 必须返回显式 unavailable/unsupported，而不是回退到“当前机器似乎能跑”。

## Optional Capability Adapter

Adapter 只能实现边界能力，不拥有产品语义。至少声明：

- capability ID、适用 Host/Profile、input/output protocol；
- Effect、permission、resource、timeout 与 cleanup；
- provider/native revision 与 provenance；
- unavailable、unsupported、invalidated 与 failure 的独立结果；
- fallback 是否存在；存在时 fallback 必须是显式策略，不能静默降级。

AI、脚本或 plugin 可以调用 Adapter，但不能凭调用成功创建 Support Claim。

## Package 与 Runtime Layout

公开 package 必须显式列出：

- public exports、CLI bins 与 executable ownership；
- runtime resources、templates、migrations、browser/native artifacts；
- production/runtime dependencies 与 development-only dependencies；
- install/postinstall 行为、offline/zero-install 边界；
- path resolution、symlink、read-only install、workspace 与 packaged layout；
- package manifest、lock、artifact digest 与 provenance。

开发仓库路径不是公开 runtime contract。任何依赖源码相对路径、workspace-only hoist、隐式 CWD 或未声明资源的 package 都不具备 distributable maturity。

## Distribution

Distribution 流程固定为：

```text
validated package profile
→ deterministic build
→ artifact digest/provenance
→ installability proof
→ runtime smoke/acceptance
→ rollback/update proof
→ release publication
→ post-publication readback
```

Release credential、artifact upload、registry publication 与 deployment 都是 Effect；必须使用 capability、exact identity、journal/readback 和 cleanup settlement。静态 workflow 检查不能替代 physical run。

## Support Claim maturity

Support Claim 唯一状态机：

```text
proposed
→ contract-frozen
→ implemented-in-main
→ physically-verified
→ packaged-deployed
→ product-supported
```

每次转换只能从直接前驱发生，并必须记录：

- subject identity 与 revision；
- predecessor claim；
- required Verification claim/Evidence；
- required Compatibility result；
- package/deployment identity；
- owning environment；
- transition authority、time、reversal/invalidation rules。

状态含义：

- `proposed`：只有候选边界，无实现或支持承诺；
- `contract-frozen`：接口、capability、failure 和 Evidence 要求已冻结；
- `implemented-in-main`：实现已进入唯一 canonical main；
- `physically-verified`：owning environment 的 Verification claim 完整通过；
- `packaged-deployed`：真实 package/artifact 已安装或部署并 readback；
- `product-supported`：产品入口、文档、升级/回滚和持续维护责任已同时闭合。

任何测试 PASS 只能贡献 `physically-verified` 的输入，不能跳到 `product-supported`。任何 Compatibility 未闭合、Evidence 失效、package 回滚失败或运行环境变化都必须阻止或反转 promotion。

## 与其他 owner 的接口

| 输入/输出 | 唯一 owner | 本文职责 |
| --- | --- | --- |
| Target Profile | Compiler Target IR | 只消费生成产物的 runtime/package requirements |
| Verification Gate/Claim/Evidence | Verification Governance | 只引用 exact claim/Evidence，不重算真值 |
| Compatibility | Change Management | 只要求 promotion 前兼容性闭合 |
| Operation/Capability permission | Development Governance | 只实现 runtime/provider capability |
| Workbench/AI transport | Workbench & AI | 只提供 bounded adapter，不授权支持 |

## 验收

- Host、Target、Toolchain、Adapter、Package、Distribution 六个 identity 不互相推断；
- 同一命令只有一个 Toolchain Provider；
- package 在 packaged layout、read-only install 和 clean environment 中可运行；
- artifact、credential、publication 与 rollback 都有 physical Evidence/readback；
- Support Claim 只能逐级转换，且不会复制 Verification 或 Compatibility truth；
- unsupported、unavailable、invalidated 与 failed 不被压成同一布尔值；
- stable prose 不保存会过期的版本、路径、矩阵或 Gate 结果。
