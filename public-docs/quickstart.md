# SEC Quickstart

这份 Quickstart 的目标是先让你看到 SEC 的最短闭环，而不是一次理解全部架构。

## 前提

真实安装、Runtime、Toolchain 与 Support 条件以这些来源为准：

- `docs/runtime-and-distribution.md`
- 当前 package / lock 与 machine support profile
- owning Verification Evidence

稳定教程不把某个今天的具体版本号写成永久合同。

## 仓库内最短演示

仓库已经提供三个演示入口：

```bash
bun run demo:quickstart
bun run demo:governance
bun run demo:closed-loop
```

它们分别用于观察：

1. 初始化并生成 reference workspace；
2. 在此基础上查看 governance artifact；
3. 执行 verify + governance artifact + explain 闭环。

这些命令的当前实现入口来自 `package.json`；如果未来 CLI 发生改变，Reference 应由机器合同重投影，而不是让教程长期维护第二份参数表。

## 你应该观察什么

不要只看“命令是不是退出 0”。

重点观察：

```text
输入工程
→ SEC 建立/读取工程事实
→ 生成受治理结果
→ Verification
→ Artifact / Evidence
→ Explain projection
```

## 如果失败

先区分：

- 环境不支持；
- dependency/toolchain 未准备；
- 输入工程无效；
- canonical contract 不满足；
- Verification 失败；
- unknown / unresolved；
- 物理资源或 cleanup 失败。

不要把所有失败都归类成“再跑一次”。

进入：

- [故障排查](troubleshooting.md)
- `docs/runtime-and-distribution.md`
- `docs/verification-governance.md`

## 下一步

跑通后继续：

- [核心概念](concepts.md)
- [学习路线](learn.md)
- [原则与为什么](principles.md)