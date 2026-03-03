import cors from 'cors';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 8080);

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

const normalizeOrigin = (origin) => {
  const value = (origin || '').trim();
  if (!value) return null;
  if (value === '*') return '*';
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `https://${value}`;
};

const getCorsOrigins = () => {
  const rawOrigins = (process.env.CORS_ORIGIN || '*').trim();
  if (rawOrigins === '*') return true;

  const origins = rawOrigins
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  if (origins.includes('*')) return true;
  return origins.length > 0 ? origins : true;
};

const getIceServers = () => {
  const rawValue = process.env.ICE_SERVERS_JSON;
  if (!rawValue) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    console.warn('Invalid ICE_SERVERS_JSON. Falling back to default servers.', error);
  }

  return DEFAULT_ICE_SERVERS;
};

app.use(cors({ origin: getCorsOrigins() }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'directdrop-backend',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/runtime-config', (_req, res) => {
  res.status(200).json({
    iceServers: getIceServers()
  });
});

app.get('/', (_req, res) => {
  res.status(200).json({
    message: 'DirectDrop backend is running.',
    health: '/health',
    runtimeConfig: '/api/runtime-config'
  });
});

app.listen(port, () => {
  console.log(`DirectDrop backend listening on port ${port}`);
});
