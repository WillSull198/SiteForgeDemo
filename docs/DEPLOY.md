# SiteForge Deployment

## Railway

SiteForge deploys to Railway as a static SPA served by the `serve` package.

### One-time setup

1. New project -> Deploy from GitHub repo -> select `WillSull198/SiteForgeDemo`.
2. Railway auto-detects Node and runs `npm install` -> `npm run build` -> `npm start`.
3. After the first deploy, open Railway -> Service -> Settings -> Public Networking.
4. Leave **Target Port** blank. Railway should autodetect it from the running process.
5. Open the generated `*.up.railway.app` URL. The SPA should load.

### Required Railway settings

- Source repo: `WillSull198/SiteForgeDemo`
- Branch: `main`
- Builder: `NIXPACKS`
- Start command: `npm start`
- Target Port: leave blank
- `PORT` env var: Railway sets this automatically; do not override it unless you also set Target Port to the same value.

### Why we do not pin a target port

Railway injects a dynamic `$PORT` env var into every container. SiteForge's start script reads `$PORT` and binds the static file server to it. If you pin a fixed target port in the Railway UI, it must match `$PORT` exactly, which is fragile. Leaving Target Port blank lets Railway autodetect the listening process.

### Local production mirror

```bash
npm install
npm run build
PORT=4173 npm start
```

Then open `http://localhost:4173`.

### Diagnosing a blank page

1. Open the Railway public URL in incognito.
2. Wait 5 seconds. If a "SiteForge didn't start" panel appears, click **Reset offline cache** and reload.
3. Open DevTools -> Console.
4. Look for `[SiteForge] booting`.
5. If the boot line is missing, the JavaScript bundle did not load. Check the Network tab for 404s on `.js` files.
6. Check Railway build logs:
   - `npm install` should complete.
   - `npm run build` should produce `dist/index.html` and assets.
   - If `dist/index.html`, `dist/assets`, or `dist/serve.json` are missing, `npm start` will fail loudly instead of serving a blank page.
   - `npm start` should log `[start] Starting serve on 0.0.0.0:<PORT>`.
   - `serve` should log that it is accepting connections on `0.0.0.0:<PORT>`.
7. If Railway still cannot reach the service, clear the Target Port field in Public Networking and redeploy.
8. Open `/railway-debug.html` on the Railway domain. If it loads, static serving works and any blank app is a bundle/runtime/cache issue.

### Cloudflare Worker proxy

The OpenAI proxy is a separate service on Cloudflare Workers. It is configured inside SiteForge after the app loads. Railway deployment changes do not affect the proxy. See `docs/setup-openai-proxy.md`.

## Demo and production Railway services

SiteForge can deploy the same `main` branch as either a demo build or a production build. The environment variable controls whether the large seeded demo scenario is included in the bundle.

### Demo service

- Domain example: `demo.siteforge.com.au`
- Railway variable: `VITE_INCLUDE_DEMO_DATA=true`
- Optional: `VITE_DEMO_TIME_TRAVEL=true`
- Use this for sales walkthroughs, training, and safe experimentation.

### Production service

- Domain example: `app.siteforge.com.au`
- Railway variable: `VITE_INCLUDE_DEMO_DATA=false`
- Recommended: `VITE_DEMO_TIME_TRAVEL=false`
- Result: demo seed content is loaded from the production seed module instead of the worked demo module, the Start Demo entry point is hidden, and the header shows `Production`.

Both services can deploy from `main`. Keep their Railway storage/domains separate so real customers never share the demo workspace or demo browser storage.
