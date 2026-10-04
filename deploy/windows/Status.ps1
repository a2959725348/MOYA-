$ErrorActionPreference = 'Stop'
$installDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$task = Get-ScheduledTask -TaskName 'PersonalWorkbench-App' -ErrorAction SilentlyContinue
if ($task) { $task | Select-Object TaskName, State; Get-ScheduledTaskInfo -TaskName $task.TaskName | Select-Object LastRunTime, LastTaskResult }
try { Invoke-RestMethod -Uri 'http://127.0.0.1:4318/health' -TimeoutSec 5 | ConvertTo-Json -Compress } catch { Write-Output 'Health: unavailable' }
try { Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/auth/status' -TimeoutSec 5 | ConvertTo-Json -Compress } catch { Write-Output 'Account status: unavailable' }
Get-ChildItem -LiteralPath (Join-Path $installDir 'logs') -Filter 'app-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, Length, LastWriteTime
