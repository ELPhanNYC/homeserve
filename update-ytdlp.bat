@echo off
setlocal

set VENV_PYTHON=C:\Users\EthanPhan\AppData\Local\Python\pythoncore-3.14-64\python.exe
set SERVICE_NAME=HomeServe
set LOG_DIR=C:\Users\EthanPhan\Codebase\homeserve\logs
set LOG_FILE=%LOG_DIR%\ytdlp-update.log

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo. >> "%LOG_FILE%"
echo ==================================================== >> "%LOG_FILE%"
echo Update run started: %date% %time% >> "%LOG_FILE%"
echo ==================================================== >> "%LOG_FILE%"

"%VENV_PYTHON%" -m pip install -U yt-dlp >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] pip install failed with exit code %ERRORLEVEL% >> "%LOG_FILE%"
    exit /b %ERRORLEVEL%
)

echo yt-dlp updated successfully. Restarting service... >> "%LOG_FILE%"

nssm restart %SERVICE_NAME% >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Service restart failed with exit code %ERRORLEVEL% >> "%LOG_FILE%"
    exit /b %ERRORLEVEL%
)

echo Service restarted successfully. >> "%LOG_FILE%"
echo Update run finished: %date% %time% >> "%LOG_FILE%"

endlocal
