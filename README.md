# DirectDrop - Peer-to-Peer File Transfer

DirectDrop is a WebRTC-based file sharing app. This repository is now split into separate frontend and backend services so both can be deployed cleanly.

Live frontend (existing): https://p2pfile-transfer.netlify.app/

## Project Structure

```text
Peer-to-Peer-File-Transfer/
  frontend/                 # Static web app (HTML/CSS/JS + PWA)
    index.html
    script.js
    style.css
    sw.js
    manifest.json
    config.js
    config.example.js
    _headers
    package.json
  backend/                  # Node.js API service
    src/server.js
    package.json
    .env.example
  netlify.toml              # Frontend deploy config (Netlify)
  render.yaml               # Full Render blueprint (frontend + backend)
  package.json              # Workspace scripts
```

## What Changed

- Moved the existing web app into `frontend/`.
- Added a deployable backend in `backend/`.
- Added runtime config endpoint (`/api/runtime-config`) for ICE server config.
- Frontend now optionally pulls ICE servers from backend (falls back to defaults).
- Added service worker registration and improved cache handling.
- Added deployment files for Netlify (frontend) and Render (frontend + backend blueprint).

## Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Run backend

```bash
npm run dev:backend
```

Backend runs on `http://localhost:8080` by default.

### 3) Run frontend

In another terminal:

```bash
npm run dev:frontend
```

Frontend runs on `http://localhost:5173`.

## Frontend Configuration

`frontend/config.js` controls runtime backend integration:

```js
window.DIRECTDROP_CONFIG = {
  backendUrl: ""
};
```

- Local: you can set `backendUrl: "http://localhost:8080"`
- Production: set your deployed backend URL

## Backend Environment

Use `backend/.env.example` as a reference:

- `PORT` (default `8080`)
- `CORS_ORIGIN` (e.g. `https://your-frontend-domain.com`)
- `ICE_SERVERS_JSON` (optional JSON array string)
- `GROUP_ROOM_TTL_MS` (optional room expiry for group rooms; default `3600000`)
- `P2P_ROOM_TTL_MS` (optional room expiry for p2p rooms; default `900000`)

## Deployment

### Frontend (Netlify)

This repo already includes `netlify.toml` configured to deploy from `frontend/`.

Steps:

1. Import the repo in Netlify.
2. Keep the default config from `netlify.toml`.
3. Deploy.

After deploying frontend, update `frontend/config.js` with your backend URL and redeploy frontend.

### Render (Frontend + Backend)

This repo includes `render.yaml` that deploys both services together:

- `directdrop-backend` (Node API)
- `directdrop-frontend` (static site)
- Frontend gets backend URL automatically from Render service discovery.
- Backend CORS is automatically set to the frontend host.

Steps:

1. Create a new Render Blueprint service from this repo.
2. Confirm both services are selected.
3. Click `Apply` to deploy.
4. Optional: set `ICE_SERVERS_JSON` on backend for custom TURN/STUN servers.

### Backend Only (Render)

If you only want backend on Render and frontend elsewhere:

1. Create a Render web service using `rootDir=backend`.
2. Build command: `npm install`
3. Start command: `npm start`
4. Set `CORS_ORIGIN` to your frontend domain.
5. Optional: set `ICE_SERVERS_JSON` for custom TURN/STUN.
6. Deploy.

### Frontend (Netlify)

This repo also includes `netlify.toml` configured to deploy from `frontend/`.

Steps:

1. Import the repo in Netlify.
2. Keep the default config from `netlify.toml`.
3. Deploy.

## API Endpoints (Backend)

- `GET /health` -> service health
- `GET /api/runtime-config` -> runtime ICE server config for frontend

## Notes

- WebRTC file data is still peer-to-peer.
- Signaling now runs through the backend Socket.IO service (no Firebase dependency).
- Backend signaling rooms are in-memory, so they reset when the backend restarts/redeploys.
- Backend is deployment-ready, but actual cloud deployment must be triggered from your Netlify/Render accounts.
