[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('P', 'Q')]
    [string] $Checkpoint,

    [Parameter(Mandatory)]
    [string] $Destination,

    [string] $SourceRepository = 'https://github.com/BurntSushi/ripgrep.git'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This assembles a design sample from ordinary versioned author materials.
# It does not interpret a Gift model, generate Rust, qualify a binding or build.
$revisions = @{
    P = '4c2362d359d9913c7a5e391ccd79cb4da22bc89b'
    Q = '7155f6408d370e699795dc75e954635abfaf08a6'
}
$revision = $revisions[$Checkpoint]
$destinationPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
if (Test-Path -LiteralPath $destinationPath) {
    throw "Destination already exists; refusing to overwrite: $destinationPath"
}
$parentPath = Split-Path -Parent $destinationPath
if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
    throw "Destination parent must already exist: $parentPath"
}
$patchPath = Join-Path $PSScriptRoot "patches/$Checkpoint.patch"
$modelPath = Join-Path $PSScriptRoot "models/$Checkpoint/path-policy.module.json"
$methodPath = Join-Path $PSScriptRoot "methods/$Checkpoint/path_policy.rs"
foreach ($required in @($patchPath, $modelPath, $methodPath,
    (Join-Path $PSScriptRoot 'gift.project.template.json'),
    (Join-Path $PSScriptRoot 'PROFILES.md'),
    (Join-Path $PSScriptRoot 'EQUIVALENCE.md'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing distribution material: $required"
    }
}

function Invoke-SampleGit {
    param([string[]] $GitArguments)
    & git @GitArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git failed with exit code $LASTEXITCODE; partial instance retained at $destinationPath"
    }
}

# A real repository at native/ preserves build.rs's original Git-version input.
# No workspace/global Git settings, dependencies or toolchains are installed.
$null = New-Item -ItemType Directory -Path $destinationPath
$nativePath = Join-Path $destinationPath 'native'
Invoke-SampleGit @('init', '--quiet', '--', $nativePath)
Invoke-SampleGit @('-C', $nativePath, 'config', '--local', 'core.autocrlf', 'false')
Invoke-SampleGit @('-C', $nativePath, 'fetch', '--no-tags', '--depth=1', '--', $SourceRepository, $revision)
Invoke-SampleGit @('-C', $nativePath, '-c', 'core.autocrlf=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD')
$actualRevision = (Invoke-SampleGit @('-C', $nativePath, 'rev-parse', 'HEAD')).Trim()
if ($actualRevision -ne $revision) {
    throw "Unexpected upstream revision: $actualRevision; partial instance retained at $destinationPath"
}
Invoke-SampleGit @('-C', $nativePath, 'apply', '--check', '--', $patchPath)
Invoke-SampleGit @('-C', $nativePath, 'apply', '--', $patchPath)
$methodDestination = Join-Path $nativePath 'crates/ignore/src/gift_path_policy.rs'
if (Test-Path -LiteralPath $methodDestination) {
    throw "Method destination already exists: $methodDestination"
}
Copy-Item -LiteralPath $methodPath -Destination $methodDestination
$designPath = Join-Path $destinationPath 'design'
$null = New-Item -ItemType Directory -Path $designPath
Copy-Item -LiteralPath $modelPath -Destination (Join-Path $designPath 'path-policy.module.json')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'gift.project.template.json') -Destination (Join-Path $destinationPath 'gift.project.json')
foreach ($name in @('PROFILES.md', 'EQUIVALENCE.md')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $destinationPath $name)
}
[pscustomobject]@{
    Instance = $destinationPath
    UpstreamRevision = $actualRevision
    NativeAuthorRoot = $nativePath
    Status = 'Design sources assembled; production Gift validation not executed'
}
