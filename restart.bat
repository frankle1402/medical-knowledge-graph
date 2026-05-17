@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem ============================================================
rem  Medical Knowledge Graph - restart.bat
rem  call stop.bat then start.bat. Abort if either fails.
rem ============================================================

cd /d "%~dp0"
echo [restart] step 1/2: stop.bat
call "%~dp0stop.bat"
if errorlevel 1 (
  echo [restart][ERROR] stop.bat failed. aborting.
  endlocal
  exit /b 1
)

rem give the OS a moment to release sockets in TIME_WAIT
ping -n 3 127.0.0.1 >nul

echo [restart] step 2/2: start.bat
call "%~dp0start.bat"
if errorlevel 1 (
  echo [restart][ERROR] start.bat failed.
  endlocal
  exit /b 1
)

echo [restart] done.
endlocal
exit /b 0
