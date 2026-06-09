#!/bin/bash
echo ""
echo " Adoption Dashboard - API Proxy Launcher"
echo " ========================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Try Python 3
if command -v python3 &>/dev/null; then
    echo " Found Python 3. Starting proxy..."
    python3 "$SCRIPT_DIR/proxy/proxy.py"
    exit 0
fi

if command -v python &>/dev/null && python -c "import sys; exit(0 if sys.version_info[0]==3 else 1)" 2>/dev/null; then
    echo " Found Python 3 (as 'python'). Starting proxy..."
    python "$SCRIPT_DIR/proxy/proxy.py"
    exit 0
fi

# Try Node.js
if command -v node &>/dev/null; then
    echo " Found Node.js. Starting proxy..."
    node "$SCRIPT_DIR/proxy/proxy.js"
    exit 0
fi

# Neither found
echo " ERROR: Python 3 or Node.js is required to use the API feature."
echo ""
echo " Install one of the following:"
echo "   Python 3: https://www.python.org/downloads/"
echo "   Node.js:  https://nodejs.org/"
echo ""
echo " Alternatively, use the 'Upload File' tab to load data manually."
echo ""
read -p " Press Enter to close..."
