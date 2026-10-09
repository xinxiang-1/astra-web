param(
  [switch]$VerifyOnly,
  [string]$UserSkillRoot = (Join-Path $env:USERPROFILE '.agents/skills'),
  [string]$InstallerScript
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$webRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspaceRoot = Split-Path -Parent $webRoot
$cloudRoot = Join-Path $workspaceRoot 'astra-cloud'
$lock = Get-Content -LiteralPath (Join-Path $webRoot 'docs/development/agent-skills.lock.json') -Raw | ConvertFrom-Json
if (-not $InstallerScript) {
  $codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
  $InstallerScript = Join-Path $codexRoot 'skills/.system/skill-installer/scripts/install-skill-from-github.py'
}

function Assert-SkillFiles {
  param([string]$SkillRoot, $Package)
  if (-not (Test-Path -LiteralPath (Join-Path $SkillRoot 'SKILL.md') -PathType Leaf)) {
    throw "Missing skill manifest: $($Package.name)"
  }
  foreach ($file in $Package.files) {
    $filePath = Join-Path $SkillRoot $file.path
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Missing file: $($Package.name)/$($file.path)" }
    $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $file.sha256) { throw "Skill differs from lock: $($Package.name)/$($file.path). Preserve and review; no automatic overwrite." }
  }
  $actualFiles = @(Get-ChildItem -LiteralPath $SkillRoot -Recurse -File)
  if ($actualFiles.Count -ne @($Package.files).Count) { throw "Unexpected files in skill: $($Package.name)" }
}

foreach ($package in $lock.packages) {
  $skillRoot = Join-Path $UserSkillRoot $package.name
  if (-not (Test-Path -LiteralPath $skillRoot)) {
    if ($VerifyOnly) { throw "Skill not installed: $($package.name)" }
    if (-not (Test-Path -LiteralPath $InstallerScript -PathType Leaf)) { throw 'Codex skill-installer script missing; provide -InstallerScript.' }
    & python $InstallerScript --repo $lock.source.repo --ref $lock.source.commit --path $package.sourcePath --dest $UserSkillRoot
    if ($LASTEXITCODE -ne 0) { throw "Installation failed: $($package.name)" }
  }
  Assert-SkillFiles -SkillRoot $skillRoot -Package $package
  Write-Output "Verified official skill: $($package.name)"
}

# Codex is launched at the workspace parent here; expose repository-owned skills
# through supported directory links without maintaining another content copy.
$workspaceSkills = Join-Path $workspaceRoot '.agents/skills'
$links = @(
  @{ Name = 'ascii-engine-optimizer'; Target = (Join-Path $webRoot '.agents/skills/ascii-engine-optimizer') },
  @{ Name = 'astra-web-validation'; Target = (Join-Path $webRoot '.agents/skills/astra-web-validation') },
  @{ Name = 'astra-cloud-validation'; Target = (Join-Path $cloudRoot '.agents/skills/astra-cloud-validation') }
)
foreach ($link in $links) {
  $target = [IO.Path]::GetFullPath($link.Target)
  if (-not (Test-Path -LiteralPath (Join-Path $target 'SKILL.md') -PathType Leaf)) { throw "Repository skill missing: $target" }
  $linkPath = Join-Path $workspaceSkills $link.Name
  $existing = Get-Item -LiteralPath $linkPath -Force -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.LinkType -notin @('Junction', 'SymbolicLink')) { throw "Existing directory is not a link: $linkPath. Refusing overwrite." }
    $resolved = [IO.Path]::GetFullPath([string]@($existing.Target)[0])
    if ($resolved -ne $target) { throw "Existing link has a different target: $linkPath. Refusing overwrite." }
  } else {
    if ($VerifyOnly) { throw "Workspace skill link missing: $linkPath" }
    New-Item -ItemType Directory -Path $workspaceSkills -Force | Out-Null
    $linkType = if ($env:OS -eq 'Windows_NT') { 'Junction' } else { 'SymbolicLink' }
    New-Item -ItemType $linkType -Path $linkPath -Target $target | Out-Null
  }
  Write-Output "Verified workspace skill: $($link.Name)"
}
Write-Output 'Agent skills configured. Newly installed skills are available on the next turn; restart Codex if they do not appear.'
