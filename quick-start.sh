#!/bin/bash
# Chat2API Docker WebUI - Quick Start Script (Linux/Mac)

echo ""
echo "========================================"
echo "  Chat2API Docker WebUI - Quick Start"
echo "========================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo "[INFO] Current directory: $(pwd)"
echo ""

# Check if Docker is running
if ! docker ps > /dev/null 2>&1; then
    echo "[ERROR] Docker is not running. Please start Docker first."
    echo "Ubuntu/Debian: sudo systemctl start docker"
    echo "CentOS/RHEL: sudo systemctl start docker"
    echo "MacOS: Open Docker Desktop"
    exit 1
fi

echo "[INFO] Docker is running ✓"
echo ""

# Display menu
echo "Select an option:"
echo "  1. Build and start (docker-compose up -d --build)"
echo "  2. Stop and remove containers (docker-compose down)"
echo "  3. View logs (docker-compose logs -f)"
echo "  4. Rebuild without cache (docker-compose build --no-cache)"
echo "  5. Access container shell (sh)"
echo ""
read -p "Enter your choice (1-5): " choice

case $choice in
    1)
        echo ""
        echo "[INFO] Building and starting container..."
        docker compose up -d --build
        if [ $? -eq 0 ]; then
            echo ""
            echo "[SUCCESS] Container started successfully! ✓"
            echo "Access the application at: http://localhost:3033"
            echo ""
            echo "View logs with: docker compose logs -f"
        else
            echo "[ERROR] Failed to build/start container."
            exit 1
        fi
        ;;
    2)
        echo ""
        echo "[INFO] Stopping and removing containers..."
        docker compose down
        echo ""
        echo "[SUCCESS] Containers stopped and removed. ✓"
        ;;
    3)
        echo ""
        echo "[INFO] Viewing logs (press Ctrl+C to exit)..."
        docker compose logs -f
        ;;
    4)
        echo ""
        echo "[INFO] Rebuilding without cache..."
        docker compose build --no-cache
        if [ $? -eq 0 ]; then
            echo ""
            echo "[SUCCESS] Build completed! ✓"
            echo "Now run: docker compose up -d"
        else
            echo "[ERROR] Failed to build."
            exit 1
        fi
        ;;
    5)
        echo ""
        echo "[INFO] Accessing container shell..."
        docker exec -it chat2api sh
        ;;
    *)
        echo "[ERROR] Invalid choice."
        exit 1
        ;;
esac

echo ""
exit 0
