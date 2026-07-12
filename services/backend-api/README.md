## GEDO.AI Backend API（本地可运行版）

本服务用于前后端分离部署：提供鉴权、记忆、规划、执行与生命之树快照等 API。

### 启动

```bash
cd services/backend-api
node src/server.mjs
```

默认监听：`http://localhost:8787`

### 环境变量

- `PORT`：端口，默认 `8787`
- `JWT_SECRET`：JWT 签名密钥（本地可随便填，但不要提交真实密钥）
- `CORS_ORIGIN`：允许的 Origin（本地建议 `http://localhost:3000`）

### OpenAPI

见 `openapi.yaml`