# Jimeng API

[中文文档](README.CN.md)

Free AI image/video generation service with OpenAI-style endpoints, built from Jimeng (CN) and Dreamina (global) reverse engineering.

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-Group-blue.svg?logo=telegram)](https://t.me/jimeng_api)

## Risk Notice

- Research and personal-use project only.
- Do not abuse upstream services; account bans or legal risk may apply.
- No donations or paid usage support.

## Quick Start

### Option A: Docker (recommended)

```bash
docker run -d \
  --name jimeng-api \
  -p 5100:5100 \
  --restart unless-stopped \
  ghcr.io/iptag/jimeng-api:latest
```

Check service:

```bash
curl http://127.0.0.1:5100/ping
```

### Option B: Local run

```bash
git clone <repository-url>
cd jimeng-api
npm install
npm run build
npm run dev
```

Defaults:

- Host: `0.0.0.0`
- Port: `5100`

## Token and Region Model

### Get token

Use browser session token from Jimeng or Dreamina:

![](https://github.com/iptag/jimeng-api/blob/main/get_sessionid.png)

### Current region rules (important)

- Region-prefixed tokens are deprecated and rejected (for example `us-xxx`).
- Use plain token in `Authorization: Bearer <token>`.
- Specify region by:
  - `X-Region: cn|us|hk|jp|sg`, or
  - `region` on token-pool entries.

If you call APIs without `Authorization`, the server will pick from token pool.

## API Overview

Base URL: `http://127.0.0.1:5100`

Core endpoints:

- `POST /v1/images/generations`
- `POST /v1/images/compositions`
- `POST /v1/videos/generations`
- `GET /v1/models`
- `GET /token/pool`

### 1) Text-to-image

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

### 2) Image-to-image (JSON with URL inputs)

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

Notes:

- `images` supports `1-10` items.
- `multipart/form-data` upload is also supported for local image files.
- `size`, `width`, `height` are not supported; use `ratio` + `resolution`.

### 3) Video generation (basic)

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

Modes are controlled by payload and files (`first_last_frames`, `omni_reference`, etc.). For repeatable usage, prefer CLI examples below.

## CLI Quick Usage (`jimeng`)

After `npm run build`, use:

```bash
jimeng --help
```

### Models

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

### Image

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

### Video

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

## Token Pool Quick Usage

Example file: `configs/token-pool.example.json`

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

Common endpoints:

```bash
# list masked pool entries
curl http://127.0.0.1:5100/token/pool

# add token(s)
curl -X POST http://127.0.0.1:5100/token/pool/add \
  -H "Content-Type: application/json" \
  -d '{"tokens":[{"token":"YOUR_TOKEN","region":"us"}]}'

# run health check
curl -X POST http://127.0.0.1:5100/token/pool/check
```

## MCP Quick Start (`jimeng-mcp`)

Build and run MCP server:

```bash
npm run build
jimeng-mcp
```

Useful env vars:

- `JIMENG_API_BASE_URL` (default `http://127.0.0.1:5100`)
- `JIMENG_API_TOKEN` (optional default bearer token)
- `MCP_HTTP_TIMEOUT_MS` (default `120000`)
- `MCP_ENABLE_ADVANCED_TOOLS` (default `true`)
- `MCP_REQUIRE_RUN_CONFIRM` (default `true`)

## Troubleshooting

- `X-Region invalid`: only `cn/us/hk/jp/sg` are accepted.
- `missing region`: set `X-Region`, or configure `region` in token pool.
- `prefixed_token_not_supported`: remove `us-/hk-/jp-/sg-` token prefixes.
- `Authorization format invalid`: use `Authorization: Bearer <token>`.
- Image size errors: use `ratio` + `resolution` instead of `size/width/height`.

## Community

[Telegram](https://t.me/jimeng_api)

## License

GPL-3.0

## Disclaimer

This project is for research and learning only. You are responsible for compliant usage in your jurisdiction.
