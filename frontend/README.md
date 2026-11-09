# JobPilot AI — frontend

React 19 + TypeScript (strict) + Vite + Tailwind CSS v4 single-page app for the JobPilot AI backend.

## Development

```bash
npm ci
npm run dev        # http://localhost:5173 — proxies /api and /mock-portal to http://127.0.0.1:8000
```

Start the FastAPI backend on port 8000 first (see `../backend`).

## Scripts

| Script              | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run build`     | Type-check (`tsc -b`) and build to `dist/` |
| `npm run lint`      | ESLint (flat config, typescript-eslint)    |
| `npm run typecheck` | TypeScript only                            |
| `npm test`          | Vitest + Testing Library (jsdom, no network) |

## Notes

- Serve `dist/` from the same origin as the API. All requests use relative `/api/...` URLs with
  `credentials: 'same-origin'`; non-GET requests send `X-CSRF-Token` from the `jp_csrf` cookie.
- CSP-friendly: no inline scripts, external fonts, CDNs or remote images. Only the theme preference
  is stored in `localStorage`.
- SPA routing: the server must fall back to `index.html` for unknown non-`/api` paths.
- Layout: `src/services` (API wrapper + per-domain modules), `src/types/api.ts` (types from
  `docs/openapi.json`), `src/components/ui` (design system), `src/pages` (routes), `src/test` (test helpers).
