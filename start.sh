#!/bin/bash
# Chat2API Docker WebUI - Quick Start Script (Linux)
# Fixed version with Unix line endings

echo ""
echo "========================================"
echo "  Chat2API Docker WebUI - Quick Start"
echo "========================================"
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || { echo "[ERROR] Cannot change to directory"; exit 1; }

echo "[INFO] Working directory: $(pwd)"
echo ""

# Check Docker
if ! docker ps &>/dev/null; then
    echo "[ERROR] Docker is not running!"
    echo "Start Docker with: sudo systemctl start docker"
    exit 1
fi

echo "[✓] Docker is running"
echo ""

# Menu
select option in \
    "Build and start (docker-compose up -d --build)" \
    "Stop and remove (docker-compose down)" \
    "View logs (docker-compose logs -f)" \
    "Rebuild without cache" \
    "Access container shell" \
    "Exit"
do
    case $REPLY in
        1)
            echo ""
            echo "Building and starting..."
            docker-compose up -d --build && \
                echo "[✓] Started! Access: http://localhost:3033" || \
                echo "[✗] Failed"
            ;;
        2)
            docker-compose down
            echo "[✓] Stopped"
            ;;
        3)
            docker-compose logs -f
            ;;
        4)
            docker-compose build --no-cache && \
                echo "[✓] Rebuilt!" || \
                echo "[✗] Failed"
            ;;
        5)
            docker exec -it chat2api sh
            ;;
        6)
            echo "Exiting..."
            break
            ;;
        *)
            echo "[!] Invalid option"
            ;;
    esac
done
