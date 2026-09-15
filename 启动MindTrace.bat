@echo off
chcp 65001 >nul
title MindTrace Launcher
cd /d "%~dp0"

echo ============================================
echo   MindTrace - 一键启动（开发模式 + Mock AI）
echo ============================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 pnpm。请先安装 Node.js 18+ 和 pnpm。
  pause
  exit /b 1
)

echo [1/2] 启动 Mock AI 服务器（端口 8787，替代 API Key）...
start "MindTrace Mock LLM" /min cmd /c "pnpm mock"

echo [2/2] 启动 MindTrace 窗口（首次会自动编译，约 20~40 秒）...
pnpm dev

echo.
echo 应用已退出。Mock 服务器如仍在运行可直接关闭其窗口。
pause
