# DirectDrop - Secure Peer-to-Peer File Sharing

DirectDrop is a browser-based file transfer app built with WebRTC DataChannels.  
Files move directly between devices, while a lightweight Socket.IO backend handles signaling.

## Live Links

- Frontend (Netlify): [https://p2pfile-transfer.netlify.app](https://p2pfile-transfer.netlify.app)
- Backend (Render): [https://peer-to-peer-file-transfer-o0tn.onrender.com](https://peer-to-peer-file-transfer-o0tn.onrender.com)
- Health check: [https://peer-to-peer-file-transfer-o0tn.onrender.com/health](https://peer-to-peer-file-transfer-o0tn.onrender.com/health)
- Runtime ICE config: [https://peer-to-peer-file-transfer-o0tn.onrender.com/api/runtime-config](https://peer-to-peer-file-transfer-o0tn.onrender.com/api/runtime-config)

## Features

- One-to-one (P2P) and broadcast/group room modes
- QR code share and in-app QR scanner for quick joining
- Optional room password support for protected sessions
- Real-time chat + multi-file transfer over WebRTC DataChannels
- PWA support (installable app + service worker caching)
- Backend-managed STUN/TURN runtime config and CORS-safe API endpoints

## Tech Stack

- Frontend: HTML, Tailwind CSS utility classes, vanilla JavaScript, WebRTC
- Realtime Signaling: Socket.IO
- Backend: Node.js, Express
- Deployment: Netlify (frontend), Render (backend)

## Project Structure

```text
Peer-to-Peer-File-Transfer/
  backend/
    src/server.js
    package.json
    .env.example
  frontend/
    index.html
    style.css
    script.js
    sw.js
    config.js
    config.example.js
    manifest.json
    _headers
  netlify.toml
  render.yaml
  package.json
```

## How It Works

1. Host creates a room and shares link/QR.
2. Peer joins room using the exact link or scanned QR.
3. Offer/answer + ICE candidates are exchanged through Socket.IO signaling.
4. WebRTC direct data channel is established.
5. Files and messages move peer-to-peer (server is not used as file storage).

## Local Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Run backend

```bash
npm run dev:backend
```

Backend default: `http://localhost:8080`

### 3) Run frontend

```bash
npm run dev:frontend
```

Frontend default: `http://localhost:5173`

## Configuration

### Frontend runtime config

File: `frontend/config.js`

```js
window.DIRECTDROP_CONFIG = {
  backendUrl: "https://peer-to-peer-file-transfer-o0tn.onrender.com"
};
```

### Backend environment variables

Use `backend/.env.example` as a reference.

- `PORT` (default: `8080`)
- `CORS_ORIGIN` (example: `https://p2pfile-transfer.netlify.app`)
- `ICE_SERVERS_JSON` (optional JSON array with STUN/TURN servers)
- `GROUP_ROOM_TTL_MS` (default: `3600000`)
- `P2P_ROOM_TTL_MS` (default: `900000`)

## Deployment

### Frontend on Netlify

1. Import this GitHub repo into Netlify.
2. Keep settings from `netlify.toml` (publish dir: `frontend`).
3. Deploy.

### Backend on Render

1. Create a Render Web Service with `rootDir=backend`.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add env var: `CORS_ORIGIN=https://p2pfile-transfer.netlify.app`
5. Deploy.

You can also use `render.yaml` for blueprint deployment.

## Verification Commands

```bash
BACKEND_URL="https://peer-to-peer-file-transfer-o0tn.onrender.com"
FRONTEND_URL="https://p2pfile-transfer.netlify.app"

curl -sS "$BACKEND_URL/health"
curl -sS "$BACKEND_URL/api/runtime-config"
curl -sS "$FRONTEND_URL/config.js"
curl -sS "$FRONTEND_URL" | grep -E 'config\.js|script\.js|manifest\.json'
curl -sS -D - -o /dev/null -H "Origin: $FRONTEND_URL" "$BACKEND_URL/api/runtime-config" | grep -Ei 'HTTP/|access-control-allow-origin'
```

## Troubleshooting

- If status is stuck on "Connecting":
  - Open the exact shared link (do not edit room ID manually)
  - Disable VPN/ad blocker temporarily
  - Hard refresh on both devices (`Cmd+Shift+R`)
  - Confirm backend `/health` and `/api/runtime-config` are reachable
- Render free tier may cold start after inactivity (first connection can be slow)
- Some networks block UDP; TURN fallback improves reliability

## Security and Privacy Notes

- File payloads are sent over encrypted WebRTC transport (DTLS/SRTP).
- Signaling server stores rooms in memory only (ephemeral; cleared on restart).
- No permanent file storage on backend.

## Roadmap

- Better transfer progress analytics
- Resume/retry for interrupted transfers
- Improved UI motion and accessibility refinements

## Author

Built by Abhishek.
