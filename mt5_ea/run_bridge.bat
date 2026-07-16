@echo off
title MoebyBridge Automation Utility
cls
echo ==========================================================
echo           MoebyBridge Automation & Deployer Bootstrapper
echo ==========================================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [❌] Error: Python 3.8+ is required but was not found in your PATH.
    echo Please install Python and check the "Add Python to PATH" box.
    echo.
    pause
    exit /b 1
)

:: Install required packages if missing
echo [*] Ensuring python dependencies are installed...
python -m pip install --upgrade pip
python -m pip install MetaTrader5 flask flask-cors requests

echo.
echo [*] Dependencies verified. Starting MoebyAutomator...
echo ==========================================================
echo.
python MoebyAutomator.py

pause
