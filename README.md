# Telegram YouTube Downloader Bot

A production-ready Telegram bot that downloads YouTube videos and audio using **yt-dlp** and **FFmpeg**, built with **TypeScript** and **Telegraf**.

## Features

- 📹 Download YouTube videos up to **1080p** with merged audio
- 🎵 Audio-only download as **MP3**
- 🖼️ Video thumbnail and title preview
- ⌨️ Inline keyboard for quality selection (144p–1080p) with **file size estimates**
- 📊 Live progress bar with download states (downloading → merging → uploading)
- 📦 Supports files up to **2GB** via local Bot API server
- ⚡ Download queue with configurable concurrency
- 🔄 Automatic retry on failure (2 retries)
- ⏱ Timeout protection for stuck downloads
- 🧹 Automatic temp file cleanup
- 👥 Multi-user support with per-user download locking
- 🐳 Docker Compose deployment (bot + local Bot API)

---

## Prerequisites

| Dependency | Version | Install |
|------------|---------|---------|
| **Node.js** | ≥ 18 | [nodejs.org](https://nodejs.org) |
| **yt-dlp** | latest | `pip install yt-dlp` or `winget install yt-dlp` |
| **FFmpeg** | latest | `apt install ffmpeg` or `winget install FFmpeg` |
| **Docker** | latest | For deployment |

---

## Local Development

```bash
git clone https://github.com/your-username/tg-yt-downloader.git
cd tg-yt-downloader
npm install
cp .env.example .env   # Edit with your credentials
npm run dev
```

---

## AWS EC2 Deployment

### 1. Launch an EC2 Instance

- **AMI**: Ubuntu 22.04 LTS
- **Instance type**: `t3.medium` (2 vCPU, 4GB RAM) recommended
- **Storage**: 30GB+ gp3 (for temp downloads)
- **Security Group**: Allow SSH (port 22) only — the bot uses outbound connections only

### 2. Connect and Install Dependencies

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker

# Install Docker Compose (if not included)
sudo apt install -y docker-compose-plugin
```

### 3. Deploy the Bot

```bash
# Clone your repo
git clone https://github.com/your-username/tg-yt-downloader.git
cd tg-yt-downloader

# Create .env file
cat > .env << 'EOF'
BOT_TOKEN=your_bot_token_here
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
EOF

# Start everything
docker compose up -d --build

# Check logs
docker compose logs -f
```

### 4. Verify It's Running

```bash
# Check containers
docker compose ps

# Check bot logs
docker compose logs bot --tail 20

# Should see:
# ✅ Local Bot API connected: http://telegram-bot-api:8081
# ✅ Bot is running!
```

### 5. Auto-Start on Reboot

Docker Compose with `restart: unless-stopped` handles this automatically.

### 6. Update the Bot

```bash
cd tg-yt-downloader
git pull
docker compose up -d --build
```

---

## Docker Compose (Recommended)

The `docker-compose.yml` runs both services:

| Service | Description |
|---------|-------------|
| `telegram-bot-api` | Local Telegram Bot API server (enables 2GB uploads) |
| `bot` | The YouTube downloader bot |

```bash
docker compose up -d --build    # Start
docker compose logs -f          # View logs
docker compose down             # Stop
docker compose restart bot      # Restart bot only
```

---

## Project Structure

```
tg-yt-downloader/
├── src/
│   ├── bot.ts                  # Entry point
│   ├── config.ts               # Environment config
│   ├── handlers/
│   │   ├── urlHandler.ts       # YouTube URL processing
│   │   └── qualityHandler.ts   # Download actions
│   ├── services/
│   │   ├── youtubeService.ts   # yt-dlp metadata & formats
│   │   └── downloadService.ts  # Queue, retry, progress
│   └── utils/
│       ├── logger.ts           # Colored logger
│       ├── fileManager.ts      # File helpers
│       └── keyboard.ts         # Inline keyboards
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_TOKEN` | — | Telegram bot token (required) |
| `DOWNLOAD_DIR` | `./downloads` | Temp download directory |
| `MAX_FILE_SIZE_MB` | `2000` | Max upload size in MB |
| `MAX_CONCURRENT_DOWNLOADS` | `3` | Concurrent download limit |
| `DOWNLOAD_TIMEOUT_MS` | `600000` | Download timeout (10 min) |
| `TELEGRAM_API_ID` | — | For local Bot API server |
| `TELEGRAM_API_HASH` | — | For local Bot API server |
| `LOCAL_API_URL` | — | Local Bot API URL |

---

## License

MIT
