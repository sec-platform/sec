# 机制来源与只读仓库坐标

读取日期为2026-10-09。以下只支持具体机制与读回事实，不证明Gift已集成这些系统或本设计没有任何缺陷。本文不是第二份规范；采纳设计以各canonical owner为准。

## 协议、状态和编译机制

JSON Schema 2020-12 validation把integer定义为数学上小数部分为零的数，并区分结构断言、format与内容注释；它不验证Gift名称解析、授权或Integer原始词元。来源：https://json-schema.org/draft/2020-12/json-schema-validation 。因此本包另核整数原词法和语义引用，不用format发网络请求。

RFC8785的JCS面向特定JSON数据约束，包括重复键、Unicode和数值处理。来源：https://www.rfc-editor.org/rfc/rfc8785.html 。普通sort_keys、原源字节摘要与JCS不是同一个算法；本包局部json摘要未声称实现JCS。

MLIR Dialect Conversion区分完整转换、部分转换和分析可转换性，提供Target legality与合法化模式接口。来源：https://mlir.llvm.org/docs/DialectConversion/ 。该边界支持“全部操作都能合法降低才说完整目标”，不支持任意意图自动合成或已经部署MLIR的主张。

SCXML规定微步、宏步和run-to-completion的状态处理规则；其宏步可能不能终止，parallel状态不是自动多线程承诺。来源：https://www.w3.org/TR/scxml/ 。Gift状态Profile需要精确事件/步骤/进展策略，不把状态机名称当成完整调度说明。

PostgreSQL 18文档说明其Repeatable Read的事务快照起点及可能出现的序列化异常等适用边界。来源：https://www.postgresql.org/docs/18/transaction-iso.html 。Gift不得把数据库隔离级别名称直接推成跨Provider一致性或每条语句当前读；这里只核对版本18的文档，不声称所有数据库实现相同或这是所有产品的最新版本。

## 首个自举职责的实际仓库读取

仓库：`sec-platform/sec`。读取main得到提交`0536dca0da634fe26fe175bc4694883f966ae356`，tree为`6435d35751e2293410eed80cbb3eb013f02afb11`；提交记录时间2026-10-07T16:13:23Z。本轮没有写仓库、创建分支、执行CI、合并或部署。

完整读取的纯计算函数为`src/compiler/resolve/manifest-graph.ts::resolveManifestGraph`，Git blob为`60390de045d3d78f689ce60706d618ba84b677fd`。固定源码：https://github.com/sec-platform/sec/blob/0536dca0da634fe26fe175bc4694883f966ae356/src/compiler/resolve/manifest-graph.ts 。函数拥有清单供给闭包和稳定拓扑序，既有错误、全已选供应边、重复边/自边、动态最小ready顺序及UTF-16码元比较均属于这次迁移的兼容观察，不是Gift语言全局业务枚举。

完整读取消费者`src/compiler/resolve/resolve-plan.ts::prepareManifestResolution`，Git blob为`120bb0889f827832bfd91d191298ce681ed33614`。固定源码：https://github.com/sec-platform/sec/blob/0536dca0da634fe26fe175bc4694883f966ae356/src/compiler/resolve/resolve-plan.ts 。它在图解析之后检查实际选择集合的stack以及安装目标owner，不可因只迁移纯图函数而删除后继校验。`captureResolvePlan`在异步读取之前捕获相关计划字段，避免后来编辑混入当前结果。

搜索另发现`tests/unit/manifest-graph-resolution.test.ts`引用该函数；只取得搜索片段，没有在此声称完整读取或运行其测试。目录/树读取被截断的结果不算全仓审计。线上其他分支、CI、ruleset、runner、Rust进展与部署状态仍未本轮核查。
