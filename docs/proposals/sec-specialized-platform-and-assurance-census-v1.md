---
title: SEC 专用平台、密码、ML 与 Assurance 技术谱系 v1
status: draft
domain: proposal
tracking: issue-225
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
merge-policy: spike-default-no-merge
last-reviewed: 2026-08-01
---

# SEC 专用平台、密码、ML 与 Assurance 技术谱系 v1

> 本文继续扩展全球技术谱系，但不把专用领域强塞进通用 Core。核心裁决：复杂平台通过专用 Provider、Target Profile、Resource/Effect Contract、Verification 与 Governed/Opaque Boundary 接入；没有通用 IR 能完整替代这些领域模型。

## 1. GPU、加速器与异构计算

### CUDA

- 来源：NVIDIA CUDA Programming Guide。
- 核心：host/device、kernel、thread/block/grid、SIMT、memory hierarchy、stream/event、asynchronous execution、compute capability、PTX/binary compatibility、多GPU和resource limits。
- SEC 裁决：**Target/Runtime Provider**。
- 必须建模：

```text
accelerator family/device identity
compute capability / architecture
host-driver-toolkit versions
kernel signature and launch geometry
memory space and ownership
stream/event dependency
synchronization and memory model
resource budget / occupancy
binary/PTX/source compatibility
numerical precision/determinism policy
profiling/benchmark evidence
```

- 永久边界：GPU kernel内部算法可以保持 Governed Extension；普通 Behavior IR 不试图表达全部SIMT/memory barrier/intrinsics。
- `kernel launch returned`不等于执行成功；异步error、device sync、stream completion和memory visibility必须进入Evidence。

### ROCm / HIP

- 来源：AMD ROCm官方文档。
- 裁决：独立Provider，不把“CUDA-like”解释为兼容。
- 同一个高层kernel需要分别验证compiler、runtime、ISA、device library、memory/atomic和performance；HIP可移植性是候选Evidence，不是支持声明。

### Metal

- 来源：Apple Metal Programming Guide。
- 核心：MTLDevice、command queue、command buffer、encoder、pipeline state、resource/buffer/texture、ordered queue与completion status。
- SEC 裁决：Apple GPU Provider。
- queue/command buffer/resource lifetime和CPU/GPU synchronization属于独立资源图，不能映射为普通function call。

### 通用 Accelerator Profile

```yaml
accelerator:
  family:
  architecture:
  deviceCapabilities:
  compilerProvider:
  runtimeProvider:
  memoryModel:
  synchronization:
  kernelArtifacts:
  numericalPolicy:
  resourceBudget:
  owningVerificationEnvironment:
```

统一profile只定义公共槽位；具体CUDA/ROCm/Metal语义由Provider owning schema扩展。

## 2. eBPF、Kernel 与 Driver

### eBPF

- 来源：Linux kernel BPF documentation。
- 核心：instruction set、verifier、program/map types、helpers/kfuncs、BTF、attach points、libbpf/CO-RE。
- SEC 裁决：Linux Kernel Provider。
- 必须区分：
  - source C/Rust；
  - BPF bytecode；
  - BTF/CO-RE relocation；
  - kernel verifier result；
  - map/pin/link lifetime；
  - attach/detach Effect；
  - kernel version/config/capability。
- Verifier接受只证明目标kernel下的安全/结构约束，不证明业务policy、观测完整性或运行性能。

### Kernel module / Driver

- 默认 Opaque/Governed Extension。
- 需要：ABI、kernel config、privilege、device identity、DMA/MMIO/interrupt、concurrency、power/lifecycle、fault injection和hardware-in-loop Evidence。
- 用户态unit test不能替代目标kernel/device物理证明。

## 3. 移动应用

### Android

- 来源：Android Developers activity/lifecycle/permissions/background execution官方文档。
- 核心：process不是app lifetime authority；Activity/Fragment/Service/Work/Compose有不同lifecycle；manifest、runtime permission、intent、component export、background constraints和OS version共同决定行为。
- SEC需要独立表达：

```text
application/process/component/scene identity
manifest-declared component and permission
runtime permission state
intent/deep-link contract
foreground/background lifecycle
saved-state/restoration
OS/API/device capability
package/signing/store release
UI/resource/configuration variants
instrumented-device evidence
```

### Apple platforms

- 来源：Apple UIKit scene lifecycle、App Sandbox、entitlement和store文档。
- 核心：app process、scene、document/window和background task生命周期分开；entitlement、provisioning、code signing、privacy usage description、device permission和store profile决定能力。
- 当前官方路线要求新SDK采用scene-based lifecycle；这证明生命周期约束会随平台版本变化，必须由versioned Provider而非Core硬编码。

### 移动端边界

- simulator不能替代真实device所有Evidence；
- app installed/launch成功不证明permission/background/push/store支持；
- mobile Target Profile必须绑定OS version range、device capability、signing identity、entitlement、store channel和runtime acceptance。

## 4. Embedded、RTOS、Automotive 与高保证 OS

### AUTOSAR

- 来源：AUTOSAR Classic/Adaptive官方标准页面。
- 核心：Application、RTE、Basic Software/hardware abstraction分层；VFB/Port；ARXML schema与semantic constraints；methodology/work products/generators；ECU与network配置。
- SEC 裁决：**interoperate/provider**。
- 吸收：
  - application/hardware separation；
  - typed Port；
  - component deployment mapping；
  - configuration作为first-class domain；
  - toolchain-independent exchange和generator methodology。
- 拒绝：把ARXML复制成Engineering IR；把AUTOSAR巨大配置模型当通用应用模型。

### seL4

- 来源：seL4 Proofs/Verification官方页面。
- 核心：functional correctness、部分配置binary correctness、capability security、明确的proof assumptions；不同architecture/configuration的proof coverage不同。
- SEC 裁决：**provider + proof architecture reference**。
- 关键教训：支持声明必须以platform/configuration矩阵精确表达，不能说“seL4已验证所以所有应用安全”。
- 对高安全部署，SEC可生成capability distribution/architecture inputs并保留seL4 proof/config Evidence，但应用、driver、hardware、DMA和deployment仍需独立assurance。

### Hard Real-Time / Safety-Critical

- 不能仅以平均性能判断；需要WCET、deadline、priority、preemption、interrupt、memory allocation、bounded blocking、fault containment和hardware clock Evidence。
- ISO 26262、DO-178C等认证标准是process/assurance约束，不能由一次test/proof自动宣称合规。
- SEC 应支持Assurance Case投影，不自封认证机构。

## 5. 密码协议、密钥与 HSM

### Key Management

- 来源：NIST SP 800-57系列与后续草案。
- 密钥不是普通secret string。至少表达：

```text
key identity/type/algorithm/strength
purpose/allowed operations
origin/generation
owner/custodian
storage/provider/HSM
activation/usage/expiry/rotation
backup/recovery/escrow
compromise/revocation/destruction
access/audit
crypto policy revision
```

- Key bytes默认不进入Engineering IR、Context Packet、日志或Evidence；只保存opaque handle和policy references。

### PKCS #11

- 来源：OASIS PKCS #11规范。
- 用途：HSM/cryptographic token Provider接口。
- 边界：slot/session/object/mechanism和login state有独立lifecycle；PKCS #11 provider存在不证明算法/policy/performance/HA满足产品要求。

### TLS 1.3 / Noise

- TLS/Noise描述handshake、key schedule、authentication、forward secrecy和transport state。
- SEC可以用protocol state machine/session type/crypto Provider表示，但不能自创未审计crypto primitive或组合。
- 协议实现验证必须从模型/规范跨越到实际库/config/certificate/key/runtime；仅协议论文或库版本不能证明部署安全。

### Cryptographic Protocol Verification

- 对自定义或高风险协议，使用Tamarin/ProVerif等model Provider，并把role I/O specification映射到implementation contract。
- model assumptions、adversary、primitive idealization和implementation gap必须显式；solver proof不替代side-channel、RNG、key storage和deployment Evidence。

## 6. ML 模型、数据、评估与供应链

### 模型不是普通Artifact

一个模型能力至少绑定：

```text
model architecture/code revision
weights digest/format
training code/environment
training/evaluation datasets and lineage
preprocessing/tokenizer/config
hyperparameters/random seeds
checkpoint/training run
metrics with dataset/slice/confidence
intended use/limitations
license/data rights
security scan/serialization risk
serving runtime/hardware/quantization
approval/promotion/monitoring/rollback
```

### Model Cards

- 来源：Hugging Face Model Cards。
- 用途：模型用途、限制、bias/ethics、训练参数、数据和评估的解释投影。
- 边界：Markdown/metadata不是Verification或发布authority；字段缺失不能被UI默认补齐。

### Model Registry / MLflow

- 来源：MLflow Model Registry。
- 核心：model version、run/experiment lineage、alias/tag、annotation、lifecycle promotion。
- SEC裁决：**interoperate/provider**。
- Model alias如`champion`是可变projection，不能进入immutable artifact identity；promotion必须绑定exact model version、evaluation、serving profile和approval。

### Serialization Security

- Pickle/Keras等格式可能执行代码；模型加载属于untrusted code/data boundary。
- Hugging Face扫描明确不是100%保证，来源签名也不等于内容安全。
- SEC优先safe tensor/data-only格式，模型文件先静态扫描/format validation，再在sandbox中load；unsafe format默认拒绝或显式高风险Provider。

### AI Risk / Evaluation

- 来源：NIST AI RMF、GenAI profile、AIRC TEVV资源。
- 评估必须绑定use case、model/version、prompt/context、dataset、slice、environment、metric implementation、threshold和statistical uncertainty。
- 单一benchmark score、人工感受或model card不能产生“安全/可靠”总状态。
- 对Agent需要额外：tool permissions、prompt injection、data exfiltration、misuse、long-horizon failure、operator override和incident Evidence。

## 7. Assurance Case 与安全开发

### GSN

- 来源：Goal Structuring Notation Community Standard v3。
- 核心：Goal、Strategy、Context、Assumption、Justification、Solution形成结构化assurance argument。
- SEC裁决：**projection/interoperate**。
- Assurance Case引用canonical Contract、Hazard/Risk、Verification Evidence和assumption；它不是新的事实源。
- 一个solution/test通过不能自动关闭父goal；argument completeness和defeater必须显式。

### NIST SSDF

- 来源：NIST SP 800-218及更新草案。
- 用途：安全开发实践的高层控制映射，包括准备组织、保护软件、产生安全软件、响应漏洞等责任。
- SEC裁决：**governance mapping**，不作为产品compiler state machine。
- 每个高层practice需映射到SEC可执行owner、artifact、Gate、Evidence和retirement；checklist勾选不能证明实施有效。

### Assurance 与 Compliance 分离

```text
Requirement / Regulation
Control interpretation
Implementation obligation
Verification / Evidence
Assurance argument
Independent assessment / certification
```

SEC可管理前五层的结构和Evidence，但不能替代授权认证机构或法律判断。

## 8. 最终架构新增边界

1. 新增 `Specialized Target Provider` 协议，支持GPU、kernel、mobile、embedded、ML等owning schema扩展。
2. 通用Behavior IR只表达可完整验证的受限行为；专用算法和内存/实时语义进入Governed Extension。
3. Resource model需要CPU、memory、GPU device/stream、kernel map/link、mobile background、RTOS task/interrupt等typed variants。
4. Verification环境必须包括hardware/device/driver/firmware/runtime，不再只用OS/arch字符串。
5. 新增 `Cryptographic Asset / Key Lifecycle` domain或受限Workspace domain，key bytes永不进入semantic graph。
6. 新增 `Model/Data/Evaluation Lineage` domain；模型、dataset、evaluation、serving和promotion revision分离。
7. 新增 `Assurance Case Projection`，从Requirement/Contract/Evidence生成，可暴露assumption/defeater但不拥有事实。
8. 专用平台的支持等级按Provider/target/capability矩阵声明，不能由“支持C++/Python”扩大推断。
9. 高风险Provider需要sandbox、supply-chain、signing、runtime scan和resource limit组合，不依赖单一机制。
10. 所有专用域都必须证明缺失Provider不会阻断无关Core工作，并返回明确unsupported/not-run。
