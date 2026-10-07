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
$PdfRendererDir = Join-Path $InstallDir "SumatraPDF"
$PdfRendererPath = Join-Path $PdfRendererDir "SumatraPDF.exe"
$PdfRendererVersion = "3.6.1"

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
  try {
    return Invoke-RestMethod @arguments
  } catch {
    $message = $_.Exception.Message
    $response = $_.Exception.Response
    if ($response) {
      try {
        $stream = $response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $payload = $reader.ReadToEnd() | ConvertFrom-Json
        if ($payload.error) { $message = [string]$payload.error }
      } catch { }
    }
    throw $message
  }
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

function Install-PdfRenderer {
  if (Test-Path -LiteralPath $PdfRendererPath) { return $PdfRendererPath }
  New-Item -ItemType Directory -Path $PdfRendererDir -Force | Out-Null
  $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $suffix = if ($architecture -eq "arm64") { "-arm64" } elseif ($architecture -eq "x86") { "" } else { "-64" }
  $installerName = "SumatraPDF-$PdfRendererVersion$suffix-install.exe"
  $installerPath = Join-Path $env:TEMP $installerName
  $downloadUrl = "https://www.sumatrapdfreader.org/dl/rel/$PdfRendererVersion/$installerName"
  Write-AgentLog "Installing the DataPlus PDF print renderer."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $downloadUrl -UseBasicParsing -OutFile $installerPath
  $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
  if ($signature.Status -ne "Valid") { throw "The PDF renderer download did not have a valid Windows signature." }
  $process = Start-Process -FilePath $installerPath -ArgumentList @("-x", "-d", $PdfRendererDir) -WindowStyle Hidden -Wait -PassThru
  Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $PdfRendererPath)) { throw "The PDF print renderer could not be installed (exit code $($process.ExitCode))." }
  return $PdfRendererPath
}

function Print-Pdf([string]$FilePath, [string]$PrinterName) {
  $sumatra = @(
    $PdfRendererPath,
    (Join-Path $env:LOCALAPPDATA "SumatraPDF\SumatraPDF.exe"),
    (Join-Path $env:ProgramFiles "SumatraPDF\SumatraPDF.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "SumatraPDF\SumatraPDF.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $sumatra) { $sumatra = Install-PdfRenderer }
  $process = Start-Process -FilePath $sumatra -ArgumentList @("-print-to", $PrinterName, "-silent", $FilePath) -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "The PDF renderer exited with code $($process.ExitCode)." }
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
  Install-PdfRenderer | Out-Null
  if ($PairCode) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstalledScript -PairCode $PairCode -ServerUrl $ServerUrl -StationName $StationName
    if ($LASTEXITCODE -ne 0) { throw "Print-agent pairing failed. Create a new pairing code in DataPlus and run the install command again." }
    if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Print-agent pairing did not create a configuration file." }
  } elseif (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "This computer is not paired. Install again using the pairing command from DataPlus."
  }
  $startupCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstalledScript`" -Run"
  New-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "DataPlusPrintAgent" -Value $startupCommand
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$InstalledScript*" -and $_.CommandLine -like "*-Run*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $InstalledScript, "-Run") -WindowStyle Hidden
  Write-Host "DataPlus Print Agent installed, updated, and started. It will start automatically when this user signs in."
  exit 0
}

if ($PairCode) { Pair-Agent; exit 0 }
if ($Run) { Run-Agent; exit 0 }
Write-Host "Use the install command shown in DataPlus under Fulfillment > Print stations."
