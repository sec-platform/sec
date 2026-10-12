# L5-观测与读回

L5 只形成有来源的现实 observation/readback；它不签发 Requirement 或 Verification verdict。

目录只表示物理主归属；ASMRVE 闭合、跨层引用和真实消费者仍由各正文承担。

<a id="gift-unit-4f761635bd5f568e991c851b321d2954"></a>
## 观测与读回总则

L5 只拥有**现实已发生结果的有来源观察**，不拥有 Requirement、计划、执行授权或 Verification verdict。它将 L4 的 effect/runtime 结果转换为带 subject、revision、environment、coverage、observed/recorded time 和 provenance 的 Observation/Statement，供后续 L6 Claim/Evidence 消费。

**联合现场读回。（消费条件）：** 局部健康回执各自为真时，仍需在同一时间/因果切面下验证跨系统不变量，不能用UI最后读到的状态替换现场证据。 合同归属：[跨源读取的观察切面、因果闭包与不可见参与者](../../70-工程系统与演进/信息与生命周期/对象关系与配置基线.md#gift-joint-snapshot-closure)。

**事件覆盖。（消费条件）：** 时间窗口与水位不能自动证明所有现实事件已采集；全称Claim需要真实来源覆盖与迟到策略。 合同归属：[事件时间、水位、迟到值与全称完成](../../20-语义与组合/基础语义/状态关系与流/背压与事件时间.md#gift-stream-progress-completeness)。

### 边界

- provider 返回 `success` 不等于目标现实已读回；
- timeout/连接丢失不等于 effect 未发生；
- readback 不反写作者 Requirement；
- observation 可以不完整、stale、conflict 或 unknown；
- L6 可以用同一 observation 支持多个不同 Claim，也可以判定它不足以支持任何 Claim。

### 当前机制入口

- [持久化提交与恢复](../持久化与恢复/README.md)
- [发布运行与资源生命周期](../运行生命周期/README.md)
- [要求证据与裁决](../../60-保证与证据/保证/要求证据与裁决.md)

本页只闭合 L5 的跨机制责任，不复制上述 owner 的状态机和字段。

<a id="gift-unit-66d7e5e8a97d5cf7aba306cd7abc2b41"></a>
## ObservationIR：现实观察的有类型边界

### 定位

`ObservationIR` 是物理观察进入编译分析的统一有类型记录边界，不是把外部断言自动提升为可信事实的入口。它记录观察到的对象、方法、覆盖、环境、错误和未知，不包含业务采用和目标裁决。内容真实及其对具体Claim的支持由[解释与证据接纳](../../60-保证与证据/保证/解释与证据接纳.md)按实际来源、模型、覆盖和信任条件评价；不同来源的冲突可以同时保留。结构通过、签名或已获准执行本身不证明观察正确。

### 结构

```text
ObservationGeneration = exact {
  generationRef,
  subjectScope,
  observationEntries,
  membershipAndNegativeFacts,
  environmentRef,
  methodAndProviderRefs,
  preAndPostReadbackRefs,
  coverage,
  unsupportedAndUnknownFrontier,
  canonicalDigest
}
```

每个 entry 绑定 logical identity candidate、physical binding、raw bytes or structured value、kind、mode、source revision 和读取结果。

### 读取结果

```text
ObservationResult =
  observed
  | absent-with-complete-coverage
  | inaccessible
  | unsupported-kind
  | invalidated-during-read
  | ambiguous-identity
  | corrupt
  | bounded-unknown
```

`absent`仅对明确对象与覆盖范围成立：一次可信精确路径查询的不存在可以形成该路径负观察，不要求先扫描全工程；“不存在其他成员/候选”则需要该集合的完整枚举边界。权限错误或未观察不能写成不存在。

### 不可变边界

parser、frontend、resolver 和 verifier 只消费 observed bytes/objects，不在 validated boundary 之后重新打开 live path 或 API。需要新内容时创建新 ObservationGeneration。

### 多源 join

跨文件、数据库、外部 API 和运行时观察必须明确是否共享一致性边界。不存在原子快照时，结果是带 partial-order 和 uncertainty 的 composite observation，而不是假装同一时刻。源对象的修改revision、集合捕获切面、事件交付前沿和消费者已应用位置也不是同一个版本；相同对象revision不能单独证明集合新鲜或没有漏掉其他对象。持续观察沿[快照/检查点接合](../../80-开发者与接口/工具协议/客户端与并行会话.md#projection-checkpoint-resync)保留真实覆盖，固定ObservationGeneration不因最新通知到达而被原地改义。

### 降低

ObservationIR 可以产生 SourceProgram candidate、runtime Evidence、provider capability facts 和 current-state facts；不能直接产生 accepted Definition、Binding、Grant 或 Verdict。

### 验证

覆盖 same-size replacement、目录 membership change、symlink/reparse、API pagination、权限错误、采样、外部 drift、clock mismatch、partial read、provider schema drift 和敏感数据泄露。
