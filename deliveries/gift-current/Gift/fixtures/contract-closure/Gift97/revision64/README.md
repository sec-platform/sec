# Gift97：精确修订号语义与受限原生实现样本（历史研究说明）

原例承接 `Gift96` 的真实数值反例（JavaScript `number` 在 2^53 处执行 +1 未增长，谓词却返回真）。此处选择**明确的实现设计**：Revision 使用无符号 64 位精确整数；TypeScript 内部 `bigint`；JSON 边界只使用符合正则 `^(0|[1-9][0-9]*)$` 的十进制字符串，最后仍必须检查值 `<= 2^64-1`；不通过 `number` 桥接。拒绝前置、永不回绕；达到上限的写入失败，不修改原像。产品有无限修订寿命需求时，这个有上限的画像不满足，必须选择无界标识或迁移/世代协议，而不能偷偷回绕。

真实原生源 `revision.ts` 实现 `advance`、`strictlyAdvances`、canonical 解析/序列化和一个**仅在单一同步 JS 进程有效**的 CAS+成功操作去重见证；`revision64-contract.proposal.json` 是有限合同提案，不能覆盖 canonical Rule 作者事实。`test-revision64.mjs` 包含正常/边界/溢出/ID/同请求重放/不同请求 opId 冲突/旧前像/JSON 同名键和序列化/4096 项确定性性质取样。

原实验依赖预装 `tsc` 与 Node；npm 只是调用包装，不是该机制的语义前置。

## 实际作用点与未实现的边界

- 作者 Requirement 要求数学严格增长；此前的 `number` Method **不符合无界整数域**；本 `bigint` Method 仅对有效 Revision64 输入域和有界增量具有可验证行为证据。原例不修改原作者文件的唯一业务算法源，也不自动签发方法的生产资格。
- 转换前必须校验十进制原文。用户提供原始 JSON ByteString 时，先以受限 canonical profile 严格解码；示例 `decodeDocumentJson` 用“解析后再编码的严格字节相等”拒绝重复键、多余字段、非规范空格、字段顺序与 JSON 数字。**它不是任意 JSON 输入都适用的通用解析器**；UTF-8/Unicode、报文长度、资源配额仍在外层。
- 成功原子提交的必要条件：在同一事务中匹配 `(objectId, generationId, expectedRevision)`，进行 CAS 写入，并持久化 `operationId -> (normalized request identity, outcome, state digest)`；事务提交后的读回与证据必须绑定真实数据库逻辑版本/commit cursor。未命中 CAS 返回 `STALE_PREIMAGE` 并且不进行写入；相同请求相同 OperationId 必须重放原结果，不是再次 +1。若无数据库实际保证，“检查前像然后单独 UPDATE”的竞态仍然存在。
- 当 commit 发送成功后网络超时，执行者不允许宣称 `NOT_COMMITTED`；先按 OperationId 查询真实最终结算，如果未知，保持 `UNKNOWN` 并走人工/契约化恢复。失败的内存 Map 见证不能模拟这种结算。
- `revision=2^64-1` 且 `delta>0` 时，必须拒绝，不能使用 `BigInt.asUintN(64, ...)` 让它回绕，也不能生成新对象冒充同一逻辑对象。世代迁移要产生新 objectGenerationId，并对所有引用/历史/读集/外部消费者做原子兼容迁移；迁移真实实现仍待交付。
- Node 单事件循环对这份同步 Map 示例的成功提交只说明**进程内普通路径**；不提供跨线程、跨进程、多主、崩溃一致性、进程重启后的去重、链路权限或持久化。TypeScript `tsc` 构建通过不能证明所有业务 Requirement。

## 选择而非混淆

当对象可能永久迭代超过 64 位、要求跨语言大整数算术、或外部 ABI 已规定 uint32/JSON number 时，Revision64 映射不满足合同，需要一个**不同的、显式协商的 TargetProfile**，不得靠显示/序列化时截断值。源语义规定“正常完成后的严格增长”，在终点既可以用受限精确整数和拒绝溢出来维护，也可以选用无界大整数；不同方案的存储成本、跨语言互操作、序列化和溢出行为不自动等价。
