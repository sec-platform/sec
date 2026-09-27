---
schema: codex-development-work-package-v1
id: rust-kernel-game-runtime-profile-v1
tracking: none
base: dd51437ecfa10f8ffdc63b47367c83271c753352
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: integrate-rust-kernel-game-runtime-profile
    owner: documentation-control-owner
    ownedPaths:
      - config/repository/work-packages/rust-kernel-game-runtime-profile-v1.md
      - .documentation/source-manifest.json
      - docs/作者/可替换表示与适用范围.md
      - docs/产品/原则总纲与归属.md
      - docs/产品/产品要求与工作约束.md
      - docs/产品/全体系能力与边界.md
      - docs/依据/来源/计算布局与数值.md
      - docs/依据/来源/语言编译与目标工具.md
      - docs/架构/实现语言与机制演进.md
      - docs/演进/实施/主线前沿与准入.md
      - docs/演进/领域组合与扩展条件.md
      - docs/领域/计算基础/计算结构与算法.md
      - docs/状态/编译与目标.md
      - docs/状态/设计剩余全量清单.md
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/
  - tests/
acceptance:
  - Rust目标语言能力与SEC自身compiler kernel实现语言由不同owner裁决且目标语言名单不能授权或阻断核心迁移
  - Canonical Engineering IR Semantic Contract身份修订诊断provenance及Binding合同保持语言无关且Rust内存布局crate路径不成为长期真值
  - 已有TypeScript生产能力只经合同冻结独立Oracle只读shadow单owner切换增量并行和旧writer退役后迁移
  - 新增且尚无生产owner的compiler-kernel能力在语言无关合同和Oracle闭合后直接进入Rust生产方向而不强制制造过渡TS实现
  - Rust执行区域按protocol identity validated model query dependency transform lowering host bridge及native boundary保持窄责任并拒绝god context和逐节点跨语言往返
  - 自动委派与开发者显式控制继续复用现有稀疏类型化控制和冻结Binding而不新增全工程auto guided manual语义
  - 游戏实时画像区分simulation render network GPU present audio等多时基并区分语义调度replay位级数值及presentation确定性
  - prediction rollback partial snapshot结构变化与外部Effect重演分别建模且网络rollback不冒充事务回滚
  - ECS job renderer GPU asset cook streaming hot reload save replay online services live ops平台发行UGC经济社交和无障碍等问题落回既有通用owner而不扩张Core行业枚举
  - 大世界坐标GPU device loss PSO permutation网络lockstep与rewind场景协同merge以及移动平台生命周期具有独立失败与恢复边界
  - 核心生产语言默认收敛为Rust compiler kernel与TypeScript/Bun product control两条主语言域新增核心生产语言必须有独立结构性收益和全生命周期证据
  - Rust实现级证明语言无关语义定理和并发分布式协议模型分别由可替换VerificationMethod Provider承担且不建立第二Engineering IR
  - K0冻结dependency合同与健全性而非具体read set K1不得用实现缺陷反向修改规范 K2分别以dependency mutation与clean full oracle验证实现
  - Rust单owner切换后具有显式K3R恢复状态旧TS仍合格时只能通过新Binding单owner回绑否则前向修复或回退已验证Rust release且禁止per request fallback和双writer
  - 产品要求原则总纲作者基线与实现语言owner同步使目标语言路线不能遗漏或重决策SEC自身Rust kernel方向
  - 实时媒体Codec Bitrate PlaybackBuffer自适应质量延迟卡顿合同保留且与asset streaming residency分离
  - 自适应码率representation selector复用反馈控制稳定性owner并声明hysteresis dwell switch rate或等价稳定性条件及紧急降档恢复边界验证覆盖阈值附近噪声交替带宽buffer抖动与无界ping pong反例
  - 游戏实时画像包含input simulation rollback effect commit render GPU present device loss generation rebuild的可检查Mermaid联合时序恢复图
  - rollback进入前必须验证authority generation tick与retained history超窗口或缺历史显式reject resync
  - speculative presentation允许从预测状态重建而真实audio playback payment save achievement network等Effect使用独立commit settlement边界
  - once only Effect的stable key只作为身份且必须闭合durable idempotency readback reconciliation unknown completion同identity恢复或park
  - GPU device loss作为active generation的异步外部转移并先结算outstanding fence再取得新generation重建资源
  - Effect commit后按声明delivery semantics分流只有once only要求的路径强制durable idempotency readback reconciliation普通低延迟best effort或at most once不得被伪升级
  - 资源和live service降级必须保持已确认paid entitlement与availability分离不得把容量压力改写为未购买未授权
  - Rust生产owner在K3切换前必须满足该能力既有production latency throughput memory与cold warm incremental规模预算所需增量并行缓存机制不得延后到K4
  - Effect gate只检查pre publication commit admission once only settlement必须在外部attempt之后由receipt readback或uncertain recovery建立
  - GPU旧generation的completion只结算原attempt物理Provider在PresentAttempt使用点消费准确generation并拒绝已知失效请求调用内loss保留实际同步与恢复义务不得改签新代或冒称显示成功
  - 声明同步状态的跨客户端画像必须跨platform architecture toolchain numeric protocol/content generation执行canonical state hash或等价cross client differential
  - 影响竞技结果的matchmaking lag compensation input sampling和adaptive degradation必须绑定CompetitiveFairnessClaim受控cohort oracle与线上drift监测
  - login matchmaking presence chat等live service联合过载复用资源准入网络熔断与系统级联owner并覆盖retry storm load shedding partial availability与recovery reserve
  - Godot Unity Unreal Addressables WebGPU Android iOS等外部资料只作为机制依据并保留版本实验性历史性及未采用边界
  - Rust compiler kernel逐能力迁移登记到现有U016与主线实施入口依赖健全性种子发行各由U012 U036 U037承接并与U013 Rust target分离不新增U或第二迁移账本
  - PresentAttempt绑定frame device surface resource generation在物理Provider使用点检查与消费旧Bool不提供未来成功权accepted completion displayed及未知结果分别保留
  - GPU恢复按device surface单帧故障限定范围迟到旧回调不授权新代重建不可用或预算耗尽明确unavailable并保留未决义务不无限等旧fence
  - 体验Claim保留真实用户设备输入网络任务cohort与负结果证据自动trace bot replay和质量Oracle不代签手感舒适或无障碍技术符合性
  - 用户研究按目的同意退出最小采集访问保留边界管理未取得用户或设备时不得关闭相关体验验收原游戏节独立义务逐项保全
  - K2默认使用冻结snapshot或隔离环境live shadow必须有采样CPU内存队列IO预算隔离取消优先级与backpressure资源压力先取消shadow且不得成为生产admission或占有生产独占资源
  - once only Effect在readback与安全同键重试都不可用或预算耗尽时进入terminal ParkedUnresolved且当前recovery graph无自动出边后续新有权协调只能创建新的recovery attempt实例
  - Render Submit PresentAttempt统一携带CurrentQualified q surface重配或device重建成功必须以q新值替换current state并让后续frame显式消费新generation不得依赖静态旧g节点
  - 所有Projection生成的实际Render Submit必须与CurrentQualified q共同经过FrameAdmission不得存在Projection直达Render旁路相交quarantine只能拒绝或以Provider非相交证明安装的新q_safe继续
  - FrameAdmission只有Projection这一条控制触发CurrentQualified与active QuarantineHolds作为同一决策的显式状态读取无current q或隔离证明缺失时必须unavailable不得用并列入边冒充AND join
  - surface swapchain失效且device仍合格时走独立有界reconfigure验证新surface generation后生成新frame不得仅RetireFrame也不得无条件升级全device重建
  - GPU submit只有Provider明确accepted enqueued且具备qualified completion时才创建Fence loss error unknown进入原attempt settlement不得制造synthetic completion或错误继续Present
  - submit或present最初unknown后经qualified probe分类为loss error时仍必须先进入对应SubmitSettlement或FrameSettlement结算原attempt同步与对象寿命然后才进入RecoveryScope
  - GPU submit或present的接受结果在bounded authoritative observation后仍unknown时进入GpuProviderQuarantinedUnresolved保留原frame q native resources attempt与未知事实当前recovery graph无自动出边且不得猜失败释放复用改签或自动resubmit rebuild
  - GPU quarantine进入时必须为exact native use closure建立QuarantineHold并把相交q capability resources从后续frame admission撤销不得因下一frame身份不同继续复用旧q
  - quarantine后只有Provider对queue device surface resource synchronization与lifetime给出exact非相交证明时才可在新的qualification recovery instance安装q_safe继续不相交工作否则presentation显式unavailable
  - GPU quarantine后的新readback安全teardown isolation或有权协调只可创建新的recovery attempt并引用原证据不回写旧状态伪造当时已可判定
  - once only外部attempt后的authoritative结果必须区分proved occurred proved not occurred terminal rejection与unknown仅occurred可settle明确未发生按冻结policy决定新physical attempt或确定失败不能伪装成功
  - Present已accepted但display observation unsupported unavailable或superseded且无failure证明时只形成unobserved display Claim不得进入device surface frame恢复且资源寿命继续由原accepted attempt Provider合同拥有
  - 反作弊必须覆盖known clean known cheat ambiguous false positive false negative与已执行sanction的appeal uphold revoke amend及可逆恢复不可逆residue补偿readback
  - documentation source manifest精确绑定本候选的十二份canonical文档且Work Package本身不进入documentation source identity
  - 本工作包只拥有本清单十二份canonical文档及source manifest不修改产品源码测试依赖workflow或当前控制投影
tests:
  - tests/integration/documentation-source-capture.test.ts
---

# Rust compiler kernel 与游戏实时压力画像融合

本工作包冻结已经完成的设计树并只为仓库正式准入提供准确写集、验收与最小验证入口。

设计裁决将 SEC 自身纯编译执行区域的长期物理方向固定为 Rust 单一生产 owner，同时保留全部语义、交换格式、权限、Provider 与目标语言合同的语言无关权威。已有 TypeScript 能力逐能力迁移；未来没有既存生产 owner 的新内核能力直接按最终 Rust 方向实现，参考模型和 Oracle 不升级为第二生产编译器。

游戏部分作为跨域压力画像而不是新 Game Core：时间、prediction/rollback、ECS 与任务调度、GPU/渲染、资产 cook/patch/驻留、热更新、save/replay、网络、在线服务、经济、社交、UGC、平台发行等分别映射到现有 canonical owners；只有真实跨域新区别才允许提升共同机制。
