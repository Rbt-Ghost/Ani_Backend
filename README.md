# Ani-cli backend

This folder contains a small Node server that mirrors the ani-cli AllAnime flow.

## Endpoints

- `GET /api/health`
- `GET /api/search?q=query&mode=sub|dub`
- `GET /api/episodes/:id?mode=sub|dub`
- `GET /api/stream/:id/:episode?mode=sub|dub`

## Run

```bash
node backend/server.js
```

The Vite dev server proxies `/stream-api` to `http://localhost:3001`.