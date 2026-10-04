[CmdletBinding()]
param(
    [string]$InstallRoot = 'C:\Apps\PersonalWorkbench',
    [string]$PackageRoot = (Join-Path $PSScriptRoot '..\..'),
    [switch]$PlanOnly,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Utf8File([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Assert-SafeRoot([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:\\') { throw 'Unsafe install directory: use an absolute local drive path.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $drive = [IO.Path]::GetPathRoot($full).TrimEnd('\')
    if ($full -eq $drive -or $full.Substring($drive.Length).Split('\', [StringSplitOptions]::RemoveEmptyEntries).Length -lt 2) {
        throw 'Unsafe install directory: select a dedicated application folder.'
    }
    foreach ($protected in @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($protected -and ($full -eq $protected -or $full.StartsWith($protected + '\', [StringComparison]::OrdinalIgnoreCase))) {
            throw 'Unsafe install directory: protected system directory.'
        }
    }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe install directory: reparse point.' }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    if ((Test-Path -LiteralPath $full) -and @(Get-ChildItem -LiteralPath $full -Force).Count -gt 0) {
        $marker = Join-Path $full '.workbench-installation'
        if (-not (Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker).Trim() -ne 'personal-workbench-v1') {
            throw 'Directory is not a workbench installation; existing files were not changed.'
        }
    }
    return $full
}

$InstallRoot = Assert-SafeRoot $InstallRoot
$PackageRoot = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')
if ($PackageRoot -eq $InstallRoot -or $PackageRoot.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $InstallRoot.StartsWith($PackageRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package and installation folders must be separate.'
}
foreach ($required in @('dist\index.html', 'server\index.mjs', 'package.json', 'package-lock.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot $required) -PathType Leaf)) { throw "Incomplete package: $required" }
}
$plan = [ordered]@{ installRoot=$InstallRoot; host='127.0.0.1'; port=4318; origin='http://127.0.0.1:4318'; publicHttpsEnabled=$false; task='PersonalWorkbench-App' }
if ($PlanOnly) { $plan | ConvertTo-Json -Compress; return }
if (-not $PrepareOnly) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run installation in administrator PowerShell on the server.' }
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
foreach ($folder in @('data', 'logs', 'releases', 'runtime', 'scripts', 'backups')) {
    New-Item -ItemType Directory -Path (Join-Path $InstallRoot $folder) -Force | Out-Null
}
Write-Utf8File (Join-Path $InstallRoot '.workbench-installation') "personal-workbench-v1`r`n"
$envPath = Join-Path $InstallRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    $dataPath = (Join-Path $InstallRoot 'data').Replace('\', '/')
    Write-Utf8File $envPath "NODE_ENV=production`r`nHOST=127.0.0.1`r`nPORT=4318`r`nAPP_ORIGIN=http://127.0.0.1:4318`r`nDATA_DIR=`"$dataPath`"`r`nSETUP_TOKEN=$token`r`n"
}
$releaseDir = Join-Path $InstallRoot ('releases\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $releaseDir | Out-Null
foreach ($entry in @('dist', 'server', 'package.json', 'package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $PackageRoot $entry) -Destination $releaseDir -Recurse
}
foreach ($entry in @('Start-App.ps1', 'Status.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry) -Destination (Join-Path $InstallRoot 'scripts') -Force
}
$configPath = Join-Path $InstallRoot 'deployment.json'
$oldConfig = $null
if (Test-Path -LiteralPath $configPath) { $oldConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
$nodePath = if ($oldConfig) { $oldConfig.nodePath } else { $null }
if (-not $PrepareOnly) {
    # Restrict application settings, data and logs to SYSTEM, Administrators and the deploying user.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sidText in @('S-1-5-18', 'S-1-5-32-544', $identity.User.Value)) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $InstallRoot -AclObject $acl
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) {
        $bundled = Join-Path $PackageRoot 'runtime\node'
        if (Test-Path -LiteralPath (Join-Path $bundled 'node.exe')) {
            Copy-Item -LiteralPath $bundled -Destination (Join-Path $InstallRoot 'runtime') -Recurse -Force
            $nodePath = Join-Path $InstallRoot 'runtime\node\node.exe'
        } else {
            $nodeReleases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
            $release = $nodeReleases | Where-Object { $_.version -match '^v24\.' -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
            if (-not $release) { throw 'No Node.js 24 Windows x64 release found.' }
            $version = $release.version
            $filename = "node-$version-win-x64.zip"
            $download = Join-Path $InstallRoot "runtime\$filename"
            $checksumText = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt").Content
            $line = @($checksumText -split "`n" | Where-Object { $_.Trim().EndsWith('  ' + $filename) })
            if ($line.Count -ne 1) { throw 'Node.js official checksum missing.' }
            Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/$filename" -OutFile $download
            if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne ($line[0] -split '\s+')[0]) { throw 'Node.js checksum mismatch.' }
            Expand-Archive -LiteralPath $download -DestinationPath (Join-Path $InstallRoot 'runtime') -Force
            $nodePath = Join-Path $InstallRoot "runtime\node-$version-win-x64\node.exe"
        }
    }
    $runtimeVersion = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or $runtimeVersion -notmatch '^v24\.') { throw 'Node.js 24 is required.' }
    $env:PATH = [IO.Path]::GetDirectoryName($nodePath) + ';' + $env:PATH
    if (Test-Path -LiteralPath (Join-Path $PackageRoot 'node_modules')) {
        Copy-Item -LiteralPath (Join-Path $PackageRoot 'node_modules') -Destination $releaseDir -Recurse
    } else {
        Push-Location $releaseDir
        try {
            & (Join-Path ([IO.Path]::GetDirectoryName($nodePath)) 'npm.cmd') ci --omit=dev --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
        } finally { Pop-Location }
    }
    $existingTask = Get-ScheduledTask -TaskName 'PersonalWorkbench-App' -ErrorAction SilentlyContinue
    if ($existingTask) {
        $expectedRunner = Join-Path $InstallRoot 'scripts\Start-App.ps1'
        if (@($existingTask.Actions | Where-Object { $_.Arguments -like ('*"' + $expectedRunner + '"*') }).Count -eq 0) { throw 'Task name belongs to another installation.' }
        Stop-ScheduledTask -TaskName 'PersonalWorkbench-App'
        $deadline = (Get-Date).AddSeconds(30)
        do {
            if ((Get-ScheduledTask -TaskName 'PersonalWorkbench-App').State -ne 'Running') { break }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
        if ((Get-ScheduledTask -TaskName 'PersonalWorkbench-App').State -eq 'Running') { throw 'Previous task is still running; active release was preserved.' }
    }
}
Write-Utf8File $configPath (([ordered]@{ appDir=$releaseDir; nodePath=$nodePath; previousAppDir=if ($oldConfig) { $oldConfig.appDir } else { $null }; installedAt=(Get-Date).ToString('o') }) | ConvertTo-Json)
if ($PrepareOnly) { Write-Output 'Files prepared; no software downloads or system tasks were started.'; return }
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $psExe -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot 'scripts\Start-App.ps1') + '"') -WorkingDirectory $InstallRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 100 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'PersonalWorkbench-App' -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'PersonalWorkbench-App'
$ready = $false
for ($i=0; $i -lt 30; $i++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4318/health' -TimeoutSec 2
        if ($health.ok -eq $true) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Application health check failed. Inspect scripts\Status.ps1 and logs. No public ports were opened.' }
Write-Output 'Application running on http://127.0.0.1:4318; startup task installed. Public domain/HTTPS is not enabled.'
