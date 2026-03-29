# Secure Ephemeral Content Viewer

A full-stack web application for blue-themed, tokenized, self-destructing media delivery with admin approvals, link tracking, best-effort anti-capture deterrence, and expiring secure sessions.

## Browser Limitation

This system cannot fully prevent screenshots, screen recording, or content extraction in web browsers. It only discourages and reacts to suspicious behavior with session hiding, warnings, expiry, and cleanup.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, Express, TypeScript, MongoDB + Mongoose
- Shared types: local workspace package
- Storage: local temp storage with an S3-ready adapter interface

## Structure

- `apps/web`: public site, viewer, and hidden admin panel
- `apps/api`: auth, link, upload, streaming, and cleanup APIs
- `packages/shared`: shared schemas and helpers

## Setup

1. Copy `.env.example` to `.env` in `apps/api` and `apps/web`.
2. Add a real `MONGODB_URI` with your database password.
3. For production deployments, set `VITE_API_URL=https://linkvault-backend-only.onrender.com` in `apps/web`, set `VIEWER_URL=https://share.livevault.live` in `apps/api`, and set `CLIENT_URLS=https://linkvaulthelp.netlify.app,https://share.livevault.live,http://localhost:5173` in `apps/api`.
4. Install dependencies:

```bash
npm install
```

5. Run the app:

```bash
npm run dev
```

## Hidden Admin Access

Press `Ctrl + Shift + E` on the public site to open the admin auth interface.
