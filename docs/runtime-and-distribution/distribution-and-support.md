---
title: 平台能力、分发与支持
status: stable
domain: runtime-distribution
---

# 平台能力、分发与支持

本文拥有可选宿主能力、DistributionPackage/DistributionSource、公开发行、extension surface和Support生命周期。它不拥有产品语义、Implementation Resolution、外部Provider业务真值或物理Effect执行。

## 1. Browser、container、native 等宿主能力

Browser、container、process isolation、native helper、FFI、GPU/设备环境等都是**按Target/Requirement激活的可选能力**。缺失、unsupported、not-run、failed分开；是否阻塞由实际consumer requirement决定。

浏览器只在目标成品确实需要DOM/browser API时进入闭包；request-only、DOM-free或纯semantic测试选择更窄Provider。Container/process context本身也不是malicious-code sandbox，真实隔离取决于capability/OS boundary。

## 2. DistributionPackage 的存在证明

`DistributionPackage`只在一组内容确有独立 acquisition、integrity/trust、release/support或migration/retirement lifecycle 时成立：

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

存在条件：

```text
distributionPackageRequired(candidate) iff
  real producer and consumer
  and independent distribution/trust/support/evolution lifecycle
  and deleting package boundary worsens accepted outcome or lifecycle cost
```

否则使用普通PublicContract、ImplementationCandidate、Provision、ImplementationUnit或artifact member，不创建空manifest、resolver、facade和版本层。

## 3. DistributionSource 与 Binding

OCI、language package registry、Git release、local signed archive、organization artifact store等都是可替换`DistributionSource` Provisions。

```text
AcquisitionRequirement
→ eligible DistributionSource Provisions
→ exact DistributionBinding
→ exact content/candidate refs
→ Implementation Resolution
→ ImplementationBinding
→ admitted materialization Effect
```

**DistributionBinding != ImplementationBinding != Materialization。**

DistributionBinding只说明从哪里、按何种trust/integrity取得哪组内容；ImplementationBinding说明产品采用哪个实现；materialization才执行下载/安装/解包/生成/写入。

Resolver保持pure，不扫描live source并同时下载。Consumer冻结Binding后也不在执行中重新搜索“更近/更新”的source。

## 4. Package与实现选择正交

一个ImplementationCandidate可以：

- 已存在于当前repository；
- 由用户直接提供源码；
- 来自已安装环境；
- 由DistributionPackage交付；
- 来自remote/native/device Provider。

Package名、版本、下载量或registry排名不产生业务资格。Package-delivered candidate仍要通过合同、Target、Effect/Permission、security、license、support和Evidence等统一eligibility。

一个package也可以交付多个独立candidate/assets，但不能因同包就把它们合成同一semantic responsibility。

## 5. Extension 是公共用例，不是第二对象模型

Extension需要由普通关系组合：

| extension need | canonical composition |
|---|---|
| local pure alternative | PublicContract/Port + ImplementationCandidate + conformance |
| stateful/Effectful alternative | 上述关系 + Provider + Requirement/Grant/Allocation/Settlement |
| independently distributed alternative | 上述关系 + DistributionPackage/Binding |
| opaque third-party code | ExternalBinding + disclosure/security/unknown ceiling |

只有真实external/plugin consumer需要稳定发现、替换或独立发布时才公开extension port。普通callback、strategy function或内部算法不升格成extension subsystem。

Extension port不能绕过Provider/Authority/Effect边界。动态callback、caller object、ambient service locator或test seam也不能形成隐藏能力注入。

## 6. 版本轴正交

至少区分：

- package release revision；
- public contract/schema revision；
- Provider protocol revision；
- Target compatibility/profile revision；
- ImplementationBinding revision；
- migration grammar/state revision。

只有真实durable/external reader、consumer或support branch存在时才需要相应version。一个版本号不能代替另一轴的compatibility判断。

## 7. 依赖和安装脚本

分发manifest与lock必须覆盖实际运行closure：直接/传递依赖、native runtime、assets、install/build scripts、license、integrity与平台条件。

安装脚本属于Effectful供给，不能在pure resolution/inspection阶段隐式执行。需要安装/构建时形成明确Operation，接受authority/resource/security和settlement检查。

## 8. Public distribution

公开发行至少从clean exact source/Binding generation建立：

```text
exact release input
→ build deterministic package/artifacts
→ verify exports/entry/assets/dependencies/license/security
→ verify declared target install/runtime
→ sign/checksum/SBOM/attestation as required
→ publish
→ remote/local readback
```

不得从live dirty worktree递归复制后称为正式release。公开projection按disclosure policy排除private docs、secret、runtime state、test residue和非公开Provider信息。

Artifact upload成功不等于publication/adoption terminal；真实repository/registry readback和support状态另行结算。

## 9. Support lifecycle

Support是关于“某个准确artifact/Binding在指定target/environment下仍被承诺”的状态，不是“还能下载”。以下变化可使Support失效：

- EOL/security policy；
- dependency/provider support drop；
- Binding/Compatibility invalidation；
- install/runtime smoke failure；
- platform/ABI regression；
- incident；
- artifact不可重现；
-必要Evidence过期。

失效后停止新承诺，保留affected Binding/Delta/Compatibility/environment/Evidence，选择fix/re-resolution/migration/deprecation/retirement。重新建立对应physical+Verification证据后才能恢复。

## 10. Deprecation、yank 与 retirement

Deprecation通知未来support改变；yank阻止新采用但不抹除已经绑定/发布的历史artifact；retirement需要实际consumer/effect/recovery/support horizon闭合。

旧package/contract reader只有在真实durable consumer仍存在时保留。为了“兼容一切”永久双读或自动fallback不是默认策略。

## 11. 完成条件

```text
DistributionAndSupportClosed =
  host/target capability axes remain orthogonal
  AND provisioning separated from adoption
  AND DistributionPackage is optional and existence-proven
  AND DistributionBinding != ImplementationBinding != materialization
  AND extension uses ordinary contract/provider relations
  AND package/runtime closure includes real assets/dependencies/scripts
  AND public release is reproducible and read back
  AND support can be invalidated, migrated and retired
```

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

分发只在真实acquisition/trust/support生命周期存在时建立Package/DistributionBinding；实现选择、安装Effect和Support分别拥有自己的identity与资格。Extension复用普通Contract/Provider/Binding关系，不形成第二插件对象模型；公开发行与支持以准确closure、验证和readback为准。
