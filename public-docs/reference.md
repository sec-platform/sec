# SEC Reference

精确字段、命令和状态从各自维护入口查阅；本页提供导航，不复制参数表或版本清单。

| 要查询的内容 | 入口 |
| --- | --- |
| 仓库开发、演示与检查命令 | `package.json` 的 `scripts` |
| CLI 命令注册与选项 | `src/interface/cli/cli.ts` |
| 工程语义与模型约束 | `docs/semantic-model.md` |
| 编译阶段与目标 IR | `docs/compiler-target-ir.md` |
| 运行环境、分发与支持边界 | `docs/runtime-and-distribution.md` |
| 验证、证据与失效规则 | `docs/verification-governance.md` |
| 其他领域的合同与唯一 owner | `docs/README.md` |

需要操作步骤时，先读 [Quickstart](quickstart.md) 或[任务地图](guides.md)。接口存在不代表所有环境都受支持，也不代表一次操作已经通过验证；具体支持条件和结果仍由对应合同与运行证据决定。

Reference 的生成与示例编写规则见[公共文档合同](CONTRACT.md#reference-与示例)。
