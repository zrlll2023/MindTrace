@echo off
setlocal EnableExtensions
chcp 65001 >nul
title MindTrace Launcher
cd /d "%~dp0"

set "PACKAGED_APP=%~dp0release\win-unpacked\MindTrace.exe"

echo ============================================
echo   MindTrace 启动器
echo ============================================
echo.

if exist "%PACKAGED_APP%" goto :start_packaged

rem NVM shims can exist and even return exit code 0 without an active runtime.
node --version <nul 2>&1 | %SystemRoot%\System32\findstr.exe /b /r /c:"v[0-9]" >nul
if errorlevel 1 goto :runtime_unavailable

call pnpm --version <nul >nul 2>nul
if errorlevel 1 goto :runtime_unavailable

echo [1/2] 启动 Mock AI 服务器（端口 8787）...
start "" /b cmd /d /c call pnpm mock

echo [2/2] 启动 MindTrace 开发版...
echo MindTrace 运行期间请保留这个窗口；关闭窗口会同时停止开发服务。
echo.
call pnpm dev
set "DEV_EXIT=%errorlevel%"
if not "%DEV_EXIT%"=="0" (
  echo.
  echo [错误] MindTrace 开发版启动失败，退出码：%DEV_EXIT%
  pause
)
exit /b %DEV_EXIT%

:start_packaged
echo 检测到免安装正式版，正在打开 MindTrace...
start "" "%PACKAGED_APP%"
exit /b 0

:runtime_unavailable
echo [提示] 当前 Node.js/pnpm 运行环境不可用。
echo        Node.js 未安装，或 NVM 没有活动版本，所以无法运行开发模式。
echo.

echo [错误] 未找到可用的免安装正式版。
echo.
echo 如果这是从 GitHub 新克隆的项目，请先安装并启用 Node.js 22.12+，再安装 pnpm：
echo   nvm install 22
echo   nvm use 22
echo   npm install -g pnpm
echo   pnpm install
echo.
pause
exit /b 1
