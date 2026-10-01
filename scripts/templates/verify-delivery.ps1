param(
  [string]$PackageRoot = $PSScriptRoot,
  [string]$ZipPath = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Get-AstraHash([string]$Path) {
  $astraStream = [System.IO.File]::OpenRead($Path)
  $astraSha = [System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($astraSha.ComputeHash($astraStream)).Replace('-', '').ToLowerInvariant() }
  finally { $astraStream.Dispose(); $astraSha.Dispose() }
}
$astraRoot = [System.IO.Path]::GetFullPath($PackageRoot)
$astraManifestFile = Join-Path $astraRoot 'manifest.json'
$astraManifest = Get-Content -LiteralPath $astraManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($astraManifest.schemaVersion -ne 1) { throw 'Unknown delivery manifest version' }
$astraSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$astraRootPrefix = $astraRoot.TrimEnd([char]92, [char]47) + [System.IO.Path]::DirectorySeparatorChar
foreach ($astraAsset in $astraManifest.assets) {
  if ($astraAsset.path -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_./-]*$' -or $astraAsset.path.Split('/') -contains '..' -or $astraAsset.path.Split('/') -contains '.' -or $astraAsset.path.Split('/') -contains '') { throw 'Invalid asset path' }
  if (-not $astraSeen.Add($astraAsset.path)) { throw 'Duplicate asset path' }
  $astraTarget = [System.IO.Path]::GetFullPath((Join-Path $astraRoot $astraAsset.path))
  if (-not $astraTarget.StartsWith($astraRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes delivery root' }
  $astraFile = Get-Item -LiteralPath $astraTarget
  if ($astraFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Asset cannot be a link' }
  if ($astraFile.Length -ne $astraAsset.bytes) { throw "Size mismatch: $($astraAsset.path)" }
  if ((Get-AstraHash $astraTarget) -ne $astraAsset.sha256) { throw "Hash mismatch: $($astraAsset.path)" }
}
$astraFiles = @(Get-ChildItem -LiteralPath $astraRoot -Recurse -File)
if ($astraFiles.Count -ne $astraManifest.assets.Count + 1) { throw 'Delivery has missing or unlisted files' }
foreach ($astraFile in $astraFiles) {
  $astraRelative = $astraFile.FullName.Substring($astraRootPrefix.Length).Replace([char]92, [char]47)
  if ($astraRelative -ne 'manifest.json' -and -not $astraSeen.Contains($astraRelative)) { throw 'Unlisted file' }
}
$astraZipChecked = $false
if ($ZipPath) {
  $astraArchive = [System.IO.Compression.ZipFile]::OpenRead([System.IO.Path]::GetFullPath($ZipPath))
  try {
    $astraPrefix = [System.IO.Path]::GetFileName($astraRoot) + '/'
    $astraEntries = @($astraArchive.Entries)
    if ($astraEntries.Count -ne $astraManifest.assets.Count + 1) { throw 'ZIP entry count mismatch' }
    $astraZipSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($astraEntry in $astraEntries) {
      if (-not $astraEntry.FullName.StartsWith($astraPrefix, [System.StringComparison]::Ordinal)) { throw 'ZIP root mismatch' }
      $astraRelative = $astraEntry.FullName.Substring($astraPrefix.Length)
      if (-not $astraZipSeen.Add($astraRelative)) { throw 'ZIP duplicate entry' }
      $astraAsset = @($astraManifest.assets | Where-Object { $_.path -ceq $astraRelative })
      if ($astraRelative -eq 'manifest.json') {
        $astraExpectedSize = (Get-Item -LiteralPath $astraManifestFile).Length
        $astraExpectedHash = Get-AstraHash $astraManifestFile
      } else {
        if ($astraAsset.Count -ne 1) { throw 'ZIP unlisted entry' }
        $astraExpectedSize = $astraAsset[0].bytes
        $astraExpectedHash = $astraAsset[0].sha256
      }
      if ($astraEntry.Length -ne $astraExpectedSize) { throw 'ZIP size mismatch' }
      $astraStream = $astraEntry.Open()
      $astraSha = [System.Security.Cryptography.SHA256]::Create()
      try { $astraActualHash = [System.BitConverter]::ToString($astraSha.ComputeHash($astraStream)).Replace('-', '').ToLowerInvariant() }
      finally { $astraStream.Dispose(); $astraSha.Dispose() }
      if ($astraActualHash -ne $astraExpectedHash) { throw 'ZIP asset hash mismatch' }
    }
    $astraZipChecked = $true
  } finally { $astraArchive.Dispose() }
}
[pscustomobject]@{ passed = $true; assets = $astraManifest.assets.Count; zipChecked = $astraZipChecked } | ConvertTo-Json -Compress
