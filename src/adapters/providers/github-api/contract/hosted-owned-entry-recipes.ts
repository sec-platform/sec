/** Closed mature entry recipes. These source projections grant no live capability. */
import { deepFreeze } from '../../../../contracts/canonical.ts';

export const HOSTED_OWNED_ENTRY_RECIPES = deepFreeze([
  {
    "workflowPath": ".github/workflows/compiler-pr-validation.yml",
    "jobId": "main-health",
    "job": {
      "name": "sec/main-health",
      "if": "${{ github.event_name == 'repository_dispatch' && github.event.action == 'sec-produce-main-health-v1' }}",
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 30,
      "permissions": {
        "contents": "read"
      },
      "concurrency": {
        "group": "sec-main-health-${{ github.event.client_payload.payload.mainSha }}",
        "cancel-in-progress": false,
        "queue": "max"
      },
      "steps": [
        {
          "name": "Bind canonical MainHealth request to live main",
          "if": "${{ github.event_name == 'repository_dispatch' }}",
          "uses": "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
          "env": {
            "PAYLOAD_JSON": "${{ toJSON(github.event.client_payload) }}",
            "WORKFLOW_SHA": "${{ github.sha }}"
          },
          "with": {
            "script": "const crypto = require('crypto');\nconst wrapper = JSON.parse(process.env.PAYLOAD_JSON);\nconst wrapperKeys = Object.keys(wrapper ?? {}).sort();\nif (wrapperKeys.length !== 1 || wrapperKeys[0] !== 'payload') {\n  throw new Error('MainHealth client_payload must be the exact one-key wrapper.');\n}\nconst payload = wrapper.payload;\nconst keys = Object.keys(payload ?? {}).sort();\nif (keys.length !== 2 || keys[0] !== 'mainSha' || keys[1] !== 'requestOperationId' ||\n    typeof payload.mainSha !== 'string' || !/^[0-9a-f]{40}$/.test(payload.mainSha) ||\n    typeof payload.requestOperationId !== 'string' ||\n    !/^sha256:[0-9a-f]{64}$/.test(payload.requestOperationId)) {\n  throw new Error('MainHealth wrapper payload is not canonical.');\n}\nconst operationPreimage = JSON.stringify({\n  schema: 'sec-produce-main-health-request-v1',\n  mainSha: payload.mainSha\n});\nconst expectedOperationId = `sha256:${crypto.createHash('sha256')\n  .update(operationPreimage, 'utf8').digest('hex')}`;\nconst repository = await github.rest.repos.get({\n  owner: context.repo.owner,\n  repo: context.repo.repo\n});\nconst liveMain = await github.rest.repos.getBranch({\n  owner: context.repo.owner,\n  repo: context.repo.repo,\n  branch: repository.data.default_branch\n});\nif (repository.data.default_branch !== 'main' ||\n    payload.requestOperationId !== expectedOperationId ||\n    process.env.WORKFLOW_SHA !== payload.mainSha ||\n    liveMain.data.commit.sha !== payload.mainSha) {\n  throw new Error('MainHealth request operation/workflow/live-main identity drifted.');\n}\n"
          }
        },
        {
          "name": "Checkout exact pushed main revision",
          "id": "checkout-main",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ github.event.client_payload.payload.mainSha }}",
            "fetch-depth": 0,
            "persist-credentials": false
          }
        },
        {
          "name": "Setup trusted Bun",
          "id": "setup-bun",
          "uses": "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
          "with": {
            "bun-version-file": ".bun-version"
          }
        },
        {
          "name": "Cache Bun install",
          "id": "cache-bun",
          "uses": "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
          "with": {
            "path": "~/.bun/install/cache",
            "key": "${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}",
            "restore-keys": "${{ runner.os }}-bun-\n"
          }
        },
        {
          "name": "Install dependencies from the frozen lock",
          "id": "install",
          "run": "bun install --frozen-lockfile"
        },
        {
          "name": "Reject import organization drift",
          "id": "imports-check",
          "run": "bun run imports:check --all"
        },
        {
          "name": "Run exact-main TypeScript checks",
          "id": "typecheck",
          "run": "bun run typecheck:verified"
        },
        {
          "name": "Reject static architecture contradictions",
          "id": "static-architecture",
          "run": "bun run audit -- --worktree-source-program --enforce"
        },
        {
          "name": "Validate active documentation authority",
          "id": "docs-doctor",
          "run": "bun run docs:doctor"
        },
        {
          "name": "Run the complete fast test inventory",
          "id": "test-fast",
          "run": "bun run test -- --scope fast"
        }
      ]
    }
  },
  {
    "workflowPath": ".github/workflows/compiler-release-validation.yml",
    "jobId": "compiler-release-verification",
    "job": {
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 90,
      "steps": [
        {
          "name": "Resolve trusted release request, exact head, and verifier boundary",
          "id": "verification",
          "uses": "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
          "with": {
            "script": "const requestedRef = context.sha;\nconst { data: commit } = await github.rest.repos.getCommit({\n  owner: context.repo.owner,\n  repo: context.repo.repo,\n  ref: requestedRef\n});\nif (commit.parents.length !== 1 || !/^[0-9a-f]{40}$/.test(commit.parents[0].sha)) {\n  throw new Error('Release verification requires exactly one commit parent.');\n}\nconst { data: repository } = await github.rest.repos.get({\n  owner: context.repo.owner,\n  repo: context.repo.repo\n});\nconst { data: baseBranch } = await github.rest.repos.getBranch({\n  owner: context.repo.owner,\n  repo: context.repo.repo,\n  branch: repository.default_branch\n});\nif (commit.sha !== requestedRef || context.ref !== `refs/heads/${repository.default_branch}`\n  || context.sha !== baseBranch.commit.sha) {\n  throw new Error('Release verifier workflow must execute from the current trusted default branch.');\n}\ncore.setOutput('sha', commit.sha);\ncore.setOutput('base', commit.parents[0].sha);\n"
          }
        },
        {
          "name": "Checkout exact release head",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ steps.verification.outputs.sha }}",
            "fetch-depth": 2,
            "persist-credentials": false
          }
        },
        {
          "name": "Verify checked-out release parent and tree",
          "shell": "bash",
          "env": {
            "SEC_EXPECTED_HEAD_SHA": "${{ steps.verification.outputs.sha }}",
            "SEC_CHANGED_BASE": "${{ steps.verification.outputs.base }}"
          },
          "run": "set -euo pipefail\ntest \"$(git rev-parse --verify HEAD)\" = \"$SEC_EXPECTED_HEAD_SHA\"\ntest \"$(git rev-list --parents -n 1 HEAD)\" = \"$SEC_EXPECTED_HEAD_SHA $SEC_CHANGED_BASE\"\ngit cat-file -e \"$SEC_CHANGED_BASE^{commit}\"\ngit cat-file -e \"$SEC_CHANGED_BASE^{tree}\"\n"
        },
        {
          "name": "Setup Bun",
          "uses": "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
          "with": {
            "bun-version-file": ".bun-version"
          }
        },
        {
          "name": "Cache bun install",
          "uses": "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
          "with": {
            "path": "~/.bun/install/cache",
            "key": "${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}",
            "restore-keys": "${{ runner.os }}-bun-\n"
          }
        },
        {
          "name": "Install dependencies once",
          "run": "bun install --frozen-lockfile"
        },
        {
          "name": "Run exact-head full verification",
          "id": "verify",
          "shell": "bash",
          "env": {
            "SEC_EXPECTED_HEAD_SHA": "${{ steps.verification.outputs.sha }}",
            "SEC_CHANGED_BASE": "${{ steps.verification.outputs.base }}",
            "SEC_AFFECTED_TESTS_BASE": "${{ steps.verification.outputs.base }}"
          },
          "run": "bun src/entry/ci-verification.ts --profile full --expected-head \"$SEC_EXPECTED_HEAD_SHA\""
        },
        {
          "name": "Build and bind exact-head release set",
          "shell": "bash",
          "env": {
            "SEC_EXPECTED_HEAD_SHA": "${{ steps.verification.outputs.sha }}"
          },
          "run": "set -euo pipefail\ntest \"$(git rev-parse HEAD)\" = \"$SEC_EXPECTED_HEAD_SHA\"\nexpected_tree=\"$(git rev-parse HEAD^{tree})\"\nbun run release:build\ntest \"$(git rev-parse HEAD)\" = \"$SEC_EXPECTED_HEAD_SHA\"\njq -e --arg commit \"$SEC_EXPECTED_HEAD_SHA\" --arg tree \"$expected_tree\" \\\n  '.schema == \"sec-release-set-manifest-v1\" and .sourceCommit == $commit and .sourceTree == $tree' \\\n  build/release-set/release-set-manifest.json > /dev/null\n\n# Preserve the observed build identity and per-file digests independently\n# of the short-lived, rebuildable validation payload.\nmanifest_root=\"$RUNNER_TEMP/sec-release-manifests-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\"\nmkdir -- \"$manifest_root\"\ncp -- build/release-set/release-set-manifest.json \\\n  build/release-set/runtime/runtime-package-manifest.json \\\n  build/release-set/documentation/documentation-package-manifest.json \\\n  \"$manifest_root/\"\n"
        },
        {
          "name": "Upload exact-head release manifests",
          "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          "with": {
            "name": "sec-release-manifests-${{ steps.verification.outputs.sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": "${{ runner.temp }}/sec-release-manifests-${{ github.run_id }}-${{ github.run_attempt }}",
            "if-no-files-found": "error",
            "retention-days": 90
          }
        },
        {
          "name": "Upload exact-head runtime and documentation release set",
          "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          "with": {
            "name": "sec-release-set-${{ steps.verification.outputs.sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": "build/release-set/",
            "include-hidden-files": true,
            "if-no-files-found": "error",
            "retention-days": 7
          }
        },
        {
          "name": "Upload compact full verification evidence",
          "id": "evidence",
          "if": "always()",
          "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          "with": {
            "name": "sec-verification-v19-full-release-head-${{ steps.verification.outputs.sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": ".tmp/ci-verification-evidence.json",
            "if-no-files-found": "error",
            "retention-days": 90
          }
        }
      ],
      "permissions": {
        "contents": "read"
      }
    }
  },
  {
    "workflowPath": ".github/workflows/trusted-bootstrap.yml",
    "jobId": "checker-pre",
    "job": {
      "needs": "resolve",
      "runs-on": [
        "self-hosted",
        "Linux",
        "X64",
        "sec-linux-verification-v1",
        "sec-linux-verification-trusted-v1"
      ],
      "timeout-minutes": 30,
      "steps": [
        {
          "name": "Setup trusted-base Bun runtime",
          "uses": "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
          "with": {
            "bun-version": "${{ needs.resolve.outputs.bun-version }}"
          }
        },
        {
          "name": "Checkout exact trusted base checker",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ needs.resolve.outputs.base }}",
            "path": "trusted-base",
            "fetch-depth": 1,
            "persist-credentials": false
          }
        },
        {
          "name": "Checkout exact candidate as data",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ needs.resolve.outputs.head }}",
            "path": "candidate-data",
            "fetch-depth": 2,
            "persist-credentials": false
          }
        },
        {
          "name": "Preflight exact trusted-base checkout",
          "shell": "bash",
          "env": {
            "TRUSTED_BASE_ROOT": "${{ github.workspace }}/trusted-base",
            "SEC_BOOTSTRAP_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_BOOTSTRAP_BASE_TREE": "${{ needs.resolve.outputs.base-tree }}"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\nbun --no-env-file - <<'BUN'\n  const { lstatSync, realpathSync } = require(\"node:fs\");\n  const path = require(\"node:path\");\n  const { spawnSync } = require(\"node:child_process\");\n  const required = (name) => process.env[name] ?? (() => { throw new Error(`missing ${name}`); })();\n  const sha = (name) => {\n    const value = required(name);\n    if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${name} is not one exact SHA.`);\n    return value;\n  };\n  const logicalRoot = required(\"TRUSTED_BASE_ROOT\");\n  if (!path.isAbsolute(logicalRoot) || path.resolve(logicalRoot) !== logicalRoot) {\n    throw new Error(\"trusted-base logical root is not one absolute canonical path.\");\n  }\n  const metadata = lstatSync(logicalRoot);\n  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {\n    throw new Error(\"trusted-base root is not one ordinary non-symlink directory.\");\n  }\n  const physicalRoot = realpathSync.native(logicalRoot);\n  if (physicalRoot !== logicalRoot) {\n    throw new Error(\"trusted-base logical root is not its exact physical root.\");\n  }\n  const gitEnvironment = Object.fromEntries(Object.entries(process.env)\n    .filter(([name]) => !name.startsWith(\"GIT_\")));\n  gitEnvironment.GIT_NO_REPLACE_OBJECTS = \"1\";\n  const git = (args) => {\n    const result = spawnSync(\n      \"git\",\n      [\"--no-replace-objects\", \"-C\", physicalRoot, ...args],\n      { encoding: null, env: gitEnvironment, windowsHide: true }\n    );\n    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {\n      throw new Error(`workflow-owned trusted-base git ${args.join(\" \")} failed.`);\n    }\n    return result.stdout;\n  };\n  const exactText = (args) => git(args).toString(\"utf8\").trim();\n  if (exactText([\"rev-parse\", \"--show-toplevel\"]) !== physicalRoot ||\n      exactText([\"rev-parse\", \"--verify\", \"HEAD^{commit}\"]) !== sha(\"SEC_BOOTSTRAP_BASE\") ||\n      exactText([\"rev-parse\", \"--verify\", \"HEAD^{tree}\"]) !== sha(\"SEC_BOOTSTRAP_BASE_TREE\") ||\n      git([\"status\", \"--porcelain=v1\", \"--untracked-files=all\"]).byteLength !== 0) {\n    throw new Error(\"trusted-base workflow-owned identity, tree, root, or cleanliness preflight failed.\");\n  }\nBUN\n"
        },
        {
          "name": "Install trusted-base checker dependencies without lifecycle scripts",
          "shell": "bash",
          "env": {
            "TRUSTED_BASE_ROOT": "${{ github.workspace }}/trusted-base"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\ncd \"$TRUSTED_BASE_ROOT\"\nbun install --frozen-lockfile --ignore-scripts\n"
        },
        {
          "name": "Produce trusted-base PRE candidate-root receipt",
          "id": "regression",
          "shell": "bash",
          "env": {
            "TRUSTED_BASE_ROOT": "${{ github.workspace }}/trusted-base",
            "CANDIDATE_ROOT": "${{ github.workspace }}/candidate-data",
            "BOOTSTRAP_EVIDENCE_ROOT": "${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}",
            "SEC_BOOTSTRAP_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_BOOTSTRAP_BASE_TREE": "${{ needs.resolve.outputs.base-tree }}",
            "SEC_BOOTSTRAP_HEAD": "${{ needs.resolve.outputs.head }}",
            "SEC_BOOTSTRAP_TREE": "${{ needs.resolve.outputs.tree }}",
            "SEC_BOOTSTRAP_REGISTRY_DIGEST": "${{ needs.resolve.outputs.registry-digest }}"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\nTRUSTED_BASE_ROOT=\"$(realpath \"$TRUSTED_BASE_ROOT\")\"\nCANDIDATE_ROOT=\"$(realpath \"$CANDIDATE_ROOT\")\"\nBOOTSTRAP_EVIDENCE_ROOT=\"$(realpath -m \"$BOOTSTRAP_EVIDENCE_ROOT\")\"\nexport TRUSTED_BASE_ROOT CANDIDATE_ROOT BOOTSTRAP_EVIDENCE_ROOT\nout=\"$BOOTSTRAP_EVIDENCE_ROOT\"\nmkdir -p \"$out\"\n(cd \"$TRUSTED_BASE_ROOT\" && bun --no-env-file src/entry/trusted-bootstrap-verification-cli.ts materialize --output \"$out/checker.mjs\")\nSEC_BOOTSTRAP_PHASE=pre SEC_BOOTSTRAP_RECEIPT=\"$out/pre-receipt.json\" bun \"$out/checker.mjs\"\n(cd \"$out\" && sha256sum checker.mjs pre-receipt.json > SHA256SUMS)\n"
        },
        {
          "name": "Upload bounded checker PRE artifact",
          "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          "with": {
            "name": "trusted-bootstrap-pre-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": "${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}",
            "if-no-files-found": "error",
            "retention-days": 1
          }
        }
      ]
    }
  },
  {
    "workflowPath": ".github/workflows/trusted-bootstrap.yml",
    "jobId": "candidate-sut",
    "job": {
      "needs": [
        "resolve",
        "checker-pre"
      ],
      "runs-on": [
        "self-hosted",
        "Linux",
        "X64",
        "sec-linux-verification-v1",
        "sec-linux-verification-sut-v1"
      ],
      "timeout-minutes": 90,
      "steps": [
        {
          "name": "Checkout exact trusted base sandbox owner",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ needs.resolve.outputs.base }}",
            "fetch-depth": 0,
            "persist-credentials": false
          }
        },
        {
          "name": "Checkout clean exact base SUT input",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ needs.resolve.outputs.base }}",
            "path": "base-sut",
            "fetch-depth": 0,
            "persist-credentials": false
          }
        },
        {
          "name": "Checkout exact candidate SUT only",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ needs.resolve.outputs.head }}",
            "path": "candidate-sut",
            "fetch-depth": 0,
            "persist-credentials": false
          }
        },
        {
          "name": "Setup trusted-base Bun runtime for candidate SUT",
          "uses": "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
          "with": {
            "bun-version": "${{ needs.resolve.outputs.bun-version }}"
          }
        },
        {
          "name": "Restore exact-base dependency download cache",
          "uses": "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
          "with": {
            "path": "/tmp/sec-hosted-dependency-home/.bun/install/cache",
            "key": "${{ runner.os }}-trusted-bootstrap-bun-${{ hashFiles('bun.lock') }}",
            "restore-keys": "${{ runner.os }}-trusted-bootstrap-bun-\n"
          }
        },
        {
          "name": "Install exact-base SUT facade dependencies without lifecycle scripts",
          "shell": "bash",
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\ntest ! -e .npmrc\nmkdir -p /tmp/sec-hosted-dependency-home /tmp/sec-hosted-dependency-tmp\nBUN_BIN=\"$(command -v bun)\"\nenv -i \\\n  PATH=/usr/bin:/bin \\\n  HOME=/tmp/sec-hosted-dependency-home \\\n  TMPDIR=/tmp/sec-hosted-dependency-tmp \\\n  BUN_INSTALL_CACHE_DIR=/tmp/sec-hosted-dependency-home/.bun/install/cache \\\n  LANG=C.UTF-8 \\\n  CI=1 \\\n  \"$BUN_BIN\" install --frozen-lockfile --ignore-scripts\n"
        },
        {
          "name": "Run candidate SUT through trusted private sandbox",
          "shell": "bash",
          "env": {
            "BASE_SUT_ROOT": "${{ github.workspace }}/base-sut",
            "CANDIDATE_ROOT": "${{ github.workspace }}/candidate-sut",
            "SUT_EVIDENCE_ROOT": "${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}",
            "SEC_BOOTSTRAP_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_BOOTSTRAP_HEAD": "${{ needs.resolve.outputs.head }}",
            "SEC_BOOTSTRAP_TREE": "${{ needs.resolve.outputs.tree }}",
            "SEC_CHANGED_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_AFFECTED_TESTS_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_WORK_PACKAGE_MANIFEST_PATH": "${{ needs.resolve.outputs.manifest }}",
            "SEC_REPOSITORY_AUDIT_DEFAULT_REF": "${{ needs.resolve.outputs.base }}"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\nbun src/entry/ci-verification.ts execute-trusted-bootstrap-sut \\\n  --base-root \"$BASE_SUT_ROOT\" \\\n  --candidate-root \"$CANDIDATE_ROOT\" \\\n  --output-directory \"$SUT_EVIDENCE_ROOT\" \\\n  --base-sha \"$SEC_BOOTSTRAP_BASE\" \\\n  --head-sha \"$SEC_BOOTSTRAP_HEAD\" \\\n  --tree-sha \"$SEC_BOOTSTRAP_TREE\" \\\n  --manifest-path \"$SEC_WORK_PACKAGE_MANIFEST_PATH\"\n"
        },
        {
          "name": "Upload bounded candidate SUT artifact",
          "if": "always()",
          "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          "with": {
            "name": "trusted-bootstrap-sut-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": "${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/tcb-lock-pre.json\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/imports.log\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/docs-doctor.log\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/typecheck.log\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/diff-check.log\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/focused-tests.log\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/repository-audit.json\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/affected-plan.json\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/affected-tests.log\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/tcb-lock-post.json\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/SHA256SUMS\n${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}/sut-receipt.json\n",
            "if-no-files-found": "error",
            "retention-days": 1
          }
        }
      ]
    }
  },
  {
    "workflowPath": ".github/workflows/trusted-bootstrap.yml",
    "jobId": "checker-post",
    "job": {
      "if": "${{ always() && needs.resolve.result == 'success' }}",
      "needs": [
        "resolve",
        "checker-pre",
        "candidate-sut"
      ],
      "runs-on": [
        "self-hosted",
        "Linux",
        "X64",
        "sec-linux-verification-v1",
        "sec-linux-verification-trusted-v1"
      ],
      "timeout-minutes": 30,
      "steps": [
        {
          "name": "Setup trusted-base Bun runtime for reducer",
          "uses": "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
          "with": {
            "bun-version": "${{ needs.resolve.outputs.bun-version }}"
          }
        },
        {
          "name": "Initialize fail-closed final evidence envelope",
          "shell": "bash",
          "env": {
            "FINAL_EVIDENCE_ROOT": "${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}",
            "SEC_BOOTSTRAP_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_BOOTSTRAP_BASE_TREE": "${{ needs.resolve.outputs.base-tree }}",
            "SEC_BOOTSTRAP_HEAD": "${{ needs.resolve.outputs.head }}",
            "SEC_BOOTSTRAP_TREE": "${{ needs.resolve.outputs.tree }}",
            "SEC_BOOTSTRAP_RUN_ID": "${{ github.run_id }}",
            "SEC_BOOTSTRAP_RUN_ATTEMPT": "${{ github.run_attempt }}"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\nmkdir -p \"$FINAL_EVIDENCE_ROOT\"\nbun --no-env-file - <<'BUN'\n  const { createHash } = require(\"node:crypto\");\n  const { renameSync, writeFileSync } = require(\"node:fs\");\n  const path = require(\"node:path\");\n  const required = (name) => process.env[name] ?? (() => { throw new Error(`missing ${name}`); })();\n  const sha = (name) => {\n    const value = required(name);\n    if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${name} is invalid.`);\n    return value;\n  };\n  const positiveInteger = (name) => {\n    const value = required(name);\n    if (!/^[1-9][0-9]{0,19}$/.test(value)) throw new Error(`${name} is invalid.`);\n    return value;\n  };\n  const semantic = {\n    schema: \"sec-trusted-bootstrap-final-evidence-v1\",\n    baseSha: sha(\"SEC_BOOTSTRAP_BASE\"),\n    baseTreeSha: sha(\"SEC_BOOTSTRAP_BASE_TREE\"),\n    headSha: sha(\"SEC_BOOTSTRAP_HEAD\"),\n    treeSha: sha(\"SEC_BOOTSTRAP_TREE\"),\n    runId: positiveInteger(\"SEC_BOOTSTRAP_RUN_ID\"),\n    runAttempt: positiveInteger(\"SEC_BOOTSTRAP_RUN_ATTEMPT\"),\n    status: \"incomplete\",\n    reason: \"checker-post-not-complete\"\n  };\n  const receiptDigest = `sha256:${createHash(\"sha256\").update(JSON.stringify(semantic)).digest(\"hex\")}`;\n  const root = required(\"FINAL_EVIDENCE_ROOT\");\n  const temporary = path.join(root, \"final-envelope.json.tmp\");\n  writeFileSync(temporary, `${JSON.stringify({ ...semantic, receiptDigest }, null, 2)}\\n`, { flag: \"wx\" });\n  renameSync(temporary, path.join(root, \"final-envelope.json\"));\nBUN\n(cd \"$FINAL_EVIDENCE_ROOT\" && sha256sum final-envelope.json > SHA256SUMS.tmp && mv SHA256SUMS.tmp SHA256SUMS)\n"
        },
        {
          "name": "Checkout exact trusted base reducer",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ needs.resolve.outputs.base }}",
            "path": "trusted-base",
            "fetch-depth": 1,
            "persist-credentials": false
          }
        },
        {
          "name": "Checkout exact candidate as POST data",
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ needs.resolve.outputs.head }}",
            "path": "candidate-data",
            "fetch-depth": 2,
            "persist-credentials": false
          }
        },
        {
          "name": "Preflight exact trusted-base checkout",
          "shell": "bash",
          "env": {
            "TRUSTED_BASE_ROOT": "${{ github.workspace }}/trusted-base",
            "SEC_BOOTSTRAP_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_BOOTSTRAP_BASE_TREE": "${{ needs.resolve.outputs.base-tree }}"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\nbun --no-env-file - <<'BUN'\n  const { lstatSync, realpathSync } = require(\"node:fs\");\n  const path = require(\"node:path\");\n  const { spawnSync } = require(\"node:child_process\");\n  const required = (name) => process.env[name] ?? (() => { throw new Error(`missing ${name}`); })();\n  const sha = (name) => {\n    const value = required(name);\n    if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${name} is not one exact SHA.`);\n    return value;\n  };\n  const logicalRoot = required(\"TRUSTED_BASE_ROOT\");\n  if (!path.isAbsolute(logicalRoot) || path.resolve(logicalRoot) !== logicalRoot) {\n    throw new Error(\"trusted-base logical root is not one absolute canonical path.\");\n  }\n  const metadata = lstatSync(logicalRoot);\n  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {\n    throw new Error(\"trusted-base root is not one ordinary non-symlink directory.\");\n  }\n  const physicalRoot = realpathSync.native(logicalRoot);\n  if (physicalRoot !== logicalRoot) {\n    throw new Error(\"trusted-base logical root is not its exact physical root.\");\n  }\n  const gitEnvironment = Object.fromEntries(Object.entries(process.env)\n    .filter(([name]) => !name.startsWith(\"GIT_\")));\n  gitEnvironment.GIT_NO_REPLACE_OBJECTS = \"1\";\n  const git = (args) => {\n    const result = spawnSync(\n      \"git\",\n      [\"--no-replace-objects\", \"-C\", physicalRoot, ...args],\n      { encoding: null, env: gitEnvironment, windowsHide: true }\n    );\n    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {\n      throw new Error(`workflow-owned trusted-base git ${args.join(\" \")} failed.`);\n    }\n    return result.stdout;\n  };\n  const exactText = (args) => git(args).toString(\"utf8\").trim();\n  if (exactText([\"rev-parse\", \"--show-toplevel\"]) !== physicalRoot ||\n      exactText([\"rev-parse\", \"--verify\", \"HEAD^{commit}\"]) !== sha(\"SEC_BOOTSTRAP_BASE\") ||\n      exactText([\"rev-parse\", \"--verify\", \"HEAD^{tree}\"]) !== sha(\"SEC_BOOTSTRAP_BASE_TREE\") ||\n      git([\"status\", \"--porcelain=v1\", \"--untracked-files=all\"]).byteLength !== 0) {\n    throw new Error(\"trusted-base workflow-owned identity, tree, root, or cleanliness preflight failed.\");\n  }\nBUN\n"
        },
        {
          "name": "Install trusted-base reducer dependencies without lifecycle scripts",
          "shell": "bash",
          "env": {
            "TRUSTED_BASE_ROOT": "${{ github.workspace }}/trusted-base"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\ncd \"$TRUSTED_BASE_ROOT\"\nbun install --frozen-lockfile --ignore-scripts\n"
        },
        {
          "name": "Download bounded checker PRE artifact",
          "id": "download-pre",
          "continue-on-error": true,
          "uses": "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
          "with": {
            "name": "trusted-bootstrap-pre-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": "${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}"
          }
        },
        {
          "name": "Download bounded candidate SUT artifact",
          "id": "download-sut",
          "continue-on-error": true,
          "uses": "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
          "with": {
            "name": "trusted-bootstrap-sut-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": "${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}"
          }
        },
        {
          "name": "Reuse PRE Actions and reduce exact bootstrap evidence",
          "shell": "bash",
          "env": {
            "TRUSTED_BASE_ROOT": "${{ github.workspace }}/trusted-base",
            "CANDIDATE_ROOT": "${{ github.workspace }}/candidate-data",
            "BOOTSTRAP_EVIDENCE_ROOT": "${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}",
            "SUT_EVIDENCE_ROOT": "${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}",
            "FINAL_EVIDENCE_ROOT": "${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}",
            "SEC_BOOTSTRAP_BASE": "${{ needs.resolve.outputs.base }}",
            "SEC_BOOTSTRAP_BASE_TREE": "${{ needs.resolve.outputs.base-tree }}",
            "SEC_BOOTSTRAP_HEAD": "${{ needs.resolve.outputs.head }}",
            "SEC_BOOTSTRAP_TREE": "${{ needs.resolve.outputs.tree }}",
            "SEC_BOOTSTRAP_RUN_ID": "${{ github.run_id }}",
            "SEC_BOOTSTRAP_RUN_ATTEMPT": "${{ github.run_attempt }}",
            "SEC_BOOTSTRAP_REGISTRY_DIGEST": "${{ needs.resolve.outputs.registry-digest }}",
            "SEC_SUT_JOB_RESULT": "${{ needs.candidate-sut.result }}",
            "SEC_PRE_DOWNLOAD_OUTCOME": "${{ steps.download-pre.outcome }}",
            "SEC_SUT_DOWNLOAD_OUTCOME": "${{ steps.download-sut.outcome }}"
          },
          "run": "set -euo pipefail\nunset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\nunset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\nTRUSTED_BASE_ROOT=\"$(realpath \"$TRUSTED_BASE_ROOT\")\"\nCANDIDATE_ROOT=\"$(realpath \"$CANDIDATE_ROOT\")\"\nBOOTSTRAP_EVIDENCE_ROOT=\"$(realpath \"$BOOTSTRAP_EVIDENCE_ROOT\")\"\nSUT_EVIDENCE_ROOT=\"$(realpath \"$SUT_EVIDENCE_ROOT\")\"\nFINAL_EVIDENCE_ROOT=\"$(realpath -m \"$FINAL_EVIDENCE_ROOT\")\"\nexport TRUSTED_BASE_ROOT CANDIDATE_ROOT BOOTSTRAP_EVIDENCE_ROOT SUT_EVIDENCE_ROOT FINAL_EVIDENCE_ROOT\nmkdir -p \"$FINAL_EVIDENCE_ROOT\"\n(cd \"$BOOTSTRAP_EVIDENCE_ROOT\" && sha256sum -c SHA256SUMS)\nSEC_BOOTSTRAP_PHASE=post SEC_BOOTSTRAP_RECEIPT=\"$FINAL_EVIDENCE_ROOT/post-receipt.json\" bun \"$BOOTSTRAP_EVIDENCE_ROOT/checker.mjs\"\ncp \"$BOOTSTRAP_EVIDENCE_ROOT/pre-receipt.json\" \"$FINAL_EVIDENCE_ROOT/pre-receipt.json\"\n{\n  printf 'schema=sec-trusted-bootstrap-environment-v1\\n'\n  printf 'base=%s\\n' '${{ needs.resolve.outputs.base }}'\n  printf 'baseTree=%s\\n' '${{ needs.resolve.outputs.base-tree }}'\n  printf 'head=%s\\n' '${{ needs.resolve.outputs.head }}'\n  printf 'tree=%s\\n' '${{ needs.resolve.outputs.tree }}'\n  printf 'registryDigest=%s\\n' '${{ needs.resolve.outputs.registry-digest }}'\n  printf 'manifestDigest=%s\\n' '${{ needs.resolve.outputs.manifest-digest }}'\n  printf 'sutJobResult=%s\\n' '${{ needs.candidate-sut.result }}'\n  printf 'bun=%s\\n' \"$(bun --revision)\"\n  printf 'git=%s\\n' \"$(git --version)\"\n  printf 'os=%s\\n' \"$(uname -a)\"\n} > \"$FINAL_EVIDENCE_ROOT/environment.txt\"\nbun --no-env-file - <<'BUN'\n  const { createHash } = require(\"node:crypto\");\n  const { readFileSync, renameSync, writeFileSync } = require(\"node:fs\");\n  const path = require(\"node:path\");\n  const required = (name) => process.env[name] ?? (() => { throw new Error(`missing ${name}`); })();\n  const root = required(\"FINAL_EVIDENCE_ROOT\");\n  const envelopePath = path.join(root, \"final-envelope.json\");\n  const envelope = JSON.parse(readFileSync(envelopePath, \"utf8\"));\n  const expectedKeys = [\n    \"baseSha\", \"baseTreeSha\", \"headSha\", \"reason\", \"receiptDigest\", \"runAttempt\",\n    \"runId\", \"schema\", \"status\", \"treeSha\"\n  ];\n  if (!envelope || typeof envelope !== \"object\" || Array.isArray(envelope) ||\n      JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(expectedKeys)) {\n    throw new Error(\"fail-closed final evidence envelope fields are invalid.\");\n  }\n  const { receiptDigest, ...semantic } = envelope;\n  const digest = (value) => `sha256:${createHash(\"sha256\").update(JSON.stringify(value)).digest(\"hex\")}`;\n  if (receiptDigest !== digest(semantic) ||\n      envelope.schema !== \"sec-trusted-bootstrap-final-evidence-v1\" ||\n      envelope.baseSha !== required(\"SEC_BOOTSTRAP_BASE\") ||\n      envelope.baseTreeSha !== required(\"SEC_BOOTSTRAP_BASE_TREE\") ||\n      envelope.headSha !== required(\"SEC_BOOTSTRAP_HEAD\") ||\n      envelope.treeSha !== required(\"SEC_BOOTSTRAP_TREE\") ||\n      envelope.runId !== required(\"SEC_BOOTSTRAP_RUN_ID\") ||\n      envelope.runAttempt !== required(\"SEC_BOOTSTRAP_RUN_ATTEMPT\") ||\n      envelope.status !== \"incomplete\" || envelope.reason !== \"checker-post-not-complete\") {\n    throw new Error(\"fail-closed final evidence envelope identity or digest is invalid.\");\n  }\n  const postReceipt = JSON.parse(readFileSync(path.join(root, \"post-receipt.json\"), \"utf8\"));\n  const { receiptDigest: postReceiptDigest, ...postSemantic } = postReceipt;\n  if (postReceiptDigest !== digest(postSemantic) ||\n      ![\"passed\", \"manual-bootstrap-required\", \"failed\"].includes(postReceipt.authorityVerdict) ||\n      ![\"passed\", \"failed\", \"invalid\", \"unavailable\"].includes(postReceipt.auxiliaryStatus)) {\n    throw new Error(\"base-owned POST authority or auxiliary diagnostic receipt is invalid.\");\n  }\n  let status;\n  let reason;\n  if (postReceipt.authorityVerdict === \"manual-bootstrap-required\") {\n    status = \"manual-bootstrap-required\";\n    reason = postReceipt.authorityReason;\n  } else if (postReceipt.authorityVerdict === \"failed\") {\n    status = \"failed\";\n    reason = postReceipt.authorityReason;\n  } else if (postReceipt.auxiliaryStatus === \"passed\") {\n    status = \"passed\";\n    reason = \"base-authority-and-candidate-auxiliary-passed\";\n  } else if (postReceipt.auxiliaryStatus === \"failed\") {\n    status = \"failed\";\n    reason = \"candidate-auxiliary-diagnostics-failed\";\n  } else {\n    status = \"incomplete\";\n    reason = \"candidate-auxiliary-diagnostics-missing-or-invalid\";\n  }\n  const final = { ...semantic, status, reason };\n  const upgraded = { ...final, receiptDigest: digest(final) };\n  const temporary = path.join(root, \"final-envelope.json.tmp\");\n  writeFileSync(temporary, `${JSON.stringify(upgraded, null, 2)}\\n`, { flag: \"wx\" });\n  renameSync(temporary, envelopePath);\nBUN\n(cd \"$FINAL_EVIDENCE_ROOT\" && \\\n  sha256sum environment.txt final-envelope.json post-receipt.json pre-receipt.json sut-diagnostic.json > SHA256SUMS.tmp && \\\n  mv SHA256SUMS.tmp SHA256SUMS)\ntest \"$(bun --no-env-file -p 'JSON.parse(require(\"node:fs\").readFileSync(process.argv[1], \"utf8\")).status' \"$FINAL_EVIDENCE_ROOT/final-envelope.json\")\" = passed\n"
        },
        {
          "name": "Upload final canonical trusted bootstrap evidence",
          "if": "always()",
          "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          "with": {
            "name": "trusted-bootstrap-v1-pr-${{ needs.resolve.outputs.pull-request }}-base-${{ needs.resolve.outputs.base }}-head-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}",
            "path": "${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}/final-envelope.json\n${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}/SHA256SUMS\n${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}/environment.txt\n${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}/post-receipt.json\n${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}/pre-receipt.json\n${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}/sut-diagnostic.json\n",
            "if-no-files-found": "error",
            "retention-days": 90
          }
        }
      ]
    }
  }
] as const);

