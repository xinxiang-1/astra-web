param(
  [string]$Session = 'astra-dev',
  [Parameter(Mandatory = $true)][string[]]$CliArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Session -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Session must contain letters, digits, _ or -.' }
if ($CliArgs.Count -eq 0) { throw 'A Playwright CLI command is required.' }
$npxCommand = if ($env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
if (-not (Get-Command $npxCommand -ErrorAction SilentlyContinue)) {
  throw 'Node.js/npm with npx is required.'
}
# Invoke an argument array directly; never construct an executable command string.
& $npxCommand --yes --package '@playwright/cli@0.1.22' playwright-cli "--session=$Session" @CliArgs
exit $LASTEXITCODE
