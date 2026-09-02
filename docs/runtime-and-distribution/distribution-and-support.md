---
title: 平台能力、分发与支持
status: stable
domain: runtime-distribution
---

# 平台能力、分发与支持

本片段拥有 browser/container/native 分类、public distribution、support invalidation、逻辑验证与完成条件。

本片段与 [owner root](../runtime-and-distribution.md) 共享同一 domain，但只拥有 registry 分配给本片段的 ownership keys；跨片段语义使用引用，不复制定义。

## 14. Browser、container、native

Browser Provider 只服务 Target workspace 的真实 browser Acceptance，不构成 SEC core UI/Workbench runtime。request-only/DOM-free/pure semantic tests 选择更窄 Provider；文件名不决定 capability。

Container、process containment、native helper、FFI、test environment 是 Optional Capabilities。缺失、unsupported、not-run、failed 分离；是否 block 由 Requirement/Compatibility/Support owner 决定。temp/process/browser context 本身不是 malicious-code sandbox。

## 15. Public distribution

~~~mermaid
sequenceDiagram
  participant R as Exact release revision
  participant B as Release builder
  participant V as Verification
  participant P as Publisher
  R->>B: clean tree + exact Binding + accepted generation
  B->>V: package exports assets dependencies SBOM
  V-->>B: host/target install runtime Evidence
  B->>P: signed artifact + checksum + attestation
  P-->>B: publication receipt
  B->>B: remote/local readback
~~~

不得从 live working tree 递归复制或 force-push 重写 public main。公开 projection allowlist 排除 private docs/session/secret/Registry/cache/test residue/nonpublic Provider。

验证覆盖 exports/entry/launcher/module policy、assets、dependencies/license/native/install scripts、declared Hosts、Target deps、cross-host determinism、privacy/permissions/metadata、SBOM/signature、rollback/yank/deprecation/migration。

## 16. Support invalidation

EOL/security policy、dependency support drop、Provider withdrawal、Binding invalidation/Delta、Compatibility invalidation、package smoke failure、platform/ABI regression、incident 或 artifact不可重现都使 Support invalidated。

失效后停止新承诺，保留 affected Binding/Delta/Compatibility/environment/Evidence，选择 fix/re-resolution/migration/deprecation/retirement，重新完成 physical package/deploy proof 后才能恢复。README table、旧 PASS 或仍可安装不能覆盖。

## 17. 无代码逻辑验证

| 场景 | 必须结果 | 禁止 |
|---|---|---|
| Bun缺失但Node存在 | Host unavailable | Node fallback |
| tool未安装 | adoption unavailable | session下载工具 |
| checker mismatch | zero typecheck Effect | ambient PATH checker |
| warm cache与clean输出不同 | cache invalid | warm结果 authority |
| child exit 0但descendant活着 | settlement failed/unknown | completed |
| target为Node、SEC host为Bun | 两轴同时合法 | 推断同一 runtime |
| dependency scan EACCES | unresolved | cache miss/install |
| lock/journal schema drift | migration/recovery-required | 默认字段兼容 |
| browser已从SEC core退役 | core正常；Target browser仍可选 | 删除Target capability |
| release build来自dirty tree | reject | copy后hash |

## 18. 完成条件

~~~text
RuntimeClosed =
  runtime-neutral core
  AND one Bun Host generation
  AND provisioning separated from adoption
  AND retained capability plus shared budget and settlement
  AND Source Program and Verification truth not duplicated
  AND dependency generation has one owner and recovery
  AND Host Toolchain Target Runtime axes remain orthogonal
  AND release is clean reproducible and read back
  AND Support can be invalidated and recovered
~~~
