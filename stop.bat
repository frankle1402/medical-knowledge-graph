@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  Medical Knowledge Graph - stop.bat
rem  1. scan ports 3000 / 4000 / 9229 / 9230  (project-owned only)
rem  2. for each PID found, walk its descendants and kill the tree
rem  3. close any cmd window with title "MKG dev"
rem  4. report what got killed
rem
rem  Safety: we ONLY kill processes that hold the ports listed
rem  above and their descendants. We never kill node.exe by name.
rem ============================================================

cd /d "%~dp0"
echo [stop] working dir: %cd%

set "PORTS=3000 4000 9229 9230"
set "ROOT_PIDS="

rem -- 1. find listeners on project ports (inlined, no :LABEL) --
for %%P in (%PORTS%) do (
  for /f "tokens=5" %%i in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    echo [stop] port %%P is held by PID %%i
    echo  !ROOT_PIDS! | findstr /C:" %%i " >nul
    if errorlevel 1 set "ROOT_PIDS=!ROOT_PIDS! %%i"
  )
)

if not defined ROOT_PIDS (
  echo [stop] no project port is in use. nothing to kill.
  goto :CloseWindow
)

echo [stop] root PIDs to terminate:!ROOT_PIDS!

rem -- 2. kill each root PID + its child tree --------------------
for %%I in (!ROOT_PIDS!) do (
  echo [stop] killing tree of PID %%I ...
  taskkill /F /T /PID %%I >nul 2>&1
  if errorlevel 1 (
    echo [stop][warn] taskkill failed for PID %%I  ^(may already be gone^)
  ) else (
    echo [stop] PID %%I tree killed
  )
)

rem -- 3. wait briefly + verify ----------------------------------
ping -n 3 127.0.0.1 >nul

set "STILL_BUSY="
for %%P in (%PORTS%) do (
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    set "STILL_BUSY=!STILL_BUSY! %%P:%%p"
  )
)
if defined STILL_BUSY (
  echo [stop][ERROR] some ports are still in use:!STILL_BUSY!
  echo [stop] you may need Task Manager to clean up manually.
  goto :CloseWindow
)
echo [stop] all project ports are free.

:CloseWindow
rem -- 4. close the "MKG dev" launcher window if start.bat opened it
taskkill /F /FI "WINDOWTITLE eq MKG dev*" >nul 2>&1

echo [stop] done.
endlocal
exit /b 0
