# 原格式资产

`legal/` 中的 `COPYING`、`LICENSE-MIT`、`UNLICENSE` 取自固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的对应根文件，按 Git blob 原字节保存。它们属于产品来源及许可文本，保留原格式，不转成 Gift JSON 或目标 Rust。原三个成员模式均为 `100644`，没有链接或可执行位需要重建。

| 成员 | P 的原 blob |
| --- | --- |
| `COPYING` | `bb9c20a094e41b7632d63bcff20c0b4b95e80777` |
| `LICENSE-MIT` | `3b0a5dc09c1e16357459ddc9182a50f360f3cdba` |
| `UNLICENSE` | `68a49daad8ff7e35068f2b7a97d643aab440eaec` |

活动 Project 的 asset 范围选择 `legal/**` 与 `cli/**`。此处 README 是设计说明，不是额外运行输入。资产进入 SourceSnapshot 不等于已经进入发行包；准确目标路径和发行成员仍须由完整 Target/工程装配承担，不能从当前资产目录推导成品路径。

## CLI 产品文字与原生模板

`cli/options/` 保存 104 项独有长说明的 roff 原文；hyperlink-format.roff.in 保留一个别名展开位置，实际别名只由 [公开别名表](../library/hyperlink-aliases.json) 维护。`cli/templates/` 保存帮助/man 模板和 Bash/Fish/PowerShell 模板，`cli/completion/` 保留 Zsh 原脚本、Fish 前置定义及编码标签数据。短说明、分类和提示在同一 [旗标词表](../intent/flag-vocabulary.json)；生成关系、替换位置及消费者由 [CLI-DOCUMENTATION](../intent/CLI-DOCUMENTATION.md) 唯一拥有。

外部模板按固定 P 的 Git blob 字节保存；Rust 内部字符串只提取其字面文字，按 Rust 的字面量行尾语义使用 LF，不保留 Rust 方法外壳。fish-flag.fish.in 与 powershell-flag.ps1.in 原文字没有末尾 LF，不能由编辑器自行补入。仓库根 .gitattributes 对本 CLI 资产范围固定 LF；导出后仍须由目标资产合同保持准确字节，不能依赖使用者的全局 core.autocrlf。

原参考仓库的工作树模板可因 Git 检出成为 CRLF；include_str! 会把这些字节带入产品输出，而 Rust 字符串字面量按自身规则处理。因而固定源码 commit 本身不足以证明构建产物的输出字节：应比较实际资产字节、工具链和构建环境，不能把行尾归一后的相等称为逐字节等价。本候选保留 Git blob 的 LF 版本，不为迁就一个未经构建绑定的本地二进制改写产品资产。

CLI 数据及生成合同已纳入活动源，完整产品根、生产解释与 Target 尚未接合。原文档、测试数据、构建配置、fuzz/benchmark 与发行输入仍未全部装配；依赖各自的许可与目标归属也不由这些文本覆盖。旧混合原型的原生工程保全证据不转授给新活动工程。
