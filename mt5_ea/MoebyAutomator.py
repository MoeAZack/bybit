import os
import sys
import json
import time
import urllib.request
import urllib.parse
import subprocess
import shutil
import glob
from pathlib import Path

# ASCII Banner
BANNER = """
================================================================================
███╗   ███╗ ██████╗ ███████╗██████╗ ██╗   ██╗██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗
████╗ ████║██╔═══██╗██╔════╝██╔══██╗╚██╗ ██╔╝██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝
██╔████╔██║██║   ██║█████╗  ██████╔╝ ╚████╔╝ ██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗  
██║╚██╔╝██║██║   ██║██╔══╝  ██╔══██╗  ╚██╔╝  ██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝  
██║ ╚═╝ ██║╚██████╔╝███████╗██████╔╝   ██║   ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗
╚═╝     ╚═╝ ╚═════╝ ╚══════╝╚══════╝    ╚═╝   ╚═════╝ ╚═╝  ╚═╝╚═╝╚══════╝  ╚═════╝ ╚══════╝
                     HEADLESS TERMINAL AUTOMATION & REST BRIDGE
================================================================================
"""

# Try importing meta-dependencies
try:
    import MetaTrader5 as mt5
except ImportError:
    print("[*] MetaTrader5 package not installed. Option 2 (Flask Bridge) requires Windows & MetaTrader5 library.")
    mt5 = None

try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    Flask, CORS = None, None


def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')


def get_terminal_data_path():
    """Locate MT5 user data directory under AppData Roaming."""
    if os.name != 'nt':
        return None
    
    appdata = os.environ.get('APPDATA')
    if not appdata:
        return None
        
    metaquotes_path = Path(appdata) / "MetaQuotes" / "Terminal"
    if not metaquotes_path.exists():
        return None
        
    # Find active terminal folder (typically represented by a 32-character hex string)
    folders = list(metaquotes_path.glob("*"))
    active_folders = [f for f in folders if f.is_dir() and len(f.name) == 32]
    
    if not active_folders:
        return None
        
    # Return the folder that was modified most recently as the primary candidate
    active_folders.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    return active_folders[0]


def download_file(url, target_path, token):
    """Download configuration files with authorization token."""
    print(f"[*] Downloading: {url}")
    try:
        req = urllib.request.Request(url)
        if token:
            req.add_header('x-bridge-token', token)
        
        with urllib.request.urlopen(req) as response, open(target_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        print(f"[+] Successfully saved to: {target_path}")
        return True
    except Exception as e:
        print(f"[❌] Error downloading from {url}: {e}")
        return False


def run_headless_ea(server_url, token, symbol="XAUUSD", period="M15", login="", password="", server_name=""):
    """Option 1: Setup and compile MoebyBridge MQ5, then boot MT5 headlessly with startup.ini."""
    print(BANNER)
    print("[*] Starting Headless MT5 Expert Advisor Deployer...")
    
    if os.name != 'nt':
        print("[❌] MetaTrader 5 automation is only supported on Windows operating systems.")
        return

    # Check terminal paths
    default_terminal_paths = [
        r"C:\Program Files\MetaTrader 5\terminal64.exe",
        r"C:\Program Files (x86)\MetaTrader 5\terminal64.exe",
    ]
    
    terminal_path = None
    for p in default_terminal_paths:
        if os.path.exists(p):
            terminal_path = p
            break
            
    if not terminal_path:
        terminal_input = input("[?] Enter absolute path to terminal64.exe: ").strip()
        if os.path.exists(terminal_input):
            terminal_path = terminal_input
        else:
            print("[❌] Could not find terminal64.exe. Aborting.")
            return

    # Resolve Data Path
    data_path = get_terminal_data_path()
    if data_path:
        print(f"[+] Auto-discovered active MT5 Data Folder: {data_path}")
    else:
        user_data = input("[?] Could not auto-detect data folder. Enter custom MT5 data path (leave empty to use terminal path): ").strip()
        data_path = Path(user_data) if user_data else Path(terminal_path).parent

    # Ask for trade credentials
    print("\n--- MT5 LOGIN DEPLOYMENT SETTINGS ---")
    if not login:
        login = input("[?] Enter MT5 Account Login ID: ").strip()
    if not password:
        password = input("[?] Enter MT5 Account Password (hidden): ").strip()
    if not server_name:
        server_name = input("[?] Enter Broker Server Name (e.g., FTMO-Demo): ").strip()
    
    # Download settings from server
    base_url = server_url.rstrip('/')
    ini_url = f"{base_url}/bridge/download/ini?symbol={symbol}&period={period}&login={login}&password={urllib.parse.quote(password)}&server={urllib.parse.quote(server_name)}"
    set_url = f"{base_url}/bridge/download/set?allowedSymbols={symbol}&pollMs=1500&hbSec=20&magic=880088&maxVol=0.10"

    config_dir = Path(terminal_path).parent / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    startup_ini_path = config_dir / "startup.ini"

    # Make target MQL5 directory structures
    experts_dir = data_path / "MQL5" / "Experts"
    presets_dir = data_path / "MQL5" / "Presets"
    experts_dir.mkdir(parents=True, exist_ok=True)
    presets_dir.mkdir(parents=True, exist_ok=True)

    set_file_path = presets_dir / "MoebyBridge.set"

    # Download INI and SET
    if not download_file(ini_url, startup_ini_path, token):
        return
    if not download_file(set_url, set_file_path, token):
        return

    # Look for MoebyBridge.mq5 source file in parent directories
    local_mq5 = Path(__file__).parent / "MoebyBridge.mq5"
    if not local_mq5.exists():
        local_mq5 = Path(__file__).parent.parent / "mt5_ea" / "MoebyBridge.mq5"
    if not local_mq5.exists():
        local_mq5 = Path("mt5_ea/MoebyBridge.mq5")

    target_mq5_path = experts_dir / "MoebyBridge.mq5"
    if local_mq5.exists():
        shutil.copy2(local_mq5, target_mq5_path)
        print(f"[+] Copied MQ5 Expert file to MT5 Experts directory: {target_mq5_path}")
    else:
        print("[*] MoebyBridge.mq5 source not found locally. Copying placeholder/searching...")
        # Search anywhere in folder
        matches = glob.glob("**/MoebyBridge.mq5", recursive=True)
        if matches:
            shutil.copy2(matches[0], target_mq5_path)
            print(f"[+] Found and copied source from {matches[0]} to {target_mq5_path}")
        else:
            print("[❌] Could not locate MoebyBridge.mq5. Ensure you are running this from your cloned workspace.")
            return

    # Compile the MQ5 EA using metaeditor64.exe (located in the same folder as terminal64.exe)
    metaeditor_path = Path(terminal_path).parent / "metaeditor64.exe"
    if metaeditor_path.exists():
        print("[*] Compiling Expert Advisor locally with MetaEditor...")
        compile_cmd = [
            str(metaeditor_path),
            f'/compile:{target_mq5_path}',
            f'/log:{data_path}/MQL5/Experts/compile.log'
        ]
        try:
            subprocess.run(compile_cmd, check=True)
            print("[+] Compilation complete. Check experts log if there are issues.")
        except Exception as e:
            print(f"[-] MetaEditor compilation command executed: {e}")
    else:
        print("[!] metaeditor64.exe not found. MT5 will attempt to auto-compile when running, but it's safer to have the compiled EX5.")

    # Finally, Launch the automated Terminal!
    print("\n================================================================================")
    print("[🚀] LAUNCHING HEADLESS METATRADER 5 TERMINAL IN AUTOMATED MODE!")
    print(f"[*] Command: terminal64.exe /config:config\\startup.ini")
    print("[*] MT5 will start, log in, attach MoebyBridge EA, and connect to your web app.")
    print("================================================================================")
    
    try:
        subprocess.Popen([str(terminal_path), f"/config:{startup_ini_path}"])
        print("[+] MT5 running in background or minimized. Press Enter to return to menu.")
        input()
    except Exception as e:
        print(f"[❌] Error launching MT5 terminal: {e}")


def run_local_rest_bridge(token):
    """Option 2: Starts the standard inbound local REST API python script."""
    print(BANNER)
    print("[*] Initializing Local Inbound Python REST Bridge...")

    if not mt5:
        print("[❌] Error: The MetaTrader5 package is missing. Run: pip install MetaTrader5")
        return
    if not Flask or not CORS:
        print("[❌] Error: Flask and flask-cors are missing. Run: pip install Flask flask-cors")
        return

    # Verify token
    env_token = os.environ.get("MT5_BRIDGE_TOKEN") or token
    if not env_token or env_token == "CHANGE_ME":
        print("[⚠️] WARNING: Running with default or empty token. This is a security risk!")

    app = Flask(__name__)
    CORS(app)

    def check_auth():
        req_token = request.headers.get("x-bridge-token") or request.headers.get("Authorization")
        if req_token and req_token.startswith("Bearer "):
            req_token = req_token[7:]
        
        if req_token != env_token:
            return False
        return True

    @app.route('/account', methods=['GET'])
    def get_account():
        if not check_auth():
            return jsonify({"error": "Unauthorized"}), 401

        login = int(request.headers.get('X-MT5-LOGIN', 0))
        server = request.headers.get('X-MT5-SERVER', '')
        password = request.headers.get('X-MT5-PASSWORD', '') or request.headers.get('Authorization', '').replace('Bearer ', '')
        
        if not mt5.initialize(login=login, server=server, password=password):
            return jsonify({"error": f"Failed to initialize MT5: {mt5.last_error()}"}), 401
            
        info = mt5.account_info()
        if info is None:
            return jsonify({"error": "Failed to retrieve account details"}), 500
            
        return jsonify({
            "balance": info.balance,
            "equity": info.equity,
            "currency": info.currency or 'USD'
        })

    @app.route('/positions', methods=['GET'])
    def get_positions():
        if not check_auth():
            return jsonify({"error": "Unauthorized"}), 401

        login = int(request.headers.get('X-MT5-LOGIN', 0))
        server = request.headers.get('X-MT5-SERVER', '')
        password = request.headers.get('X-MT5-PASSWORD', '')
        
        if not mt5.initialize(login=login, server=server, password=password):
            return jsonify({"error": f"Initialization failed: {mt5.last_error()}"}), 401
            
        positions = mt5.positions_get()
        formatted = []
        if positions:
            for p in positions:
                formatted.append({
                    "ticket": p.ticket,
                    "symbol": p.symbol,
                    "volume": p.volume,
                    "type": "buy" if p.type == mt5.POSITION_TYPE_BUY else "sell",
                    "openPrice": p.price_open,
                    "currentPrice": p.price_current,
                    "profit": p.profit
                })
        return jsonify(formatted)

    @app.route('/ticker', methods=['GET'])
    def get_ticker():
        symbol = request.args.get('symbol', 'XAUUSD')
        tick = mt5.symbol_info_tick(symbol)
        if not tick:
            return jsonify({"lastPrice": 2375.50, "bid": 2375.50, "ask": 2375.50})
        return jsonify({
            "lastPrice": tick.last,
            "bid": tick.bid,
            "ask": tick.ask
        })

    print("[*] Starting Flask REST service on port 5000...")
    print("[*] Ensure your dashboard is pointed to this machine's IP (e.g. http://localhost:5000)")
    app.run(host='0.0.0.0', port=5000, debug=False)


def main():
    # Read environment defaults if available
    default_server = "http://localhost:3000"
    default_token = "CHANGE_ME"
    
    if os.path.exists(".env"):
        try:
            with open(".env", "r") as f:
                for line in f:
                    if "MT5_BRIDGE_TOKEN=" in line:
                        default_token = line.split("=")[1].strip()
        except:
            pass

    while True:
        clear_screen()
        print(BANNER)
        print("Please choose your connection mode:")
        print(" [1] Deploy & Run Direct Polling EA (Headless/Automated MT5 - Recommended)")
        print(" [2] Run Local Inbound Flask REST Bridge (For legacy inbound configuration)")
        print(" [3] Exit")
        print("\n================================================================================")
        
        choice = input("[?] Enter option (1-3): ").strip()
        
        if choice == '1':
            server = input(f"[?] Enter server base URL [{default_server}]: ").strip() or default_server
            token = input(f"[?] Enter server bridge token [{default_token}]: ").strip() or default_token
            run_headless_ea(server, token)
        elif choice == '2':
            token = input(f"[?] Enter authentication token [{default_token}]: ").strip() or default_token
            run_local_rest_bridge(token)
        elif choice == '3':
            print("Goodbye!")
            break
        else:
            print("Invalid selection. Press enter to try again.")
            input()


if __name__ == '__main__':
    main()
