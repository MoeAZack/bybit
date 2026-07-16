#!/bin/bash
clear
echo "=========================================================="
echo "          MoebyBridge Automation & Deployer Bootstrapper"
echo "=========================================================="
echo ""

# Check if python3 is installed
if ! command -v python3 &> /dev/null
then
    echo "[❌] Error: Python 3 is required but was not found."
    echo "Please install python3 using your package manager."
    echo ""
    exit 1
fi

# Install dependencies if needed
echo "[*] Ensuring python dependencies are installed..."
python3 -m pip install --upgrade pip
python3 -m pip install flask flask-cors requests

echo ""
echo "[*] Dependencies verified. Starting MoebyAutomator..."
echo "=========================================================="
echo ""
python3 MoebyAutomator.py
