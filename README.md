# Ani-cli backend

This folder contains a small Node server that mirrors the ani-cli AllAnime flow.

## Endpoints

- `GET /api/health`
- `GET /api/search?q=query&mode=sub|dub`
- `GET /api/episodes/:id?mode=sub|dub`
- `GET /api/stream/:id/:episode?mode=sub|dub`

## Run

```bash
node server.js
```

## Deploy on Vercel

This repo is already set up for Vercel serverless deployment through the `api/[...path].js` function.

1. Import the repository into Vercel.
2. Keep the default project root pointed at this folder.
3. Deploy without a custom build command.

The backend endpoints will be available under `/api/health`, `/api/search`, `/api/episodes/:id`, and `/api/stream/:id/:episode`.

The Vite dev server proxies `/stream-api` to `http://localhost:3001`.