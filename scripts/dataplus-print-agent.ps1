param(
  [string]$PairCode = "",
  [string]$ServerUrl = "https://dataplusapp.duckdns.org",
  [string]$StationName = $env:COMPUTERNAME,
  [switch]$Install,
  [switch]$Run
)

$ErrorActionPreference = "Stop"
$InstallDir = Join-Path $env:LOCALAPPDATA "DataPlus\PrintAgent"
$InstalledScript = Join-Path $InstallDir "DataPlusPrintAgent.ps1"
$ConfigPath = Join-Path $InstallDir "config.json"
$LogPath = Join-Path $InstallDir "agent.log"

function Write-AgentLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -ErrorAction SilentlyContinue
  if (-not $Run) { Write-Host $Message }
}

function Get-PrinterInfo {
  $rows = @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue)
  return @{
    printers = @($rows | ForEach-Object { [string]$_.Name } | Where-Object { $_ })
    defaultPrinter = [string](($rows | Where-Object { $_.Default } | Select-Object -First 1).Name)
  }
}

function Invoke-AgentJson([string]$Path, [string]$Method = "GET", $Body = $null, [string]$Token = "") {
  $headers = @{}
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  $arguments = @{ Uri = "$(($ServerUrl).TrimEnd('/'))$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $arguments.ContentType = "application/json"
    $arguments.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }
  return Invoke-RestMethod @arguments
}

function Pair-Agent {
  if (-not $PairCode) { throw "A pairing code is required." }
  $printerInfo = Get-PrinterInfo
  $result = Invoke-AgentJson -Path "/api/fulfillment/print-agent/pair" -Method "POST" -Body @{
    code = $PairCode
    name = $StationName
    hostname = $env:COMPUTERNAME
    platform = "Windows $([Environment]::OSVersion.Version)"
    printers = $printerInfo.printers
    defaultPrinter = $printerInfo.defaultPrinter
  }
  @{
    url = $ServerUrl.TrimEnd('/')
    stationId = $result.station.id
    stationName = $result.station.name
    agentToken = $result.agentToken
    defaultPrinter = $result.station.defaultPrinter
  } | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  Write-AgentLog "Paired $($result.station.name)."
}

function Send-JobStatus($Config, [string]$JobId, [string]$Status, [string]$ErrorMessage = "") {
  Invoke-AgentJson -Path "/api/fulfillment/print-agent/jobs/$([Uri]::EscapeDataString($JobId))/status" -Method "POST" -Token $Config.agentToken -Body @{ status = $Status; error = $ErrorMessage } | Out-Null
}

function Print-Pdf([string]$FilePath, [string]$PrinterName) {
  $sumatra = @(
    (Join-Path $env:LOCALAPPDATA "SumatraPDF\SumatraPDF.exe"),
    (Join-Path $env:ProgramFiles "SumatraPDF\SumatraPDF.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "SumatraPDF\SumatraPDF.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($sumatra) {
    $process = Start-Process -FilePath $sumatra -ArgumentList @("-print-to", $PrinterName, "-silent", $FilePath) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "SumatraPDF exited with code $($process.ExitCode)." }
    return
  }
  $defaultPrinter = (Get-PrinterInfo).defaultPrinter
  if ($PrinterName -and $defaultPrinter -and $PrinterName -ne $defaultPrinter) {
    throw "Install SumatraPDF to print silently to '$PrinterName', or make it the Windows default printer."
  }
  Start-Process -FilePath $FilePath -Verb Print -WindowStyle Hidden -Wait
}

function Run-Agent {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "The DataPlus print agent is not paired." }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $script:ServerUrl = [string]$config.url
  Write-AgentLog "Print agent started."
  while ($true) {
    try {
      $printerInfo = Get-PrinterInfo
      Invoke-AgentJson -Path "/api/fulfillment/print-agent/heartbeat" -Method "POST" -Token $config.agentToken -Body @{
        hostname = $env:COMPUTERNAME
        platform = "Windows $([Environment]::OSVersion.Version)"
        printers = $printerInfo.printers
        defaultPrinter = $printerInfo.defaultPrinter
      } | Out-Null
      $response = Invoke-AgentJson -Path "/api/fulfillment/print-agent/jobs" -Token $config.agentToken
      $job = $response.job
      if ($job) {
        $filePath = Join-Path $env:TEMP "$($job.printNumber)-$($job.id).pdf"
        try {
          Send-JobStatus $config $job.id "printing"
          $headers = @{ Authorization = "Bearer $($config.agentToken)" }
          Invoke-WebRequest -Uri "$($config.url)$($job.documentUrl)" -Headers $headers -UseBasicParsing -OutFile $filePath
          Print-Pdf -FilePath $filePath -PrinterName ([string]$job.printerName)
          Send-JobStatus $config $job.id "printed"
          Write-AgentLog "Printed $($job.printNumber) on $($job.printerName)."
        } catch {
          Send-JobStatus $config $job.id "failed" $_.Exception.Message
          Write-AgentLog "Failed $($job.printNumber): $($_.Exception.Message)"
        } finally {
          Remove-Item -LiteralPath $filePath -Force -ErrorAction SilentlyContinue
        }
      }
    } catch {
      Write-AgentLog "Connection error: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 5
  }
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

if ($Install) {
  Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstalledScript -PairCode $PairCode -ServerUrl $ServerUrl -StationName $StationName
  $startupCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstalledScript`" -Run"
  New-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "DataPlusPrintAgent" -Value $startupCommand
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $InstalledScript, "-Run") -WindowStyle Hidden
  Write-Host "DataPlus Print Agent installed and started. It will start automatically when this user signs in."
  exit 0
}

if ($PairCode) { Pair-Agent; exit 0 }
if ($Run) { Run-Agent; exit 0 }
Write-Host "Use the install command shown in DataPlus under Fulfillment > Print stations."
