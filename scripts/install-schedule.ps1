# Registra la fábrica en el Programador de tareas: una pasada cada 10 minutos
# mientras la sesión del usuario está iniciada (usa sus logins de claude, codex y gh).
# Quitarla: Unregister-ScheduledTask -TaskName "AI Software Factory" -Confirm:$false
$cmd = Join-Path $PSScriptRoot 'factory-watch.cmd'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable
Register-ScheduledTask -TaskName 'AI Software Factory' -Action $action -Trigger $trigger -Settings $settings -Description 'Procesa los issues con la etiqueta factory' -Force | Out-Null
Write-Host 'Tarea "AI Software Factory" registrada: cada 10 minutos. Log en runs\watch.log'
