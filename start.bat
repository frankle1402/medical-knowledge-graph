@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  Medical Knowledge Graph - start.bat
rem  1. check node / npm
rem  2. check node_modules (auto npm install)
rem  3. check backend/.env
rem  4. probe Postgres 5432 / Neo4j 7687  (direct node, NOT npm)
rem  5. ensure ports 3000 / 4000 free
rem  6. launch "npm run dev" in a new window
rem  7. wait for frontend, then open browser
rem ============================================================

cd /d "%~dp0"
echo [start] working dir: %cd%

rem -- 1. node / npm ---------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [start][ERROR] Node.js not found in PATH. Install Node 20+ first.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [start][ERROR] npm not found in PATH.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [start] node %%v
for /f "delims=" %%v in ('npm -v') do echo [start] npm  %%v

rem -- 2. dependencies ------------------------------------------
if not exist "node_modules" (
  echo [start] node_modules missing - running npm install ...
  call npm install
  if errorlevel 1 (
    echo [start][ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [start] node_modules OK
)

rem -- 3. backend/.env ------------------------------------------
if not exist "backend\.env" (
  echo [start][ERROR] backend\.env missing. Copy backend\.env.example first.
  pause
  exit /b 1
)
echo [start] backend\.env OK

rem -- 4. external services (Postgres / Neo4j) ------------------
rem  Call node directly. Going through `npm run check:env` invokes
rem  npm.cmd, which corrupts this script's label table — any later
rem  `call :LABEL` then fails with "batch label not found".
echo [start] probing external services (Postgres 5432 / Neo4j 7687) ...
node "infra\scripts\check-env.mjs"
if errorlevel 1 (
  echo [start][ERROR] external services not reachable. Start Postgres / Neo4j first.
  pause
  exit /b 1
)

rem -- 5. ports 3000 / 4000 must be free ------------------------
rem  Inlined for the same reason: avoid `call :LABEL` after a .cmd call.
for %%P in (3000 4000) do (
  set "_busy="
  for /f "tokens=5" %%i in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do set "_busy=%%i"
  if defined _busy (
    echo [start][ERROR] port %%P is occupied by PID !_busy!. Run stop.bat first.
    pause
    exit /b 1
  )
  echo [start] port %%P free
)

rem -- 6. launch dev in a new window ----------------------------
rem  Quirks dodged here:
rem   * `start "TITLE" "file.bat"` — when the 2nd arg is also quoted,
rem     Windows treats the 1st quoted string as the program path
rem     instead of the window title; the new window never spawns.
rem   * `start "TITLE" cmd /k "a && b"` — the inner `&&` is consumed
rem     by the OUTER cmd parser, so b never runs.
rem   * `cmd /k npm run dev` — npm is a .cmd file; without `call` the
rem     child cmd terminates as soon as npm.cmd returns and the dev
rem     processes die.
rem  Reliable form: empty title + /D for cwd + cmd /k call <one cmd>.
echo [start] launching dev stack in a new window ...
start "MKG dev" /D "%~dp0" cmd /k call npm run dev

rem -- 7. wait for frontend, then open browser ------------------
rem  Use `ping 127.0.0.1` for a quiet 1-second sleep — `timeout /t`
rem  prints "ERROR: Input redirection is not supported" when the
rem  script is launched without an interactive console (e.g. via
rem  Start-Process / scheduled task). ping has no such requirement.
echo [start] waiting for frontend on http://localhost:3000 (up to 60s) ...
set "_ready="
for /l %%i in (1,1,60) do (
  if not defined _ready (
    ping -n 2 127.0.0.1 >nul
    netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
    if not errorlevel 1 set "_ready=1"
  )
)
if defined _ready (
  echo [start] frontend ready, opening browser ...
  start "" "http://localhost:3000"
) else (
  echo [start][warn] frontend not ready after 60s. open http://localhost:3000 manually.
)

echo [start] done. backend: http://localhost:4000   frontend: http://localhost:3000
echo [start] use stop.bat to shut down.
endlocal
exit /b 0
