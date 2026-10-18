<#
.SYNOPSIS
  Updates the Room Forty guild server files to the latest published release.

.DESCRIPTION
  1. Finds the latest *published* RoomFortyRecorder release on GitHub. Drafts
     are ignored, so publishing a release is what approves a server update.
  2. Downloads the files listed in server-files.txt from that release's tag
     into a staging folder and checks each .mjs file with `node --check`.
  3. Backs up the current files, stops the Node scheduled task, copies the
     new files in and starts the task again.
  4. Waits for /health. If the server doesn't come back, it restores the
     backup and starts the old version.

  .env is never touched. New settings in .env.example are listed at the end.

  Double-click update-server.cmd to run it, or run with -InstallDaily once to
  have Windows run it every morning.

.PARAMETER InstallDaily
  Register a daily scheduled task ("RoomFortyRecorder Server Update") that
  runs this script at -DailyAt (default 06:00) and exits.

.PARAMETER Force
  Reinstall even if the server is already on the latest release.
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'RoomFortyRecorder Guild Cloud',
  [string]$Repo = 'Evi-Git/RoomFortyRecorder',
  [string]$Tag = '',
  [switch]$Force,
  [switch]$Quiet,
  [switch]$InstallDaily,
  [string]$DailyAt = '06:00',
  [string]$ServerDir = $PSScriptRoot,
  [string]$HealthUrl = 'http://127.0.0.1:8787/health',
  [string]$ApiBase = 'https://api.github.com',
  [string]$RawBase = 'https://raw.githubusercontent.com',
  # For testing: skip stopping/starting the scheduled task.
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$UpdateTaskName = 'RoomFortyRecorder Server Update'
$VersionFile = Join-Path $ServerDir 'SERVER_VERSION'
$LogFile = Join-Path $ServerDir 'update-server.log'
$KeepBackups = 5

# Windows PowerShell 5.1 defaults to old TLS versions that GitHub refuses.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

function Write-Log([string]$Message, [string]$Color = 'Gray') {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $Message -ForegroundColor $Color
  try { Add-Content -Path $LogFile -Value $line } catch { }
}

function Finish([int]$Code) {
  if (-not $Quiet) {
    Write-Host ''
    Read-Host 'Press Enter to close' | Out-Null
  }
  exit $Code
}

function Test-Admin {
  if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { return $true }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Text([string]$Url) {
  $headers = @{ 'User-Agent' = 'RoomFortyRecorder-server-updater' }
  $content = (Invoke-WebRequest -Uri $Url -Headers $headers -UseBasicParsing -TimeoutSec 30).Content
  # Some responses come back as bytes depending on content type and version.
  if ($content -is [byte[]]) { $content = [Text.Encoding]::UTF8.GetString($content) }
  return [string]$content
}

function Get-NodePath {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $default = 'C:\Program Files\nodejs\node.exe'
  if (Test-Path $default) { return $default }
  throw 'Node.js was not found. Install it or add it to PATH.'
}

function Wait-Healthy([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Stop-Server {
  if ($NoRestart) { return }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  # Give Node a moment to exit and release the port.
  Start-Sleep -Seconds 3
}

function Start-Server {
  if ($NoRestart) { return }
  Start-ScheduledTask -TaskName $TaskName
}

# ---- Relaunch elevated if needed -------------------------------------------
# The Node task runs with highest privileges, so stopping and starting it, and
# registering the daily task, need an administrator.
if (-not $NoRestart -and -not (Test-Admin)) {
  Write-Host 'Asking for administrator rights to restart the server...'
  $forward = @()
  foreach ($entry in $PSBoundParameters.GetEnumerator()) {
    if ($entry.Value -is [switch]) {
      if ($entry.Value.IsPresent) { $forward += "-$($entry.Key)" }
    } else {
      $forward += "-$($entry.Key)"
      $forward += ('"{0}"' -f $entry.Value)
    }
  }
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath)) + $forward
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments | Out-Null
  } catch {
    Write-Host 'The update needs administrator rights. Run it again and choose Yes.' -ForegroundColor Red
    Finish 1
  }
  exit 0
}

# ---- Daily task -------------------------------------------------------------
if ($InstallDaily) {
  $time = [datetime]::ParseExact($DailyAt, 'HH:mm', $null)
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Quiet' -f $PSCommandPath) `
    -WorkingDirectory $ServerDir
  $trigger = New-ScheduledTaskTrigger -Daily -At $time
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
  Register-ScheduledTask -TaskName $UpdateTaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
  Write-Log "Daily update task installed: '$UpdateTaskName' at $DailyAt. It only installs releases you have published." 'Green'
  Write-Log "To remove it: Unregister-ScheduledTask -TaskName '$UpdateTaskName'"
  Finish 0
}

# ---- Find the release ---------------------------------------------------------
try {
  if (-not $Tag) {
    $release = Get-Text "$ApiBase/repos/$Repo/releases/latest" | ConvertFrom-Json
    $Tag = $release.tag_name
  }
  if (-not $Tag) { throw 'No published release found.' }
} catch {
  Write-Log "Could not find the latest release: $($_.Exception.Message)" 'Red'
  Finish 1
}

$current = ''
if (Test-Path $VersionFile) { $current = (Get-Content $VersionFile -Raw).Trim() }

if ($current -eq $Tag -and -not $Force) {
  Write-Log "Server is already on $Tag. Nothing to do." 'Green'
  Finish 0
}

$fromLabel = $current
if (-not $fromLabel) { $fromLabel = 'unknown version' }
Write-Log "Updating server from $fromLabel to $Tag..." 'Cyan'

# ---- Download and check -------------------------------------------------------
$staging = Join-Path $ServerDir '.update'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

try {
  $base = "$RawBase/$Repo/$Tag/guild-cloud-server"
  $manifest = Get-Text "$base/server-files.txt"
  $files = @(
    $manifest -split "`r?`n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -and -not $_.StartsWith('#') }
  )

  foreach ($file in $files) {
    # Plain file names only, and never the secrets file.
    if ($file -notmatch '^[A-Za-z0-9._-]+$' -or $file -eq '.env') {
      throw "Refusing to install '$file' from server-files.txt."
    }
  }
  if ($files.Count -eq 0) { throw 'server-files.txt is empty.' }

  foreach ($file in $files) {
    $target = Join-Path $staging $file
    $headers = @{ 'User-Agent' = 'RoomFortyRecorder-server-updater' }
    Invoke-WebRequest -Uri "$base/$file" -Headers $headers -UseBasicParsing -TimeoutSec 60 -OutFile $target
    Write-Log "  downloaded $file"
  }

  $node = Get-NodePath
  foreach ($file in ($files | Where-Object { $_ -like '*.mjs' })) {
    $output = & $node --check (Join-Path $staging $file) 2>&1
    if ($LASTEXITCODE -ne 0) { throw "$file failed node --check: $output" }
  }
  Write-Log '  files check out' 'Green'
} catch {
  Write-Log "Download failed, nothing changed: $($_.Exception.Message)" 'Red'
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  Finish 1
}

# ---- Back up, swap, restart -----------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupName = $stamp
if ($current) { $backupName = "$stamp-$current" }
$backup = Join-Path (Join-Path $ServerDir 'backup') $backupName
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($file in ($files + 'SERVER_VERSION')) {
  $existing = Join-Path $ServerDir $file
  if (Test-Path $existing) { Copy-Item $existing $backup -Force }
}
Write-Log "  backed up current files to backup\$backupName"

function Restore-Backup {
  Write-Log 'Restoring the previous version...' 'Yellow'
  Stop-Server
  foreach ($file in $files) {
    $saved = Join-Path $backup $file
    $live = Join-Path $ServerDir $file
    if (Test-Path $saved) { Copy-Item $saved $live -Force }
    elseif (Test-Path $live) { Remove-Item $live -Force }
  }
  $savedVersion = Join-Path $backup 'SERVER_VERSION'
  if (Test-Path $savedVersion) { Copy-Item $savedVersion $VersionFile -Force }
  elseif (Test-Path $VersionFile) { Remove-Item $VersionFile -Force }
  Start-Server
}

try {
  Stop-Server
  foreach ($file in $files) {
    Copy-Item (Join-Path $staging $file) (Join-Path $ServerDir $file) -Force
  }
  Set-Content -Path $VersionFile -Value $Tag -NoNewline
  Start-Server
} catch {
  Write-Log "Install failed: $($_.Exception.Message)" 'Red'
  Restore-Backup
  Finish 1
}

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

if (-not $NoRestart) {
  Write-Log '  waiting for the server to answer /health...'
  if (-not (Wait-Healthy 45)) {
    Write-Log "The server didn't come back on $Tag." 'Red'
    Restore-Backup
    if (Wait-Healthy 45) {
      Write-Log "Back on $fromLabel. Check the server window or Task Scheduler for the error." 'Yellow'
    } else {
      Write-Log 'The previous version is not answering either. Check Task Scheduler.' 'Red'
    }
    Finish 1
  }
}

Write-Log "Server updated to $Tag." 'Green'

# ---- Housekeeping ----------------------------------------------------------------
$backupRoot = Join-Path $ServerDir 'backup'
Get-ChildItem $backupRoot -Directory | Sort-Object Name -Descending |
  Select-Object -Skip $KeepBackups | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# New settings in .env.example that .env doesn't mention yet.
$envFile = Join-Path $ServerDir '.env'
$exampleFile = Join-Path $ServerDir '.env.example'
if ((Test-Path $envFile) -and (Test-Path $exampleFile)) {
  $keyPattern = '^\s*#?\s*(GUILD_CLOUD_[A-Z0-9_]+)\s*='
  $known = @{}
  foreach ($line in Get-Content $envFile) {
    if ($line -match $keyPattern) { $known[$Matches[1]] = $true }
  }
  $new = @()
  foreach ($line in Get-Content $exampleFile) {
    if ($line -match $keyPattern -and -not $known.ContainsKey($Matches[1]) -and $new -notcontains $Matches[1]) {
      $new += $Matches[1]
    }
  }
  if ($new.Count -gt 0) {
    Write-Log ('New optional settings in .env.example: ' + ($new -join ', ')) 'Yellow'
  }
}

Finish 0
