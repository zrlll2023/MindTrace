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

rem ---------- 参数处理 ----------
rem --packaged  直接打开已打包的免安装版（可能是旧版）
rem --rebuild   强制重新构建后再启动
if /i "%~1"=="--packaged" goto :want_packaged
if /i "%~1"=="--rebuild" set "STALE=1"

rem ---------- 1. 运行环境 ----------
node --version <nul 2>&1 | %SystemRoot%\System32\findstr.exe /b /r /c:"v[0-9]" >nul
if errorlevel 1 goto :runtime_unavailable

if not exist "%ELECTRON_EXE%" goto :need_install

rem ---------- 2. 源码有更新则重新构建 ----------
if not "%STALE%"=="1" call :check_stale
if "%STALE%"=="1" (
  echo [1/2] 检测到源码更新，正在构建最新版本...
  call :build
  if errorlevel 1 goto :build_failed
) else (
  echo [1/2] 已是最新构建，跳过编译。
)

rem ---------- 3. 从源码启动（永远最新版本）----------
echo [2/2] 正在启动 MindTrace...
echo.
echo 启动器默认从源码构建并运行，因此打开的永远是最新版本。
echo 需要 Mock AI 时另开终端执行：pnpm mock
echo 需要打开打包好的免安装版：启动MindTrace.bat --packaged
echo.
start "" "%ELECTRON_EXE%" .
exit /b 0

rem ============================================================
rem 由 scripts\check-stale.mjs 判断 dist 是否落后于源码
rem 结果写入 STALE：1 = 需要重新构建
rem ============================================================
:check_stale
set "STALE=0"
node scripts\check-stale.mjs
if errorlevel 1 set "STALE=1"
exit /b 0

rem ============================================================
rem 构建：优先 pnpm，pnpm 不可用时直接调本地 node 入口
rem ============================================================
:build
call pnpm --version <nul >nul 2>nul
if errorlevel 1 goto :build_direct
call pnpm build
if errorlevel 1 exit /b 1
exit /b 0

:build_direct
echo       （pnpm 不可用，改用本地 node 入口构建）
node node_modules\vite\bin\vite.js build
if errorlevel 1 exit /b 1
node node_modules\typescript\bin\tsc -p tsconfig.node.json
if errorlevel 1 exit /b 1
exit /b 0

rem ============================================================
rem 分支与错误提示
rem ============================================================
:want_packaged
if exist "%PACKAGED_APP%" goto :start_packaged
echo [错误] 未找到免安装版：%PACKAGED_APP%
echo        请先打包：pnpm dist
echo.
pause
exit /b 1

:start_packaged
echo 正在打开免安装版（注意：可能是旧版本）：
echo   %PACKAGED_APP%
start "" "%PACKAGED_APP%"
exit /b 0

:runtime_unavailable
if exist "%PACKAGED_APP%" (
  echo [提示] Node.js 运行环境不可用，改为打开已打包的免安装版。
  echo        该版本可能不是最新的。
  echo.
  goto :start_packaged
)
echo [提示] 当前 Node.js 运行环境不可用。
echo        Node.js 未安装，或 NVM 没有活动版本。
echo.
echo 如果这是从 GitHub 新克隆的项目，请先安装并启用 Node.js 22.12+，再安装 pnpm：
echo   nvm install 22
echo   nvm use 22
echo   npm install -g pnpm
echo   pnpm install
echo.
pause
exit /b 1

:need_install
echo [错误] 依赖未安装：找不到 node_modules\electron
echo.
echo 请先安装依赖：
echo   pnpm install
echo 若 pnpm 不可用，可改用：
echo   npm install
echo.
pause
exit /b 1

:build_failed
echo.
echo [错误] 构建失败。请查看上面的输出。
echo       也可手动执行 pnpm build 复现问题。
echo.
pause
exit /b 1
