---
schema: codex-development-work-package-v1
id: release-artifact-retention
tracking: none
base: dd51437ecfa10f8ffdc63b47367c83271c753352
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: separate-durable-release-identity-from-short-lived-payload
    owner: release-validation-owner
    ownedPaths:
      - .github/workflows/compiler-release-validation.yml
      - config/repository/work-packages/release-artifact-retention.md
      - tests/contract/ci-contract.test.ts
forbiddenPaths:
  - AGENTS.md
  - docs/
  - src/
  - package.json
  - bun.lock
acceptance:
  - 候选必须以精确当前 main 为父提交且只包含本工作包拥有的路径
  - release validation 继续绑定精确当前默认分支 head 以及相同 source commit/tree
  - release-set、runtime-package、documentation-package 三份 manifest 只能在 exact-head 构建和身份校验成功后暂存并独立上传缺失任一文件必须 fail closed
  - 三份 manifest 保留 90 天以保存 source builder dependency 逐文件成员与整体 content identity
  - 可从精确源码和构建输入重建的完整 release-set 验证载荷保留 7 天而不是 90 天
  - compact full-verification evidence 继续使用 always() 路径并保留 90 天
  - repository-maintenance recovery Gate Session 与其他 artifact owner 的保留和恢复语义不得改变
  - 仓库内不存在依赖长期 sec-release-set payload 的自动化下载消费者
  - CI contract test 必须绑定 manifest 上传完整 payload verification evidence 的路径顺序缺失文件策略与 retention
  - 独立 Review 和所需 Verification 必须绑定 frozen candidate 的精确 head/tree 后才可集成
tests:
  - tests/contract/ci-contract.test.ts
---

# 发布验证制品的身份证据与短期载荷分离

本工作包只调整发布验证工作流中的 Actions artifact 保留边界，不改变 release set 的生成语义、发布语义或正式 release 的持久化责任。

完整 `build/release-set/` 是可以从精确源码、锁文件与构建器重新生成的验证载荷，不再把 90 天存储期当作其身份权威。工作流在构建并校验 exact-head release set 后，先独立复制并上传 release-set、runtime-package 与 documentation-package 三份 manifest；它们继续保留 90 天，用于保存 source commit/tree、builder/dependency identity、逐文件 digest、成员 digest 与整体 content digest。完整 payload 只保留 7 天，承担短期人工检查、下载与故障定位的 byte-carrier 职责。

本仓当前没有自动化消费者下载 `sec-release-set-*` artifact；因此缩短完整 payload 不会破坏仓内 recovery/readback 链。若未来正式发布需要长期保存可执行或文档字节，应由独立的 durable release publication owner 明确拥有，而不是继续借 validation artifact retention 隐式承担。
