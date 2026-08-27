# Polyball Production Deployment Guide

This guide covers everything needed to deploy **Polyball** to the public web as a high-performance, real-time multiplayer browser game with zero required installation.

---

## 1. Architecture & Deployment Models

Polyball supports two deployment strategies:

### Option A: Unified Single-Container Deployment (Recommended)
A single Node.js process serves the compiled frontend static SPA files and handles WebSocket (`/`) connections on the same port (`PORT=8080`).
- **Best for**: Fly.io, Render, Railway, DigitalOcean App Platform, AWS App Runner, or any VPS with Docker.
- **Benefits**: Simplest configuration, single domain/SSL certificate, no cross-origin CORS complications, automatic `wss://` detection.

### Option B: Split Frontend + Backend Deployment
- **Frontend**: Static files (`client/dist`) deployed to a global CDN (Cloudflare Pages, Vercel, Netlify, or AWS S3/CloudFront).
- **Backend**: Node.js WebSocket server deployed on Fly.io, Render, or Railway with `ALLOWED_ORIGINS` configured to your frontend domain.

---

## 2. Production Environment Variables Reference

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production optimizations and disables debug logging. |
| `PORT` | `8080` | Port for HTTP health check, static file serving, and WebSocket upgrades. |
| `HOST` | `0.0.0.0` | Network binding address. |
| `ALLOWED_ORIGINS` | `""` *(any)* | Comma-separated list of allowed browser origins (e.g. `https://polyball.example.com`). Rejects unauthorized origins with `403 Forbidden`. |
| `SERVE_STATIC` | `false` (`true` in Docker) | Serves the compiled client files from `CLIENT_DIR` with SPA fallback routing. |
| `CLIENT_DIR` | `../client/dist` | Relative or absolute path to the compiled client files. |
| `TRUST_PROXY` | `false` | Enables reverse-proxy header trust (`X-Forwarded-For`, `X-Forwarded-Proto`). Enable when behind Cloudflare, Nginx, or cloud load balancers. |
| `VITE_WS_URL` | *(auto-detected)* | Custom WebSocket URL. Leave blank in unified mode (automatically connects via `wss://` over HTTPS). |
| `VITE_PUBLIC_URL` | `http://localhost:5173` | Public base URL used for shareable `/join/<CODE>` invite links. |

---

## 3. Step-by-Step Platform Deployment Guides

### A. Deploy with Docker (Any VPS, Fly.io, Railway, DigitalOcean)

The repository includes a production multi-stage [Dockerfile](file:///c:/Users/kavyy/Downloads/polyball/Dockerfile).

#### 1. Build and run locally:
```bash
# Build Docker image
docker build -t polyball:latest .

# Run container on port 8080
docker run -d -p 8080:8080 \
  -e ALLOWED_ORIGINS=http://localhost:8080 \
  -e TRUST_PROXY=false \
  --name polyball polyball:latest
```

#### 2. Test the container:
- Open `http://localhost:8080` in your browser.
- Verify health: `curl http://localhost:8080/health`

---

### B. Deploy to Fly.io

1. **Install Fly CLI** and authenticate:
   ```bash
   fly auth login
   ```

2. **Launch the application**:
   ```bash
   fly launch --no-deploy
   ```

3. **Configure `fly.toml`**:
   ```toml
   app = "polyball"
   primary_region = "iad"

   [build]
     dockerfile = "Dockerfile"

   [env]
     NODE_ENV = "production"
     SERVE_STATIC = "true"
     PORT = "8080"
     HOST = "0.0.0.0"
     TRUST_PROXY = "true"

   [http_service]
     internal_port = 8080
     force_https = true
     auto_stop_machines = "stop"
     auto_start_machines = true
     min_machines_running = 1

     [http_service.concurrency]
       type = "connections"
       hard_limit = 1000
       soft_limit = 800

   [[http_service.checks]]
     grace_period = "10s"
     interval = "15s"
     method = "GET"
     path = "/health"
     timeout = "5s"
   ```

4. **Deploy**:
   ```bash
   fly deploy
   ```

---

### C. Deploy to Render

1. Create a **New Web Service** linked to your Git repository.
2. Select **Docker** environment (Render will automatically detect the root `Dockerfile`).
3. Set Environment Variables in the Render dashboard:
   - `NODE_ENV`: `production`
   - `PORT`: `8080`
   - `SERVE_STATIC`: `true`
   - `TRUST_PROXY`: `true`
   - `ALLOWED_ORIGINS`: `https://your-app.onrender.com`
4. Set the Health Check Path to `/health`.
5. Click **Create Web Service**.

---

### D. Deploy to Railway

1. Click **New Project** -> **Deploy from GitHub repo**.
2. Railway detects the `Dockerfile` automatically.
3. In service **Settings** -> **Variables**, add:
   - `NODE_ENV`: `production`
   - `PORT`: `8080`
   - `SERVE_STATIC`: `true`
   - `TRUST_PROXY`: `true`
4. Under **Networking**, click **Generate Domain** to get a public HTTPS/WSS URL.

---

## 4. HTTPS & WSS Reverse Proxy Configurations

When hosting on a custom VPS (Ubuntu/Debian) behind a reverse proxy, use these production configurations.

### Nginx Configuration (`/etc/nginx/sites-available/polyball`)

```nginx
# Map WebSocket Upgrade headers
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name polyball.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name polyball.example.com;

    # SSL Certificates (Certbot / Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/polyball.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/polyball.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security Headers
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Root proxy to Node.js backend
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for persistent WebSocket connections
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### Caddy Configuration (`Caddyfile`)

```caddy
polyball.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

---

## 5. Health Check Endpoint

Polyball includes a built-in health monitoring endpoint at `GET /health`.

### Example Response:
```json
{
  "status": "ok",
  "service": "polyball",
  "version": "0.1.0",
  "env": "production",
  "uptimeSeconds": 1420,
  "timestamp": "2026-08-27T15:10:00.000Z",
  "clients": 14,
  "rooms": 3,
  "players": 12,
  "memory": {
    "heapUsedMb": 38.42,
    "heapTotalMb": 54.12,
    "rssMb": 92.65
  }
}
```

---

## 6. Production Launch Checklist

- [ ] **Environment Variables**: `NODE_ENV=production` is set.
- [ ] **HTTPS/SSL**: Valid TLS certificate active on custom domain.
- [ ] **Secure WebSockets**: Browser connects via `wss://` with no mixed-content warnings.
- [ ] **CORS / Origin Whitelist**: `ALLOWED_ORIGINS` is configured with your production domain (or multiple allowed subdomains).
- [ ] **SPA Routing**: Navigating directly to `/join/ABC123`, `/room/ABC123`, and `/practice` loads the app without 404 errors.
- [ ] **Health Monitoring**: Monitoring ping configured on `https://your-domain.com/health` (every 15–30s).
- [ ] **Static Asset Caching**: `Cache-Control` header set to `immutable` on `/assets/*` and `no-cache` on `index.html`.
- [ ] **Mobile & Cross-Device Gameplay**: Verified on Mobile Safari (iOS), Chrome (Android), and Desktop (Windows/macOS/Linux) across Touch, Mouse, and Keyboard controls.
- [ ] **Offline Practice Mode & PWA**: PWA manifest loads at `/manifest.webmanifest` and service worker caches app shell for instant zero-install play.
