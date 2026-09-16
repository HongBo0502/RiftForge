# Deploying

Riftforge is a static site — no server of ours. The build output in `dist/` is
all there is.

Deployed on **Cloudflare Pages**, from the GitHub repo, on every push to `main`.

---

## One-time setup

### 1. Push the repo

```bash
git remote add origin https://github.com/<you>/riftforge.git
git push -u origin main
```

### 2. Connect Cloudflare Pages

dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**,
pick the repo, then:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | read from `.nvmrc` (22) |

**The build needs no network.** The card dataset is committed to the repo
(`public/data/`), deliberately: Riftcodex sits behind Cloudflare and refuses
datacenter IPs, so a build runner cannot fetch it. Do not "fix" the build
command to fetch cards first — that is what breaks the deploy, not what makes it
work. `build:deploy` is kept as an alias of `build` so an older Pages
configuration pointing at it still works.

To refresh the data, run `npm run fetch-cards` **locally** and commit the result.

### 3. Environment variables

Settings → **Environment variables** → add for **Production** *and* **Preview**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | your project URL |
| `VITE_SUPABASE_ANON_KEY` | your publishable key |

These are read at **build** time, not runtime — Vite bakes them into the
bundle. Changing them requires a redeploy, not just a restart.

Without them the site still builds and works; only online play is disabled, and
the lobby says so plainly.

Never add the `service_role` key. It bypasses every security rule and would be
served to every visitor inside the JavaScript.

### 4. GitHub repository secrets

Repo → Settings → Secrets and variables → **Actions** → add the same two names
and values. CI builds without them fine — this only keeps CI's build identical
to production.

---

## What happens on a push

1. GitHub Actions (`.github/workflows/ci.yml`) fetches card data, typechecks,
   runs the tests, builds.
2. Cloudflare Pages builds and deploys independently.

CI failing does **not** block the Pages deploy — they are separate. If that
matters, add a branch protection rule requiring the `build` check to pass
before merging to `main`.

---

## Things that will bite you

**Client-side routes.** `/cards`, `/decks` and `/play` are React Router paths,
not files. `public/_redirects` rewrites everything to `index.html`; without it a
direct link or a refresh on those paths returns 404. Cloudflare Pages and
Netlify both read that file.

**The service worker.** `sw.js` must never be cached, or visitors pin
themselves to an old build. `netlify.toml` sets that header; on Cloudflare
Pages, add a `public/_headers` file if you see stale builds:

```
/sw.js
  Cache-Control: no-cache, no-store, must-revalidate
```

**A new set breaking the dataset.** `fetch-cards` verifies what it downloads
and exits non-zero rather than writing a truncated dataset, so a bad fetch
fails the build instead of shipping a half-empty card database. The weekly CI
run exists to catch that before a player does.

**Online play needs HTTPS.** Supabase Realtime is a `wss://` connection, which
browsers refuse from an insecure origin. Every host above serves HTTPS by
default, so this only matters if you self-host.

---

## Custom domain

Cloudflare Pages → your project → **Custom domains**. Free, including the
certificate. Nothing in the app assumes a hostname.
