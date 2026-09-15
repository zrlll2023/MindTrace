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

echo [2/2] 启动 MindTrace 窗口（首次会自动编译，约 20~40 秒，窗口出现前请不要关闭本窗口）...
start "MindTrace App" /min cmd /c "pnpm dev"

echo.
echo 等待 MindTrace 窗口出现（最多 60 秒）...
set /a waited=0
:waitloop
timeout /t 3 /nobreak >nul
set /a waited+=3
tasklist /fi "imagename eq electron.exe" 2>nul | find /i "electron.exe" >nul
if not errorlevel 1 goto :bringfront
if %waited% geq 60 goto :timeoutwarn
goto :waitloop

:bringfront
powershell -NoProfile -Command "$p=Get-Process electron -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1; if($p){Add-Type -Namespace W -Name N -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h,int c);' -ErrorAction SilentlyContinue; [W.N]::ShowWindow($p.MainWindowHandle,9) | Out-Null; [W.N]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Write-Host ('窗口已就绪并置于前台: ' + $p.MainWindowTitle)} else {Write-Host '进程已在但窗口未就绪，请稍候片刻'}"
echo.
echo 本窗口可以关闭了。MindTrace 窗口与 Mock AI 窗口请自行保留/关闭。
timeout /t 8 >nul
exit /b 0

:timeoutwarn
echo [提示] 60 秒内未检测到应用进程。请检查上方或最小化的 "MindTrace App" 窗口中的错误信息。
pause
exit /b 1
