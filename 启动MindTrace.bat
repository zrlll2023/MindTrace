@echo off
setlocal EnableExtensions
chcp 65001 >nul
title MindTrace Launcher
cd /d "%~dp0"

set "PACKAGED_APP=%~dp0release\win-unpacked\MindTrace.exe"
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

echo ============================================
echo   MindTrace 启动器
echo ============================================
echo.

if /i "%~1"=="--packaged" goto :start_packaged
if not exist "%ELECTRON_EXE%" goto :missing_dependencies

rem 使用 Electron 内置的 Node.js，不依赖系统 Node 或 NVM。
set "ELECTRON_RUN_AS_NODE=1"
if /i "%~1"=="--rebuild" goto :build
"%ELECTRON_EXE%" scripts\check-stale.mjs
if errorlevel 1 goto :build

echo [1/2] 当前构建已是最新。
goto :launch

:build
echo [1/2] 检测到源码变化，正在构建最新版本...
"%ELECTRON_EXE%" node_modules\vite\bin\vite.js build
if errorlevel 1 goto :build_failed
"%ELECTRON_EXE%" node_modules\typescript\bin\tsc -p tsconfig.node.json
if errorlevel 1 goto :build_failed

:launch
set "ELECTRON_RUN_AS_NODE="
if /i "%~1"=="--build-only" (
  echo [2/2] 构建检查完成。
  exit /b 0
)
echo [2/2] 正在启动 MindTrace...
start "" "%ELECTRON_EXE%" .
exit /b 0

:start_packaged
if not exist "%PACKAGED_APP%" (
  echo [错误] 未找到免安装版：
  echo   %PACKAGED_APP%
  pause
  exit /b 1
)
echo 正在打开免安装版：
echo   %PACKAGED_APP%
start "" "%PACKAGED_APP%"
exit /b 0

:missing_dependencies
echo [错误] 未找到仓库内的 Electron：
echo   %ELECTRON_EXE%
echo.
echo 请先安装项目依赖后再运行 MindTrace。
pause
exit /b 1

:build_failed
set "ELECTRON_RUN_AS_NODE="
echo.
echo [错误] 构建失败，请查看上方错误信息。
pause
exit /b 1
