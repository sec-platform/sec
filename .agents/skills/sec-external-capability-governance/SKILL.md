---
name: sec-external-capability-governance
description: 用于引入、升级、调用、替换或退役外部工具、Provider、MCP、CLI/API/SDK、Nexus、Graphify及其他能力，或决定是否新增wrapper/Adapter时，验证必要性、机器接口、语义owner、Effect、版本、许可证、安全和唯一owner；不用于默认把外部输出当事实。
---

# sec-external-capability-governance

## 触发
- 新外部工具/服务、Provider、MCP、CLI、API、SDK、模型、索引器或能力退役。
- 新建或扩大针对成熟工具的 wrapper、helper、Adapter、facade，或把原生 CLI/API 调用迁到 SEC 自研实现。
- 现有自动化依赖面向人的终端输出、shell 字符串拼接、ambient credential/version/path，或需要改变 Effect/Permission 边界。

## 不触发
- 已被当前 Capability Ledger/仓库 toolchain 批准、identity 未失效且 Effect 未扩大的普通直接调用。
- 纯粹读取已由 canonical owner 归一后的 SEC DTO/Evidence。

## 输入
- capability 与真实 consumer、现有 canonical owner、调用频率/批量/streaming需求、Target/平台。
- 候选原生 CLI、官方 API/SDK/library 与现有 SEC 实现；机器输出协议、版本、license/CVE/runtime、数据边界。
- Effect、Permission、credential、cwd/env/path、timeout/cancellation、freshness/readback、失败/恢复要求。

## 权限与路径
- 只修改 Capability Ledger、批准的配置/入口/Skill/docs、必要的薄 Adapter 与退役路径。
- 外部工具不获得 Engineering IR、actual Delta、canonical Impact、source writer、publish/merge/release 或其他 SEC semantic authority。

## 允许工具与操作
- 官方版本/license/CVE/API/CLI 文档检索、原生 machine interface 探测、A/B/性能验证、权限/数据流审计、conformance、入口删除。
- 对离散开发操作优先直接调用成熟原生工具；需要嵌入式高频/streaming/共享进程状态时可评估官方 API/library。

## 前置门禁
- 先证明真实 capability 缺口、唯一owner和consumer；禁止先造 wrapper 再寻找用途。
- 先完成 `native CLI -> official API/library -> existing SEC owner -> new implementation` 的能力发现；已有成熟机制满足需求时默认复用。
- 新 Adapter 必须至少增加一个不可由直接调用自然提供的边界：protocol normalization、platform/Target normalization、Effect/Permission bounding、credential isolation、version/revision binding、Evidence/readback、batching/performance、compatibility gap 或 security isolation。
- 仅重命名 command/subcommand/options、转发 argv、再暴露同一返回值的 one-to-one wrapper 不得进入实现。

## 执行
1. 证明真实缺口，优先复用现有 canonical owner；把“机制实现”和“SEC 语义”拆开，外部机制不能因被调用而获得语义owner。
2. 选择最窄且稳定的机器接口。离散进程操作默认直接 CLI；同进程高频、低延迟、streaming、事务性或 CLI 无稳定机器协议时比较官方 API/library。不得为了统一外观额外包一层。
3. 自动化输入输出优先级为：官方结构化协议/JSON等机器格式 -> 官方稳定 machine/porcelain record -> NUL/length-delimited安全记录 -> 显式 `--format`/template -> 文本展示。存在更高层机器协议时禁止解析面向人的 presentation；只能使用文本时必须版本绑定、bounded parser、负例和格式漂移测试。
4. shell 只作 transport，不作 semantic authority。优先 argv 数组而不是 `sh -c`/字符串插值；显式绑定 executable、cwd、env/credential、stdin、timeout/cancellation、output limit、exit semantics。命令成功只证明该外部 operation 的物理结果，不能直接签发 SEC completion。
5. 按 Effect 分级：observation/read-only；workspace mutation；local resource/destructive mutation；remote mutation；publish/merge/release/irreversible effect。后三类必须消费 operation-specific authority、exact target/preimage、幂等/恢复策略与 effect 后 readback；不得因为工具本身拥有写权限而扩大授权。
6. 允许 SEC 暴露新的高层 semantic operation，但它必须拥有真实新增的 invariant/state transition/evidence composition，例如跨 Git、GitHub、compiler、test runner 的 candidate verification；禁止 `secGitStatus`、`secGhPrView` 这类只改名字的镜像 API。
7. 性能上优先一次机器查询、批量/过滤和确定性预处理，避免把可由 `rg`/AST query/`jq`/compiler 等确定性工具裁掉的大量原始输出交给模型；cache 必须绑定 source/provider revision 与 freshness。不得为了少一次 process spawn 引入长期重复实现，除非 A/B 证明 startup/IPC 已成为真实瓶颈。
8. portability 绑定 semantic contract，不绑定 shell 方言。Windows/Linux/macOS 可选择不同 physical provider/Adapter，但不得让平台差异改变上层语义；GNU-only、PowerShell-only 或 shell quoting 不能成为 canonical contract。
9. 外部输出只作不受信候选；必须被 SEC validator、Evidence owner 或人工 authority 重新裁决。更新 Capability Ledger、tests、Skill/docs/toolchain projection，只在 route/version/standing capability 确实变化时登记品牌和当前状态，不把所有基础 OS utility 膨胀成 Provider catalog。
10. 引入成功后迁移 consumer 并删除被替代 wrapper、自研重复、MCP/Skill入口、配置、cache和文档；保留双实现只有在存在真实 failover contract、独立health/freshness和定期physical proof时成立。

## 完成证据
- `reuseDecision`：为什么直接复用、薄 Adapter、吸收设计或自研；至少列出已评估的成熟机制与未采用理由。
- `interfaceDecision`：CLI/API/library/Provider surface、机器协议、版本/revision、Target、调用频率和性能依据。
- 若存在 Adapter：精确 `adapterJustification`、新增边界、conformance、negative/failure tests 与 duplicate removal。
- Effect/Permission/credential/readback/recovery 证据；Provider 输出没有升格为 canonical truth。
- 能力decision、version/permission identity、tests、retirement readback；有 standing route 变化时 Capability Ledger 同步完成。

## 停止与恢复
- 能力有唯一owner、最窄稳定机器接口、可验证输入输出、明确授权和可执行退役路径后停止设计扩张。
- 不可验证、无消费者、只有presentation接口且无法建立稳定 parser，或 wrapper 没有新增边界时不引入/直接退役。
- Provider/工具不可用时保持 typed `unknown/unsupported` 或回到经过独立 Resolution 的更窄可信能力；禁止静默换成“差不多”的第二 authority。

## 禁止捷径
- 不保留无消费者的 MCP 配置或 standing tool surface。
- 不让外部工具改写 AGENTS、Skills 或 authority docs。
- 不建立与 Git/GitHub CLI/compiler/test runner/search/JSON/container 等成熟机制一一同构的 SEC wrapper，只为了“统一入口”。
- 不解析 human-readable output 来代替已存在的 JSON/porcelain/NUL/explicit-format 接口。
- 不把裸 shell、命令退出码、Provider success、AI 对终端文本的解释当作 Effect authority 或 completion Evidence。
- 不因为“未来可能更快”复制成熟算法；性能自研必须有同条件 A/B、瓶颈证据、删除/退役条件。

## 权威
- `docs/external-provider-policy.md`
- `docs/governance/external-capability-ledger.yaml`
- `docs/corpus/nexus/contract.md`
- `platform/shared/observed-process.ts`
