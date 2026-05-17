@echo off
pushd %~dp0..\..
node infra\scripts\check-env.mjs || exit /b 1
npm run dev
popd
