<#
  Opens Echo so you can check it.

    .\run.ps1          opens whatever is checked out now
    .\run.ps1 7        fetches pull request 7 and opens that
    .\run.ps1 main     switches to the approved version and opens that

  -CheckOnly builds everything but does not open the window. The automated
  checks use it.

  If Windows refuses to run this file, use:
    powershell -ExecutionPolicy Bypass -File .\run.ps1 7
#>
param(
  [Parameter(Position = 0)][string]$Target = '',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Stop-WithMessage([string]$Message) {
  Write-Host ''
  Write-Host "STOPPED: $Message" -ForegroundColor Red
  exit 1
}

function Invoke-Step([string]$Label, [scriptblock]$Command) {
  Write-Host ''
  Write-Host "== $Label" -ForegroundColor Cyan
  # Tools like git and npm print ordinary progress and warnings on the error
  # channel. Only their exit code says whether they failed, so that is all
  # that is checked here.
  $ErrorActionPreference = 'Continue'
  & $Command
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage "$Label failed. The messages above say why." }
}

# 1. Node.js must be installed and new enough.
$MinimumNode = [version]'22.18.0'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Stop-WithMessage 'Node.js is not installed. Install the LTS version from https://nodejs.org, close this window, open a new one and run this again.'
}
$NodeVersion = [version]((& node -v).TrimStart('v'))
if ($NodeVersion -lt $MinimumNode) {
  Stop-WithMessage "Node.js $NodeVersion is too old. Echo needs $MinimumNode or newer. Install the LTS version from https://nodejs.org and run this again."
}

# 2. Echo must not already be open from this folder: its files cannot be
#    replaced while it is running.
$Running = Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($PSScriptRoot, [System.StringComparison]::OrdinalIgnoreCase) }
if ($Running) {
  Stop-WithMessage 'Echo is already open. Close the Echo window, then run this again.'
}

# 3. Move to the version asked for.
if ($Target -ne '') {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'Git is not installed, so a pull request cannot be fetched.'
  }
  $Uncommitted = & git status --porcelain
  if ($Uncommitted) {
    Stop-WithMessage 'This folder has changes that are not saved to Git. Nothing was touched. Tell Claude what git status shows.'
  }
  if ($Target -match '^\d+$') {
    Invoke-Step "Fetching pull request $Target" { git fetch origin "pull/$Target/head" }
    Invoke-Step "Switching to pull request $Target" { git checkout --detach FETCH_HEAD }
  }
  elseif ($Target -eq 'main') {
    Invoke-Step 'Switching to the approved version' { git checkout main }
    Invoke-Step 'Getting the latest approved version' { git pull --ff-only }
  }
  else {
    Stop-WithMessage "'$Target' is not a pull request number or 'main'."
  }
}

# 4. Install exactly what this version needs. --include=dev matters: some PCs have
#    NODE_ENV=production set, which silently skips the tools needed to build Echo.
if (Test-Path 'package-lock.json') {
  Invoke-Step 'Installing what Echo needs' { npm ci --include=dev --no-audit --no-fund }
}
else {
  Invoke-Step 'Installing what Echo needs' { npm install --include=dev --no-audit --no-fund }
}

# 5. Build, and open unless only checking.
if ($CheckOnly) {
  Invoke-Step 'Building Echo' { npm run build }
  Write-Host ''
  Write-Host 'Echo built. -CheckOnly was given, so the window was not opened.' -ForegroundColor Green
}
else {
  Invoke-Step 'Opening Echo' { npm start }
}
