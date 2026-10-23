# 测试导航

先找观察层，再找被测职责。文件名说明对象与行为，测试标题说明输入条件、结果或拒绝边界；不按修复批次、审计轮次或 `hardening` 历史组织新文件。

## 观察层

- [unit](unit/)：直接观察一个责任模块及其明确适配边界。
- [contract](contract/)：公开协议、准入、可信边界和跨模块约定。
- [integration](integration/)：真实组合、持久化、资源与恢复链。
- [e2e](e2e/)：从命令或用户工作流入口观察完整结果。

这四层描述观察范围，不等于 fast/slow，也不签发平台资格。已有测试仍按其实际观察判断，不凭所在目录宣称端到端或物理验证。

## 职责域

每层使用同一套域名；只建立有实际测试的目录。

| 域 | 找什么 |
| --- | --- |
| core | 值、规范编码、摘要、集合、图与通用错误合同 |
| cli | 参数捕获、命令分发、展示和诊断 |
| compiler | IR、语义转换、编译模型与代码生成 |
| workspace | 工程源、清单、组合、迁移、升级、修复与写回 |
| runtime | 物理文件、进程、资源、锁、取消与结算 |
| toolchain | 编译器、依赖、包、安装和工具调用 |
| providers | Git、GitHub、Docker 等外部能力适配 |
| repository | 源码观察、架构、依赖和仓库审计 |
| verification | 证据、测试选择、执行、结果与可信验证链 |
| development | 自举开发、工作选择、分支、Hooks 和续接 |
| release | 发布输入、制品、来源与交付 |

同一能力的不同观察层可以各有测试，但必须保护独立结果或边界，不复制整套相同输入矩阵。共享保障集中到实际责任拥有者，入口只保留接线和自身差异。

## 不应搬进这里的测试

- [src](../src/) 中共置的测试：跟随被测模块，适合局部合同与内部机制。
- [catalog](../catalog/registry/official/) 中的测试：属于安装到目标工程的 Block 内容，位置由各清单消费，不是本仓库测试的重复副本。
- [文档工具测试](../tools/documentation/tests/)：跟随 Python 工具及其发现规则。

## 支持代码与执行资格

- [helpers](helpers/) 保存被实际多个用例消费的语义 fixture；[testkit](testkit/) 保存工作区、进程等通用测试设施。
- [fixtures](fixtures/) 保存输入与子进程程序；[setup](setup/) 保存运行环境准备。支持文件不冒充独立测试注册。
- 域内专属 fixture 跟随其消费者；共享准备不在模块加载时执行有副作用的工作。
- [测试预算](../src/adapters/verification/platform/test-impact/contract/budget.ts) 拥有 slow suite、宿主和预算声明；[fast 策略](../src/adapters/self-hosting/development/runner/fast-test-policy.ts) 拥有排除项、隔离与资源分组。移动文件须同步真实消费者，不改变 suite 身份、频率或平台要求。
- 测试价值、合并与退役判据见[测试设计](../.agents/skills/test-design/SKILL.md)。此页只导航，不另建测试清单、执行器或审计台账；静态整理不表示测试运行通过。
