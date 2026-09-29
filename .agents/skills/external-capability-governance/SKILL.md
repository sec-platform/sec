---
name: external-capability-governance
description: 用于引入、升级、调用、替换或退役外部工具、Provider、MCP、CLI/API/SDK，或准备手写、扩写、修补通用机制（含测试、fixture、helper和验证工具），或新增 wrapper/Adapter、安装/物化能力时，验证真实缺口、唯一 owner、最小 Effect 闭包和退役路径；不用于把外部输出或安装成功当作 SEC authority。
---

# external-capability-governance

## 触发
- 新外部能力、Provider、CLI/API/SDK、wrapper/Adapter 或能力退役。
- 在生产代码、测试、fixture、helper、benchmark、mock、验证loader或重放工具中手写、扩写或修补通用解析、并发、复制、锁、重试、清理、数据构造及错误处理；即使不准备新增依赖也触发。
- 为采用已有工具准备下载、安装、解压、复制、缓存发行版或扫描无关安装树。
- executable、credential、endpoint、Effect、version 或 readback 边界发生变化。

## 不触发
- 当前 ledger 已批准、identity 未失效且 Effect 未扩大的普通直接调用。
- 只消费 canonical owner 已验证的 DTO/Evidence。

## 输入
- 真实 consumer、现有 owner、候选原生 machine interface 与无法复用的具体缺口。
- 当前 Effect、credential、cwd/env/executable、deadline、resource、readback 和 recovery 边界。
- `provisioning -> physical adoption -> semantic session -> operation`的实际 owner DAG。

## 前置门禁
- 先证明真实缺口、唯一 consumer/owner 和当前 Effect；禁止先实现再寻找用途。
- 新 Adapter 必须新增 protocol/platform/Effect/credential/version/Evidence/performance/compatibility/security 中至少一个真实边界。

- 修改通用实现前比较原生能力、已有依赖、成熟专业实现和保留自研四条路径；复用仍有效的既有裁决，不从包名或目录名推断适用性。
- 保留自研必须指出真实语义、平台、许可、安全或已测成本缺口；“测试代码”“已经写了”“少一个依赖”本身均不构成理由。薄适配只有真实边界才保留。

## 收益排序与替换执行
- 从当前台账选择真实consumer，不按文件顺序、问题编号、代码行数或容易写出多少测试决定优先级。先核对当前实现，已迁移项进入验收，不重新扩写已退役路径。
- 确认的数据损失、越权、秘密泄露或全部入口不可用先止损；其余工作优先复用能够删掉整类通用机制的原生/已有依赖/成熟库，再处理同类零散缺陷。潜在风险不能未经取证就永久抢占主线。
- 比较用户实际操作与手工同步减少量、覆盖的真实消费者、反复支付的运行/验证成本、缺陷损失和解锁收益；同时扣除迁移、常驻/启动、供应链、兼容及验证成本。没有测量依据时使用有理由的相对顺序，不编造工时、收益百分比或精确总分。
- 分开管理前置资格、可执行替换、已有实现验收、条件研究和撤回归档。某个资格阻塞不降低高收益任务的重要性，也不允许换Provider绕过；继续不依赖该阻塞的研究/消费者裁决，不能退回无限修补待替换引擎。
- 一个替换纵切片必须明确旧机制、选定能力、必须保留的领域决定、全部实际消费者、独立反例及旧路径退役条件。完整替换前的应急补丁要绑定同一退出条件，不产生永久并行实现。
- 测试代码按同样成本模型选择：先共享fixture/清理/调度等机械设施，再用成熟属性测试生成器探索输入和缩减反例；不把生产实现或同一待验证schema用作预期答案。
- 复用清单是选择候选，不是批量安装任务；最新网页不能证明固定运行时已有该能力，官方多文件支持也不等于自动解决同名声明合并。证据不足的候选保持待资格验证，不冒称采用。
- 排序只更新原台账的执行视图；研究ID、问题ID、独立缺陷和已过测试分开计数。本Skill只补充选择与操作路由，不签发机器准入、Provider采用或完成状态。

## 执行
1. 冻结当前 Effect 和 owner DAG；外部机制只提供 capability，不取得 SEC 语义 authority。
2. 只证明 Effect 窗口内可能漂移并决定结果的最小对象；无因果关系的安装树、catalog、cache 和历史状态排除。
3. 跨入新的 provisioning/installation/credential/cache/semantic/Effect owner 时停止当前实现，交由独立授权 work；不得用更小 artifact、cache 或 timeout 掩盖扩权。
4. 选择最窄稳定 machine interface；shell 只传 argv，显式绑定 executable、cwd、env、deadline、output 和 settlement。
5. 外部输出经 canonical validator/semantic owner 投影；退出码、Provider success 和 presentation 文本不能签发完成。
6. 迁移 consumer 后删除旧 wrapper、materializer、installer、cache、配置和文档；无真实 failover contract 不保留双实现。

## 测试与验证工具同样适用
- 复用对象是通用基础设施，不是期望答案。测试oracle、协议原始向量、独立参考算法不能从被测实现或同一待验证schema自动生成；不能为了降低重复率删除独立反证。
- 测试资源必须有确定归属、有限并发和完整结算。一个清理失败不吞掉其他失败，不遗留在途写入，不以不响应取消或超时等同物理结束。已有owner/default/failure语义必须在共享实现迁移后保留。
- fixture、mock与故障注入只拥有声明的替换范围；关键能力被替换的测试不得给真实库、原生平台、物理持久化或独立验收签发通过。未运行、只注册、只转译、源码静态检查与行为通过分别报告。
- 使用既有Source Program/Test Value审计处理测试值、引用和退役，不新建第二套源码扫描器。jscpd发现文字/Token重复，Knip发现可达性与未使用项；发现不是同义证明，不能凭重复百分比把必要测试统一模板化。
- 同样约束测试helper与生产入口。迁移后切换全部实际消费者并删除旧锁、队列、复制器、parser及重复策略；生成测试主体的静态样例与执行中的helper分别判定，不能整个tests/或fixture目录豁免。

## 完成证据
- reuse/interface decision、owner DAG、最小因果闭包、Effect/credential/readback/recovery 和资源上界。
- unavailable 路径证明零未授权 network/download/install/cache/spawn；旧 owner 达到 consumer-zero。
- 明确保留的行为、强反例、数据/摘要兼容、被替换实现及其生产和测试消费者；测试次数、文件数或压缩包大小不能代替这些退出条件。
- 本Skill是触发与操作路由，不签发机器准入或采用状态。采用与接合规则归`docs/架构/实现供给与替换.md`及`docs/运行/宿主生态与技术约束.md`，证据归`docs/运行/保证/要求证据与裁决.md`，退役归`docs/演进/兼容迁移与退役.md`；不建立新台账。

## 停止与恢复
- capability 不可证明或 unavailable 时保持 typed unknown/unsupported，不自动安装或切换第二 provider。
- 仅在扩张 owner 已删除或由独立授权 work 接管、旧旁路已退役后恢复。

## 禁止捷径
- 不建一对一镜像 wrapper，不解析 presentation 代替 JSON/porcelain/NUL/explicit format。
- 不因“证明更严格”拥有更多对象，不把完整安装或全树扫描当 adoption 前提。
- 不让工具权限、测试 seam 或 caller JSON 扩大 Effect authority。
