$ErrorActionPreference = 'Stop'
$installDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$config = Get-Content -LiteralPath (Join-Path $installDir 'deployment.json') -Raw | ConvertFrom-Json
if (-not $config.nodePath -or -not (Test-Path -LiteralPath $config.nodePath)) { throw 'Node runtime missing; run Install.ps1 without PrepareOnly.' }
Set-Location -LiteralPath $installDir
$env:PATH = [IO.Path]::GetDirectoryName($config.nodePath) + ';' + $env:PATH
# Wait for Node directly so Task Scheduler tracks the actual application lifetime.
$log = Join-Path $installDir ('logs\app-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
& $config.nodePath (Join-Path $config.appDir 'server\index.mjs') *>> $log
$code = $LASTEXITCODE
if ($code -eq 0) { $code = 1 }
exit $code
