# Chat2API - WebUI Docker 版本 🚀 (Linux/Mac/Windows)

这是一个将 **Chat2API** Electron 桌面应用转换为 WebUI 并通过 Docker 部署的版本。

**平台支持:** Linux, macOS, Windows (Docker Desktop)

## ✨ 主要变更

1. **WebUI 支持**: 基于原有的 `src/server/index.ts`，移除了 Electron 和 koa 依赖
2. **Docker 化**: 使用 `node:20-alpine` 作为基础镜像 (Alpine Linux)
3. **端口配置**: 
   - 容器内部端口：Web UI：**3000** + API：**8080**
4. **Linux 优化**: 多阶段构建，减小镜像体积

## 📁 新增/修改文件

- ✅ `Dockerfile` - Docker 构建配置
- ✅ `docker-compose.yml` - Docker Compose 编排文件
- ✅ `.dockerignore` - Docker 构建忽略文件
- ✅ 修改 `package.json`:
  - 添加 `"type": "module"`
  - 添加 `tsx` 依赖（TypeScript 执行器）
  - 添加 `start:server` 和 `docker:start` 脚本
- ✅ 修改 `src/server/index.ts`:
  - 默认 Web 端口改为 8080

## 🚀 快速开始

### 方法一：使用 docker-compose（推荐）

#### Linux/macOS:
```bash
# 进入项目目录
cd /path/to/Chat2API-main

# 设置脚本可执行权限
chmod +x quick-start.sh

# 运行脚本或手动执行
./quick-start.sh
# 或者直接运行
docker-compose up -d --build
```

#### Windows (PowerShell):
```powershell
cd C:\Users\admin\Downloads\Chat2API-main
docker-compose up -d --build
```

### 方法二：手动构建和运行

#### Linux/macOS:
```bash
# 构建镜像
docker build -t chat2api .

# 运行容器
docker run -d \
  --name chat2api \
  -p 3000:3080 \
  -p 8080:8080 \
  -v $(pwd)/data:/root/.chat2api \
  -e MANAGEMENT_API_SECRET=your-secret-key \
  chat2api
```

#### Windows PowerShell:
```powershell
docker build -t chat2api .
docker run -d `
  --name chat2api `
  -p 3000:3080`
  -p 8080:8080`
  -v ${PWD}/data:/root/.chat2api `
  -e MANAGEMENT_API_SECRET=your-secret-key `
  chat2api
```

## 🌐 访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| Web UI | http://localhost:3000 | 管理界面 |
| API | http://localhost:8080/v1 | OpenAI 兼容接口 |
| Management API | http://localhost:8080/v0/management | 管理接口 |
| Health Check | http://localhost:8080/health | 健康检查 |

## 🔧 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| WEB_PORT | 3000 | Web 服务端口 |
| PROXY_PORT | 8080 | 代理 API 端口 |
| WEB_HOST | 127.0.0.1 | 绑定地址 |
| MANAGEMENT_API_SECRET | 自动生成 | 管理 API 密钥 |
| NODE_ENV | production | Node 环境 |

## 📦 数据持久化

数据存储在 `项目目录/data` 目录中，建议挂载到宿主机：

```yaml
volumes:
  - /app/data:项目目录/data
```

包含的数据：
- `config.json` - 应用配置
- `providers.json` - 服务商设置
- `accounts.json` - 账户凭证（加密）
- `logs/` - 请求日志

## 🔐 安全建议

1. **务必修改默认后台密码**
2. **定期备份**: 将 `项目目录/data` 目录定期备份
3. **公网访问**: 使用反向代理（Nginx）+ HTTPS

## 🛠️ 技术栈

- **基础镜像**: node:20-alpine
- **运行时**: Node.js 20 + tsx
- **Web 框架**: nodejs
- **前端**: React 18 + TypeScript + Tailwind CSS
- **状态管理**: Zustand

## 📝 常用命令

### Linux/macOS:
```bash
# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 重新构建
docker-compose build --no-cache

# 进入容器
docker exec -it chat2api sh

# 查看资源占用
docker stats chat2api

# 查看进程
docker ps -a | grep chat2api
```

### Windows (PowerShell):
```powershell
# 停止服务
docker-compose down

# 进入容器
docker exec -it chat2api sh
```

## 📄 License

GPL-3.0 License - 与原项目保持一致

---

**Enjoy using Chat2API WebUI! 🎉**
