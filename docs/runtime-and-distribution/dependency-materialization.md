---
title: 依赖解析、物化、共享与回收
status: stable
domain: runtime-distribution
---

# 依赖解析、物化、共享与回收

本片段拥有 dependency Requirement/Binding/Generation/Projection、store、claim、资源、GC、失败和迁移语义。

本片段与 [owner root](../runtime-and-distribution.md) 共享同一 domain，但只拥有 registry 分配给本片段的 ownership keys；跨片段语义使用引用，不复制定义。

## 13. Dependency materialization

~~~mermaid
flowchart TD
  R[Dependency Requirement] --> B[Exact Binding]
  M[Retained Materializer Provider] --> B
  B --> K[Dependency Generation Key]
  K --> S[Immutable Generation Store]
  FC[Opaque Package Fetch Cache] --> S
  S --> G[Retained Dependency Generation]
  G --> P[Consumer Projection]
  P --> C[Source Program / Toolchain / Target consumer]
  G --> L[Retention and GC ledger]
  P --> L
~~~

每个dependency requirement唯一归属Core/Host/Toolchain/Verification/Generated Target/Interface/External Provider/Release。package manifest与lock单writer；Resolver、Backend、Adapter和interface不修改。不同role即使解析到相同bytes也保持不同Requirement/Binding identity；底层immutable content blobs可以去重，语义owner不能合并。

### 13.1 存储模型裁决

| Candidate | 结果 | 原因 / 避免 | 反转条件 |
|---|---|---|---|
| 每个project独立install | rejected | 重复network/process/tree validation；跨worktree无复用；并发Effect增加 | package manager能证明更低的全生命周期成本且仍保持generation identity |
| 一个workspace多用途共享目录 | rejected | generation、fetch cache、projection、lock和recovery residue生命周期混叠；path变成隐式owner | 出现无法由typed stores表达、且必须同原子事务演进的真实语义 |
| 只复用package-manager global cache | rejected | fetch cache不证明resolved tree、platform、provider或readiness | provider缓存能签发并保持完整Generation合同 |
| immutable Generation Store + consumer projections +独立fetch cache | selected | 一次materialize/verify，多consumer retain；cache可删而generation/operation state不丢 | 测量证明另一模型满足全部合同并在cold/warm/delta/GC成本上支配 |

```text
Decision purpose =
  exact dependency closure is materialized and verified at most once per GenerationKey
  ∧ every eligible consumer reuses it without inheriting another consumer's Authority/state
  ∧ cache cleanup never deletes active generation or recovery evidence

Non-goals =
  stable shared-directory name
  ∨ package-manager cache as authority
  ∨ permanent global daemon
  ∨ workspace path in semantic identity
```

目标架构没有`.shared-deps`这一semantic或storage identity。当前同名路径只属于后续`ArchitectureMigration`的observed address；迁移完成后不保留alias、dual reader、empty compatibility directory或同名test contract。

### 13.2 Contract 与 identity

```text
DependencyRequirement = {
  requirementId,
  role,
  packageManifestRef + requestedResolutionPolicyRef + installPolicyRef,
  requiredPackageAndExecutableClosure,
  targetPlatformAndArchitectureRef,
  networkScriptNativeSecretPolicyRefs,
  consumerAndFutureObligationRefs
}

ResolvedDependencyLock = {
  requirementRef,
  exact manifest/config/source revisions,
  resolved package graph + integrity/registry refs,
  resolver provider/algorithm/environment refs,
  canonical bytes + lock digest
}

DependencyBinding = {
  requirementRef,
  resolvedLockRef + lockDigest,
  installConfigDigests,
  resolvedPackageGraphDigest,
  registryAndIntegrityRefs,
  materializerProviderRef + providerEpoch,
  platformFilesystemRuntimeRefs,
  environmentPolicyDigest
}

DependencyGenerationSemantics = {
  resolvedLockDigest + installConfigDigests,
  resolvedPackageGraphDigest + localPackageContentRefs,
  registryAndIntegrityRefs,
  materializerProviderRef + providerEpoch,
  hostAbiToolchainFilesystemSemanticRefs,
  environmentAndInstallEffectPolicyDigest,
  canonical package/link/layout semantics,
  storeTrustDomainRef
}

DependencyGenerationKey = digest(
  DependencyGenerationSemantics
  + materializationAlgorithmIdentity
)

DependencyRequirementBindingKey = digest(
  requirementRef + generationKey + suitabilityProofRef
)

DependencyGenerationManifest = {
  generationKey,
  resolvedGraphRef,
  immutableTreeRootDigest,
  boundedMerkleIndexRef,
  platformRuntimeRefs,
  materializerSettlementRef,
  validationProfileRef
}

GenerationProvenanceReceipt = {
  generationKey,
  operationKey,
  exact input and provider refs,
  staged/published physical identities,
  settlement/readback refs
}
```

Requirement identity与Generation identity分离：不同role/consumer始终保留不同`DependencyRequirementBindingKey`；只有其解析后的package graph、Provider/ABI/filesystem/layout、install Effect policy与store trust domain完全等价时才能绑定同一GenerationKey。更底层immutable blobs只在content digest与trust/isolation policy允许时去重，不因此合并manifest、provenance或owner。

依赖定义、lock解析/更新、generation获取、consumer projection与release/GC是五个不同 operation：

| Operation | 可以改变 | 不得改变 |
| --- | --- | --- |
| resolve/update lock | ResolvedDependencyLock generation | immutable dependency generation、consumer projection |
| acquire generation | generation store/journal/retains | manifest、lock、resolution policy |
| project generation | consumer projection/binding | lock、generation bytes |
| release projection/retain | hold set、consumer binding lifecycle | generation content |
| collect generation | exact collectible physical generation | live hold、active claim、recovery/evidence state |

generation acquisition只消费已冻结、strict-validated的`ResolvedDependencyLock`；它绝不能在cache miss、provider mismatch或安装期间隐式更新lock。lock缺失/过期返回`lock-resolution-required`，由新的授权operation决定是否解析，不把读取路径升级成写路径。

`GenerationProvenanceReceipt`不进入`DependencyGenerationKey`，否则同一内容因attempt id不同而无法复用。timestamp、workspace、branch、PR、caller cwd、projection path、cache path和消费顺序都不进入key。provider binary/config/environment、native ABI、package script policy、local workspace package content或canonical link/layout语义改变会产生新GenerationKey；只改与dependency closure无关的产品源码不产生新generation。time-varying vulnerability/support policy只改变Requirement Binding的eligible/use decision与Evidence freshness，不重写相同物理generation identity。

```text
CanShareGeneration(a,b) =
  generationSemantics(a) = generationSemantics(b)
  ∧ both requirements permit the same storeTrustDomain
  ∧ each has an independent current suitability proof

CanDeduplicateBlob(a,b) =
  contentDigest(a) = contentDigest(b)
  ∧ isolation/retention/encryption policy permits shared physical bytes
```

```text
RetainedDependencyGeneration = opaque {
  generationRef + physicalGenerationRef,
  retainedRootCapability,
  immutableManifestCapability,
  allocationRef + leaseRef,
  verifyCurrent(), release()
}

DependencyProjectionReceipt = {
  consumerSubjectRef + requirementRef,
  retainedGenerationRef,
  projectionMode,
  exact target preimage/physical binding,
  publication and final readback,
  lifecycle/retirement refs
}
```

consumer只获得opaque retained generation或projection receipt，不获得“可信path”。Source Program、typecheck、audit和test-impact绑定同一generation ref；Target workspace需要生态规定的`node_modules`时，它只是可替换projection address，不是generation owner。

consumer同时声明`ConsumerAccessContract = direct-read | immutable-locator | copy-on-write-projection | isolated-materialization`及write/relocatability要求。包含absolute path、consumer-specific native output或会写dependency tree的工具不能绑定read-only shared projection；Implementation Resolution必须选择隔离projection/materialization或typed unavailable，不能让consumer修改immutable generation。

### 13.3 Store 与 capability 分工

| Concern | Store / capability | 可删除条件 | 不能承担 |
|---|---|---|---|
| immutable generation tree/manifest | `ImmutableContentStore` | retain=0、无active consumer、retention到期、无recovery/evidence hold | operation lock、mutable cache |
| materialization claim/journal/recovery | `CoordinationStore` + dependency Domain state | terminal并完成retention/compaction | package bytes、consumer truth |
| consumer→generation binding | dependency Domain state | projection retired且consumer-zero | filesystem path authority |
| package tarball/registry/download cache | provider-issued `PackageFetchCacheCapability` | 任意未被active provider retain时 | readiness、integrity、Generation identity |
| staging/quarantine | operation-owned bounded physical allocation | settlement-authorized cleanup/readback | normal consumer input |

Store是port而不是固定目录。local profile、CI profile和team profile可分别绑定retained filesystem、artifact store或远端CAS；StorageProfile从logical key生成Address，Address不回写identity。Bun cache、OCI cache、Bazel/Nix/pnpm等成熟机制只有在满足对应port conformance且实测非支配时才能成为Provider；SEC不复制其下载/内容存储算法，也不接受其“cache hit”作为generation readiness。

SEC local Bun profile 的职责绑定已确定，但物理地址仍由Runtime State/Cache layout owner派生：

| Logical storage | Local profile binding | Scope / isolation |
| --- | --- | --- |
| immutable generation manifests/trees/Merkle shards | repository外、owner-retained Runtime Cache namespace | machine principal + store trust domain；可跨workspace/repository复用 |
| materialization claims/transitions/recovery/holds | repository外 durable Runtime State namespace | generation-key scope；跨进程CAS/fencing |
| consumer binding/projection lifecycle | consumer/workspace Domain State | consumer subject + requirement binding |
| Bun registry/package fetch cache | Bun Provider-private Runtime Cache namespace | provider epoch/credential policy；可任意失效，不参与ready |
| projection address such as ecosystem `node_modules` | exact consumer workspace physical authority | per-consumer lifecycle；仅Address |

Runtime Cache丢失使generation observation成为conclusive absent或unresolved，不使已有PASS继续有效；Runtime State丢失是recovery/authority failure，不能按cache miss重建。generation store、provider cache和state namespaces必须物理隔离并由同一layout owner证明都在repository外；业务代码看不到它们的path。

### 13.4 Materialization、retain 与 projection 状态机

~~~mermaid
stateDiagram-v2
  [*] --> Observed
  Observed --> Ready: exact generation verified
  Observed --> Absent: conclusive store miss
  Observed --> Unresolved: unsafe/permission/schema/provider/coverage failure
  Absent --> Claimed: authorized operation key CAS
  Claimed --> Staging: intent durable before Effect
  Staging --> Materialized: provider settled
  Materialized --> Verified: tree manifest and policy checks
  Verified --> Published: immutable no-replace publication + readback
  Published --> Ready
  Claimed --> RecoveryRequired: lost handle/partial/unknown
  Staging --> RecoveryRequired
  Materialized --> RecoveryRequired
  Verified --> RecoveryRequired
  Ready --> Retained: generation lease/allocation
  Retained --> Ready: release
  Ready --> Retiring: consumers zero + retention/holds closed
  Retiring --> Retired: exact deletion + readback
  Retiring --> Residue: partial cleanup/physical ambiguity
~~~

```text
acquireGeneration(requirement, resolvedLock, grant, parentAllocation):
  binding := bindExactResolvedLock(requirement, resolvedLock)
  key := compileGenerationKey(binding)
  observation := generationStore.observe(key, parentAllocation)
  match observation:
    Ready      -> retain exact physical generation
    Absent     -> require materialization Effect grant; claim or join key
    InFlight   -> join authenticated operation within caller remaining budget
    Unresolved -> typed block; zero install/publish/delete

materialize(claim):
  persist intent before directory/network/process Effect
  allocate stage + process + input/output/entry/byte/network dimensions once
  invoke retained materializer with opaque fetch-cache capability
  settle descendants/streams/cache use
  build bounded Merkle manifest while bytes are already observed
  verify package graph/layout/policy/platform
  publish immutable generation by no-replace CAS
  if the same GenerationKey already names different manifest/Merkle bytes:
    quarantine the candidate and return provider-nondeterministic/generation-conflict
  read back root/manifest/tree identity
  terminalize journal; issue retained capability
```

同一GenerationKey跨进程只有一个active claim；其他caller join，不依赖进程内Promise map。caller deadline短于in-flight剩余时返回typed deadline，不延长root operation。lost handle先读journal/store/provider/domain result，只有conclusive not-applied才能重试；partial/unknown进入recovery-required。

Materializer默认禁止dependency lifecycle script、native build、外部网络写、secret读取和stage外写入；Requirement明确声明后，Admission才为每类Effect签发独立ticket/allocation。Provider必须在受控stage/cwd/minimal environment中执行，观测descendants与输出，并证明没有未声明的external mutation；当前Host无法提供所需隔离/观察时该Provision为ineligible，不得运行后再把产物标成共享generation。secret值不进入GenerationKey或manifest；registry/endpoint/integrity、credential issuer/epoch与允许的Effect policy分别进入Binding/provenance/eligibility。

projection操作独立于materialization：它消费retained generation、consumer requirement和exact target preimage，在自己的EffectTicket内选择locator、reflink/hardlink或bounded copy Provider，发布后重验source generation、target physical identity和consumer binding。projection冲突不覆盖；consumer不能通过已有目录、stamp或symlink自我收养。

Projection Resolution按consumer合同确定，不做运行时猜测或隐式fallback：

```text
if consumer accepts explicit immutable dependency root:
  direct-read retained generation
else if consumer is read-only and retained locator Provider is conforming:
  publish authenticated immutable locator
else if consumer needs a writable tree and copy-on-write Provider is conforming:
  publish isolated copy-on-write projection
else:
  materialize bounded isolated projection or return typed unavailable
```

locator的reparse/junction/symlink身份与最终target必须作为一个retained capability验证；hardlink/reflink/copy是否共享inode、ACL或mutation风险由Provider contract说明。任何可能修改依赖树的consumer不得获得可回写immutable store的projection。

### 13.5 Readiness、完整性与性能

第一次materialization在同一streaming inventory中计算entries/bytes/Merkle shards和root digest；禁止为了预算先全扫一次、为了hash再扫一次。immutable publication后，store以write exclusion/ACL或等价Provider机制保持bytes不变：

| Path | 必须做 | 不再做 |
|---|---|---|
| cold | full provider materialization + bounded streaming verification | 同一输入重复install |
| warm retain | root/manifest physical identity、store epoch、manifest digest、hold/lease admission | 每consumer全树重扫 |
| consumer read | 读取实际需要的Merkle shard/file并绑定ContentSnapshot | 信任path-only stamp |
| invalidation | writer/ACL/store epoch/watch hint触发affected shard/root revalidation | watcher event直接判真 |
| corruption | quarantine exact physical generation；旧capability失效；typed recovery/rematerialization | 原key原地覆盖、catch为cache miss |

缓存关闭、cold、warm、跨进程join和distributed store对同一GenerationKey产生同一manifest/tree语义。性能Claim至少测量resolve、materialize、tree validation、retain、projection、consumer read、release和GC；只比较install wall time不足以选择方案。

### 13.6 Resource、GC 与失败代数

materialization、join、projection、retain、readback、recovery和cleanup消费调用operation的同一absolute ledger。适用维度至少包括wall/monotonic time、process/descendant、input/output/record、filesystem entries/bytes/depth、network bytes/requests、disk reservation、open handles与retry。Provider static timeout不能扩大parent remaining。

```text
DependencyFailure =
  requirement-invalid | lock-resolution-required | binding-unavailable |
  credential-unavailable |
  network-not-authorized | generation-absent | generation-incompatible |
  generation-unverified | generation-mutated | generation-conflict |
  provider-nondeterministic | materialization-in-flight |
  budget-exhausted | projection-conflict | recovery-required | residue |
  provider-failed | store-unavailable
```

只有`generation-absent`是可触发materialization的store事实；`unverified`、permission、reparse、schema、deadline、I/O和unknown都不能降级为absent。GC是dependency lifecycle owner的独立operation：从retains、consumer bindings、active claims、recovery/evidence holds与retention policy计算候选，再对exact physical generation CAS删除并readback；目录年龄、磁盘压力、ignore规则或“当前无人import”不能直接授权删除。

GC不依赖脆弱的单一refcount，而是从typed roots做bounded mark-and-sweep：

```text
GenerationHoldRoot =
  ActiveOperationClaim(operationKey,fencingToken)
  | LiveRetain(lease,consumer/process)
  | DurableConsumerBinding(consumer,requirementBinding)
  | RecoveryHold(transition/residue)
  | ReproducibilityHold(claim/evidence,retentionPolicy)

Collectible(generation) =
  no reachable GenerationHoldRoot
  ∧ all related transitions terminal
  ∧ retention/support policy expired
  ∧ root/manifest physical identity unchanged
```

LiveRetain由协调store的时间域与fencing token过期；DurableConsumerBinding只能由consumer retirement/readback移除；RecoveryHold与ReproducibilityHold不能因进程死亡或磁盘压力清除。mark snapshot与delete之间必须再做hold-set CAS和physical fence，失败即保留候选。

### 13.7 Evolution 与实现交接

旧多用途root迁移由独立`ArchitectureMigration`生成，不进入normal reader：先对exact source graph做只读分类与物理/内容证明；合法generation可一次导入immutable store并签发provenance，fetch cache只作为disposable input；迁移consumer projections后切换唯一reader/writer，consumer-zero与recovery/evidence closure成立才退役旧root。未知、foreign、partial或schema drift保持typed residue；不创建默认字段、路径alias或永久dual-read。

实现前必须冻结以下交接项：

| Package | 必须确定 |
|---|---|
| logical | Requirement/Binding/Generation/Projection/Failure ADTs与状态机 |
| target implementation | store ports、retained capabilities、operation plans、storage/profile bindings、GC |
| conformance | cold/warm/delta/cache-disabled equivalence、single materialization、crash/recovery、corruption、ABA、projection conflict、offline/provider substitution |
| migration | exact observed roots、object disposition、import/cutover/retirement mapping；不得回写本target |

负面场景必须覆盖：permission/reparse/foreign tree、same-path ABA、manifest/lock/provider/environment drift、cache corruption、generation mutation、并发caller、短deadline join、crash at every transition、lost process handle、partial projection、GC与retain竞争、offline absent、credential/network unavailable、consumer删除后retention、provider替换。每个场景断言typed terminal/residue和零未授权install/publish/delete，而不是只断言错误字符串。

Journal/stamp/manifest 使用 retained non-reparse identity、shared operation budget、prepared-before-effect、typed unknown/recovery。readiness error 不能 catch 为 absent 后 install。
