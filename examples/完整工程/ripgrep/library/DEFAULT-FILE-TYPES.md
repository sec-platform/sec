# 默认文件类型数据

[default-file-types.module.json](default-file-types.module.json) 保留实际产品数据及其类型：219 组、224 个类型别名、594 个组内 glob、609 个展开的 name/glob 对。它不含分类算法或标准库包装。模块身份 `ripgrep:ignore:default_types`、公开出口及全部字节保持迁移前一致；顺序、大小写和重复不能被整理或去重改变。

来源是固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 `crates/ignore/src/default_types.rs`，由同版 `types.rs` 的 DEFAULT_TYPES 消费。原许可继续由工程的 COPYING、LICENSE-MIT、UNLICENSE 资产承接。当前 Gift 数据候选没有据此取得 TypesBuilder、命令 --type-list 或文件筛选的生产接合；这些真实消费者仍待完成，不能只凭新目录宣称功能已迁移。

2026-10-28 从已退役的逐函数作者草稿中保留此独立数据，SHA-256 为 `02af4cc28f7a34a7220a38d2f7dc406878699f87992baf65e3b456c723d34e07`。其他旗标元数据、默认与帮助的准确原始来源仍为固定 P 的 `flags/defs.rs`、`flags/lowargs.rs`、`flags/doc/` 和 `hyperlink.rs`；旧候选仅承接 103 项，不能当完整 104 项声明。
