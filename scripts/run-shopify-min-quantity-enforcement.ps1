param(
  [int]$StartOffset = 0,
  [int]$Limit = 500,
  [int]$StopBefore = 1000000,
  [switch]$DeleteEachOnly,
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not $LogPath) {
  $stamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
  $LogPath = Join-Path $repoRoot "outputs\shopify-min-quantity-enforcement\runner-$stamp.log"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null

$offset = $StartOffset
while ($offset -lt $StopBefore) {
  $startedAt = Get-Date -Format "o"
  "[$startedAt] offset=$offset limit=$Limit start" | Tee-Object -FilePath $LogPath -Append

  $args = @("scripts\shopify-min-quantity-enforcement.js", "--apply", "--limit", "$Limit", "--offset", "$offset")
  if ($DeleteEachOnly) {
    $args += "--delete-each-only"
  }

  & node @args 2>&1 | Tee-Object -FilePath $LogPath -Append
  $exitCode = $LASTEXITCODE
  $finishedAt = Get-Date -Format "o"
  "[$finishedAt] offset=$offset exit=$exitCode" | Tee-Object -FilePath $LogPath -Append

  if ($exitCode -ne 0) {
    exit $exitCode
  }

  $offset += $Limit
}
