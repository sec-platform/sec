# Gift112：一等业务意图的离线模拟解释与方法匹配（历史研究说明）

这里**不是**另一套完整编程语言、生产 Method 目录、已部署的 Gift Kernel 或真实行业 Provider。目的在于验证：业务作者写目标与禁令而不写算法；外部 MeaningLibrary 给出公开语义；模拟 MethodSupply 给出有限世界内行为；一个不含行业名称分支的消费者能够正确装配并保留拒绝和未知。

## 后继：Gift113 在同一作者格式下联合处理多个意图

原 Gift112 `solve()` 一次仅规划一个 Intent；这不足以判断多个业务请求共享同一资源是否仍整体合法。后继[Gift113 有界联合规划](../Gift113/README.md)复用同一模型协议和作者源，在共同快照内逐步检查所有安全条件；另外 Mock `capacityReserveOne` 的前置条件已经增加“请求尚未确认”以阻止重复计数。两者仍然不是生产事务/有权执行器。

## 五类分离的文件

- `intent-*.module.json`：**作者主源**，沿 `gift.author-module/1` 容器携带 `intent:goal`；只写类型化角色、目标、安全/规范条款与锁定 Meaning 导入。未写如何修改数据库、循环/线程、目标语言或 SDK。
- `meaning-*.json`：**领域定义拥有者**发布显式类型与谓词解释；在这份离线样本里谓词通过纯字段关系解释，主观谓词明确要求外部观察者，不能因为有 URN 就执行。
- `model-methods.json`：**实现供应者**提供有名字、正式参数类型、前置条件、有限模型编辑和自身 Meaning 导入的模拟方法。其 `claimedCoverage` 仅为索引建议，真正检查使用实际模拟结果；局部方法没有真实授权。
- `model-*.json`：**本地显式假设快照**，携带 `explicit-offline-simulation-only`；未出现字段在开放事实语义下是 Unknown，不因缺席当作 False。
- `intent_reference.py` / `test_intent_reference.py`：**一次读取的离线验证器**，严格 JSON、Schema、引用、类型、解释、有限三值合取/析取/否定及预算 BFS（并非一般意图合成器）。参考方法只能在深度/状态数界内搜索，不读写业务外部世界。

## 原实验运行条件

原实验需要 Gift112 完整源码及本地 `jsonschema` 依赖；其有限解释器不读取网络或执行任意外部指令。

同一 `meaning-capacity` 与 `method:capacityReserveOne`，可以将 `intent-hospital-bed`/`model-hospital` 替换为 `intent-gpu-quota`/`model-gpu`。方法的参数名 `ticket/pool` 和作者角色 `request/resource` 不相同，实际匹配由名义类型承担，主 Kernel 不包含 bed/gpu 分派。如果实际医院流程有额外临床审核、时间隔离或超售规则，必须增加受权 Meaning/Policy，而不是把一个容量模型冒充真实医院系统。

另有 `intent-subscription`：模拟成功改变 `active/autoRenew`，但 `oblige` 通知尚无有权解释、期限和实际执行，**结果是 `PartialModelPlan`**。`intent-creative-review`：主观审美缺少真实评估者，**结果是 `NeedsObservation`**。`model-full-bed`：方法不能突破容量硬要求，**结果是 `NoPlanInSuppliedFiniteModel` 而非宇宙中绝对不可实现**。`model-unknown-eligibility`：缺资格事实，**结果是 `NeedsFact`**。

## 反例与边界

- `false` 与 `unknown` 不混同，未加载任意意义返回 `NeedsMeaning`，已知主体类型不符拒绝，而非找同名行业模板；没有合适方法返回 `NeedsMethod`。
- `maintain`/`avoid` 在原参考中只逐个检查被枚举的模拟状态（`model-steps`），未证明任何真实世界无限时间安全或活性。
- `oblige/permit/prefer`、有界模型外的量词/时间/权限及已注册但没有观测者的意义保持未决。现实 Provider 的授权、读回、幂等、确认、赔付、部署和用户交互均未发生。
- 数值型字段用规范十进制字符串；有限模型里的共享容量不变量只是一个公开机制合同，不能把它扩展到实际金融余额、医疗资源、法律授权或跨分布式原子事务。
- `ModelPlanCandidate` 不代表实现的 Method 曾被真实资格化，也不代表发出过副作用。专业实现者可选择规则/SQL/工作流/原生 SDK，用户无需再开发通用语言编译器。

此处的 25 个测试含跨域共用方法、初始禁令、缺少方法和事实、未知主观意义、含规范义务的部分计划、类型误用、重复身份、恶意多余字段、无损数值拒绝、非法方法编辑、源码快照无污染，以及 60 组容量/占用/资格状态对照。测试数字不是自动对全部行为的证明；实际结果以交付记录和复验为准。

唯一公共语义 owner：[通用意图语言—意图源与语义组合](../../../docs/20-语义与组合/作者语义/通用意图语言-意图源与语义组合.md)。具体实施接缝：[17 意图优先解释与现成方法装配](../../../docs/70-工程系统与演进/工程构造手册/17-意图优先解释与现成方法装配.md)。

每个 `meaningImports` 在原离线验证中还包含 `contentDigest`。即使 `libraryId/revision` 没变化，改写任何所依赖意义就会触发 `MeaningDigestMismatch`；这个 digest 仅用于本 Python 参考协议，不承诺与正式 Gift OID/JCS 等同。Method 目录按相交名义类型懒验证，无关的领域库不必为一次容量意图读入。本地绑定枚举与状态搜索共用显式预算；超出预算只返回 `IncompleteSearch`。
