@echo off
title Adoption Dashboard Proxy
echo.
echo  Adoption Dashboard - API Proxy Launcher
echo  ========================================
echo.

:: Try Python 3 first
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo  Found Python. Starting proxy...
    python "%~dp0proxy\proxy.py"
    goto end
)

py -3 --version >nul 2>&1
if %errorlevel% == 0 (
    echo  Found Python (py launcher). Starting proxy...
    py -3 "%~dp0proxy\proxy.py"
    goto end
)

:: Try Node.js
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo  Found Node.js. Starting proxy...
    node "%~dp0proxy\proxy.js"
    goto end
)

:: Neither found
echo  ERROR: Python 3 or Node.js is required to use the API feature.
echo.
echo  Install one of the following:
echo    Python 3: https://www.python.org/downloads/
echo    Node.js:  https://nodejs.org/
echo.
echo  Alternatively, use the "Upload File" tab to load data manually.
echo.
pause

:end
