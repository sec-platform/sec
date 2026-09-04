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

## 15. Distribution package 与 extension

`DistributionPackage`只在一组内容确有独立acquisition、integrity/trust、release/support或migration/retirement lifecycle时成立。它是物理分发单位，不是Domain、Responsibility、Capability、implementation、source目录或默认“芯片”层：

```text
DistributionPackage = exact {
  packageIdentityRef,
  immutableContentAndManifestRefs,
  suppliedContract/Provision/ArtifactProducerRefs,
  distributionSourceAndTrustPolicyRefs,
  targetCompatibilityAndSupportRefs,
  migrationAndRetirementRefs,
  packageDigest
}
```

```text
distributionPackageRequired(candidate) iff
  real producer and consumer
  and independent distribution/trust/support/evolution lifecycle
  and deleting the package boundary worsens accepted outcome or lifecycle cost
```

没有该证明时，使用普通PublicContract、Port、ImplementationCandidate、Provision或authored ImplementationUnit；不创建空manifest、版本、resolver、facade或目录。package components只由真实consumer闭包决定，不能预设统一大清单。

Registry/catalog、OCI、language package registry、Git release、local signed archive或其他source都是可替换`DistributionSource` Provisions。External Provider owner证明endpoint/principal/credential/protocol/identity/security；分发owner只消费其opaque observation。core不拥有一个全局Registry，也不按search order或“唯一命中”授权。

```mermaid
flowchart LR
  Q[Acquisition Requirement] --> S[Eligible DistributionSource Provisions]
  S --> DB[Exact Distribution Binding]
  DB --> C[Package-delivered candidate/content refs]
  C --> IR[Implementation Resolver]
  N[Native/existing/governed candidates] --> IR
  IR --> IB[ImplementationBinding]
  IB --> M[Admitted acquisition/materialization]
```

Distribution Binding只证明从何处取得哪组exact content；Implementation Binding才表示产品采用哪个实现。resolution保持pure，下载、install、Generator、migration和materialization都在选择后经统一Effect/资源/settlement链执行。consumer冻结Binding后不得重扫live source或重新选择。

“Extension”是一个public surface用例，不是额外实体：

| extension need | canonical composition |
| --- | --- |
| local pure alternative | PublicContract/Port + ImplementationCandidate + conformance |
| stateful或Effectful alternative | 上述关系 + Provider + Requirement/Grant/Allocation/Settlement |
| independent distributed alternative | 上述关系 + DistributionPackage/Binding |
| opaque third-party code | ExternalBinding + disclosure/security/unknown ceiling |

只有真实external/plugin consumer需要稳定发现和替换时才公开extension port；普通callback、strategy function或内部算法不升格。动态callback、ambient capability、caller object和test seam不能绕过Provider/Authority边界。

当前实现中的历史载体只作为迁移输入映射一次，不能继续定义target语义：

| observed legacy carrier | target relation | 处置 |
| --- | --- | --- |
| Block identity | 通过存在证明则DistributionPackage；否则拆为contract/candidate/artifact refs | 不保留同名target type |
| Block Capability / Provider Binding | Requirement/Provision/DistributionBinding/ImplementationBinding | 不复制第二套resolver algebra |
| Generator declaration | compiler pass或ArtifactProducer definition | Effect与materialization另行准入 |
| Registry | DistributionSource Provider | 不成为repository/product truth owner |
| Slot | contract、binding、work/evidence关系的旧混合record | 仅migration parser读取；target无Slot identity |

迁移必须total preservation：现有语义、资产、producer/consumer、installed workspace、upgrade/recovery、external obligation各有`preserve | transform | retire | quarantine | unresolved`；正常路径不dual-read/dual-write，旧consumer-zero后删除旧parser、resolver、authority key与地址。

版本域保持正交：package release、contract schema、Provider protocol、Target compatibility与migration grammar不能互相借用。任一版本只有真实durable/external reader或support/migration branch存在时才成立。

## 16. Public distribution

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

## 17. Support invalidation

EOL/security policy、dependency support drop、Provider withdrawal、Binding invalidation/Delta、Compatibility invalidation、package smoke failure、platform/ABI regression、incident 或 artifact不可重现都使 Support invalidated。

失效后停止新承诺，保留 affected Binding/Delta/Compatibility/environment/Evidence，选择 fix/re-resolution/migration/deprecation/retirement，重新完成 physical package/deploy proof 后才能恢复。README table、旧 PASS 或仍可安装不能覆盖。

## 18. 无代码逻辑验证

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
| 只有local pure implementation | 普通candidate/ImplementationUnit | 创建DistributionPackage或extension runtime |
| distribution candidate唯一 | 仍检查trust/compatibility并由Implementation Resolver采用 | 自动授权或first-found |
| package source不可用 | typed unavailable；零下载/install | 裸网络/本地fallback |
| 历史Slot/Block record存在 | isolated migration input | 恢复normal双读或同名target identity |
| release build来自dirty tree | reject | copy后hash |

## 19. 完成条件

~~~text
RuntimeClosed =
  runtime-neutral core
  AND one Bun Host generation
  AND provisioning separated from adoption
  AND retained capability plus shared budget and settlement
  AND Source Program and Verification truth not duplicated
  AND dependency generation has one owner and recovery
  AND distribution package is optional and existence-proven
  AND distribution binding != implementation binding != materialization
  AND extension uses ordinary contract/provider relations without a second object model
  AND legacy packaging/slot carriers are migration-only and consumer-zero after cutover
  AND Host Toolchain Target Runtime axes remain orthogonal
  AND release is clean reproducible and read back
  AND Support can be invalidated and recovered
~~~
