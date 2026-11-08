@echo off
rem Una pasada de la fabrica sobre todos los issues con la etiqueta "factory".
rem La lanza el Programador de tareas de Windows cada 10 minutos (scripts\install-schedule.ps1).
cd /d "%~dp0.."
if not exist runs mkdir runs
call npm run factory --silent -- watch --once >> runs\watch.log 2>&1
