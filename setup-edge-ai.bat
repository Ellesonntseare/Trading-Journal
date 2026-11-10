@echo off
setlocal
where ollama >nul 2>&1
if errorlevel 1 (
  echo Ollama is not installed.
  echo Install Ollama for Windows from https://ollama.com/download/windows
  echo Then run this file again.
  pause
  exit /b 1
)

echo Starting Ollama if it is not already running...
start "EDGE AI Ollama" /min ollama serve >nul 2>&1

timeout /t 3 /nobreak >nul

echo Checking for the free local model qwen2.5:3b...
ollama list | findstr /i "qwen2.5:3b" >nul 2>&1
if errorlevel 1 (
  echo Downloading qwen2.5:3b. This is a one-time download.
  ollama pull qwen2.5:3b
)

echo.
echo EDGE AI is ready. Start the journal with start-journal.bat
pause
