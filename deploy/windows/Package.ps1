[CmdletBinding()]
param([switch]$Offline, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outputDir = [IO.Path]::GetFullPath((Join-Path $projectDir '..'))
$scratchDir = [IO.Path]::GetFullPath((Join-Path $projectDir '..\..\work'))
$stageDir = Join-Path $scratchDir ('windows-package-' + [Guid]::NewGuid().ToString('N'))
$packageDir = Join-Path $stageDir 'personal-workbench'
New-Item -ItemType Directory -Path (Join-Path $packageDir 'deploy\windows') -Force | Out-Null
Push-Location $projectDir
try {
    if (-not $SkipBuild) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed.' } }
    foreach ($entry in @('dist','server','package.json','package-lock.json')) {
        Copy-Item -LiteralPath (Join-Path $projectDir $entry) -Destination $packageDir -Recurse
    }
    foreach ($entry in @('Install.ps1','Start-App.ps1','Status.ps1','README.md','Caddyfile.example')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry) -Destination (Join-Path $packageDir 'deploy\windows')
    }
    $manifest = [ordered]@{ packagedAt=(Get-Date).ToString('o'); offline=[bool]$Offline; nodeVersion=$null; nodeSha256=$null }
    if ($Offline) {
        Push-Location $packageDir
        try { & npm.cmd ci --omit=dev --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Production dependencies failed.' } } finally { Pop-Location }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $nodeReleases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
        $release = $nodeReleases | Where-Object { $_.version -match '^v24\.' -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
        if (-not $release) { throw 'Node.js release lookup failed.' }
        $version = $release.version
        $filename = "node-$version-win-x64.zip"
        $download = Join-Path $stageDir $filename
        $sums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt").Content
        $line = @($sums -split "`n" | Where-Object { $_.Trim().EndsWith('  ' + $filename) })
        if ($line.Count -ne 1) { throw 'Official checksum missing.' }
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/$filename" -OutFile $download
        $checksum = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash
        if ($checksum -ne ($line[0] -split '\s+')[0]) { throw 'Node.js checksum mismatch.' }
        $expandedDir = Join-Path $stageDir 'runtime-download'
        Expand-Archive -LiteralPath $download -DestinationPath $expandedDir
        New-Item -ItemType Directory -Path (Join-Path $packageDir 'runtime') | Out-Null
        # Exact source and destination are both within this freshly created staging folder.
        Move-Item -LiteralPath (Join-Path $expandedDir "node-$version-win-x64") -Destination (Join-Path $packageDir 'runtime\node')
        $manifest.nodeVersion = $version
        $manifest.nodeSha256 = $checksum
    }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $packageDir 'package-manifest.json'), ($manifest | ConvertTo-Json), $utf8)
    $name = if ($Offline) { 'personal-workbench-windows-offline.zip' } else { 'personal-workbench-windows.zip' }
    $zipPath = Join-Path $outputDir $name
    Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -Force
    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    [IO.File]::WriteAllText(($zipPath + '.sha256'), "$zipHash  $name`r`n", $utf8)
    Write-Output "Package: $zipPath"
    Write-Output "SHA256: $zipHash"
    Write-Output "Staging folder: $packageDir"
} finally { Pop-Location }
