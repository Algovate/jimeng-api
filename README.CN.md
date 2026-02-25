# Jimeng API

[English](README.md)

基于即梦（CN）和 Dreamina（国际）逆向实现的免费 AI 图像/视频生成服务，提供 OpenAI 风格接口。

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-支持-blue.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-群组-blue.svg?logo=telegram)](https://t.me/jimeng_api)

## 风险说明

- 仅用于研究和个人使用。
- 请勿滥用上游服务，否则可能导致封号或法律风险。
- 不接受捐赠或付费支持。

## 快速开始

### 方式 A：Docker（推荐）

```bash
docker run -d \
  --name jimeng-api \
  -p 5100:5100 \
  --restart unless-stopped \
  ghcr.io/iptag/jimeng-api:latest
```

检查服务：

```bash
curl http://127.0.0.1:5100/ping
```

### 方式 B：本地运行

```bash
git clone <repository-url>
cd jimeng-api
npm install
npm run build
npm run dev
```

默认值：

- Host: `0.0.0.0`
- Port: `5100`

## Token 与 Region 规则

### 获取 token

从即梦或 Dreamina 浏览器会话中获取 token：

![](https://github.com/iptag/jimeng-api/blob/main/get_sessionid.png)

### 当前区域规则（重要）

- 带区域前缀的 token 已废弃并会被拒绝（例如 `us-xxx`）。
- 使用纯 token：`Authorization: Bearer <token>`。
- 区域通过以下任一方式指定：
  - `X-Region: cn|us|hk|jp|sg`，或
  - token-pool 条目中的 `region` 字段。

如果请求不带 `Authorization`，服务会从 token pool 自动选择 token。

## API 概览

Base URL: `http://127.0.0.1:5100`

核心端点：

- `POST /v1/images/generations`
- `POST /v1/images/compositions`
- `POST /v1/videos/generations`
- `GET /v1/models`
- `GET /token/pool`

### 1) 文生图

```bash
curl -X POST http://127.0.0.1:5100/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Region: us" \
  -d '{
    "prompt": "A cinematic futuristic city skyline at night",
    "ratio": "16:9",
    "resolution": "2k"
  }'
```

### 2) 图生图（JSON + URL 输入）

```bash
curl -X POST http://127.0.0.1:5100/v1/images/compositions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Region: us" \
  -d '{
    "prompt": "Keep the subject, add film grain and dramatic lighting",
    "images": ["https://example.com/input.jpg"],
    "ratio": "1:1",
    "resolution": "2k"
  }'
```

说明：

- `images` 支持 `1-10` 项。
- 也支持 `multipart/form-data` 上传本地图片。
- 不支持 `size`、`width`、`height`；请使用 `ratio` + `resolution`。

### 3) 视频生成（基础）

```bash
curl -X POST http://127.0.0.1:5100/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Region: us" \
  -d '{
    "prompt": "A fox runs through snowy forest, cinematic camera movement",
    "ratio": "16:9",
    "resolution": "720p",
    "duration": 5
  }'
```

模式由请求体与文件共同决定（`first_last_frames`、`omni_reference` 等）。为可复现使用，优先参考下方 CLI 示例。

## CLI 快速使用（`jimeng`）

执行 `npm run build` 后：

```bash
jimeng --help
```

### 模型

```bash
jimeng models list
jimeng models list --region us
jimeng models list --verbose
jimeng models list --json
```

### Token

```bash
jimeng token list
jimeng token add --token YOUR_TOKEN --region us
jimeng token check --token YOUR_TOKEN --region us
jimeng token points --region us
jimeng token receive --region us
```

### 图像

```bash
jimeng image generate \
  --region us \
  --prompt "Portrait lighting, realistic details" \
  --ratio "3:4" \
  --resolution "2k"

jimeng image edit \
  --region us \
  --prompt "Enhance texture, keep composition" \
  --image ./input.png
```

### 视频

```bash
# text_to_video
jimeng video generate \
  --mode text_to_video \
  --region us \
  --prompt "Mountain sunrise with drifting clouds"

# image_to_video
jimeng video generate \
  --mode image_to_video \
  --region us \
  --prompt "Slow cinematic push-in" \
  --image-file ./first-frame.png

# first_last_frames
jimeng video generate \
  --mode first_last_frames \
  --region us \
  --prompt "Day to night transition" \
  --image-file ./first.png \
  --image-file ./last.png

# omni_reference
jimeng video generate \
  --mode omni_reference \
  --model jimeng-video-seedance-2.0-fast \
  --region cn \
  --prompt "Use @image_file_1 for character and @video_file_1 for motion" \
  --image-file ./character.png \
  --video-file ./motion.mp4
```

## Token Pool 快速使用

示例文件：`configs/token-pool.example.json`

```json
{
  "updatedAt": 0,
  "tokens": [
    {
      "token": "your_us_token_1",
      "region": "us",
      "enabled": true,
      "allowedModels": ["jimeng-4.5"],
      "capabilityTags": ["omni_reference"]
    }
  ]
}
```

常用端点：

```bash
# 列出脱敏 token pool 条目
curl http://127.0.0.1:5100/token/pool

# 添加 token
curl -X POST http://127.0.0.1:5100/token/pool/add \
  -H "Content-Type: application/json" \
  -d '{"tokens":[{"token":"YOUR_TOKEN","region":"us"}]}'

# 运行健康检查
curl -X POST http://127.0.0.1:5100/token/pool/check
```

## MCP 快速开始（`jimeng-mcp`）

构建并运行 MCP 服务：

```bash
npm run build
jimeng-mcp
```

常用环境变量：

- `JIMENG_API_BASE_URL`（默认 `http://127.0.0.1:5100`）
- `JIMENG_API_TOKEN`（可选，默认 bearer token）
- `MCP_HTTP_TIMEOUT_MS`（默认 `120000`）
- `MCP_ENABLE_ADVANCED_TOOLS`（默认 `true`）
- `MCP_REQUIRE_RUN_CONFIRM`（默认 `true`）

## 故障排查

- `X-Region invalid`：仅支持 `cn/us/hk/jp/sg`。
- `missing region`：设置 `X-Region`，或在 token pool 配置 `region`。
- `prefixed_token_not_supported`：移除 `us-/hk-/jp-/sg-` 前缀。
- `Authorization format invalid`：使用 `Authorization: Bearer <token>`。
- 图像尺寸错误：使用 `ratio` + `resolution`，不要用 `size/width/height`。

## 社区

[Telegram](https://t.me/jimeng_api)

## 许可证

GPL-3.0

## 免责声明

本项目仅用于研究和学习。请自行确保在所在地区合规使用。
