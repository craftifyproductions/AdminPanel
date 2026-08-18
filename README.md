# Craftify AI Admin Panel

Craftify AI Admin Panel is a single-user, password-gated admin console for Cloudflare R2 (and related
ops). It gives you a dashboard with bucket totals, a Settings page showing which environment
variables are configured, and an R2 Hub with a lazily-expanding folder tree where you can
right-click to create, rename, and delete folders. All R2 credentials stay on the server; the
browser only ever talks to this app's own API routes.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, `@aws-sdk/client-s3`, and
`lucide-react`. No database.

## Prerequisites

- Node.js 20.9 or newer
- A Cloudflare account with an R2 bucket

## Install

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env.local` and fill in the values. `.env.local` is gitignored; nothing in
it is ever committed.

```bash
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=          # optional
ADMIN_PASSWORD=
AUTH_SECRET=
```

The S3 endpoint is derived automatically as `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` with
`region: "auto"`.

### Where each R2 value comes from

- **`R2_ACCOUNT_ID`** — Cloudflare dashboard, **R2 Object Storage**. The account ID is shown in the
  right-hand sidebar of the R2 overview page, and it is also the first path segment of the dashboard
  URL (`dash.cloudflare.com/<account-id>/r2`).
- **`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`** — **R2 Object Storage → API → Manage API tokens →
  Create API token**. Give the token **Object Read & Write** permission, scoped to the bucket you
  want this panel to manage. Cloudflare then shows an *Access Key ID* and a *Secret Access Key*.
  The secret is displayed only once, so copy it immediately. Use the S3-compatible access key pair,
  not the "Token value" string shown alongside it.
- **`R2_BUCKET_NAME`** — the bucket name from **R2 Object Storage → Overview**. It must be the bucket
  your API token is allowed to reach.
- **`R2_PUBLIC_URL`** — optional. If you have attached a custom domain or enabled the `r2.dev`
  subdomain (**bucket → Settings → Public Development URL**), put that base URL here to build public
  object links. Leave it blank if the bucket is private.

### `AUTH_SECRET`

A random string used as the HMAC key for the session cookie. Any of these works:

```bash
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
# PowerShell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

Changing it invalidates every existing session.

### `ADMIN_PASSWORD`

The single password for the login gate. Pick your own strong value and paste it in. It is compared
server-side with `crypto.timingSafeEqual` and never sent to the browser.

## Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
```

Environment variables are read at request time, so editing `.env.local` while `npm run dev` is
running picks up the new values without a manual restart.

## Architecture notes

**R2 has no real folders.** Object keys just happen to contain `/`, and every operation in this panel
is built around that:

- **List** — `ListObjectsV2` with `Delimiter: "/"`. `CommonPrefixes` become subfolders and `Contents`
  become files. A zero-byte key ending in `/` is a folder marker and is filtered out of the file
  list.
- **Create** — `PutObject` of a zero-byte object at `parent/name/`. This is the standard S3
  folder-marker trick; it is what makes an otherwise empty folder visible.
- **Rename** — there is no native rename. Every key under the old prefix is paginated, `CopyObject`ed
  to the new prefix (16 copies in flight at a time), and then the originals are removed with
  `DeleteObjects` in batches of 1000.
- **Delete** — every key under the prefix is paginated and removed with `DeleteObjects` in batches
  of 1000.

Two consequences worth knowing before you use rename or delete on real data:

- **Neither is atomic.** A rename that fails partway can leave objects at both prefixes, and a failed
  delete can leave part of the tree behind. Both operations are behind a confirm dialog and report
  the number of objects they touched.
- **`CopyObject` caps at 5 GB per object.** A rename involving any single object larger than that
  will fail; such objects need a multipart copy, which this panel does not implement.

Auth is a single HMAC-signed, httpOnly **browser session** cookie (`r2_admin_session` — no persistent
`maxAge`; cleared when the browser session ends). Closing a panel tab also POSTs `/api/auth/logout`
via keepalive/`sendBeacon` so the cookie is cleared immediately. The signed token still carries a
bounded `exp` as a hard ceiling. `proxy.ts` verifies it on every non-public route: unauthenticated
page requests are redirected to `/login`, and unauthenticated `/api/*` requests get
`401 {"error":"Unauthorized"}`.

## Security

There is **no SQL database** in this app. Persistence is Cloudflare R2 (S3 API) plus optional writes
to `.env.local`. Classic SQL injection is not a relevant vector.

### Deploy and secrets

- If the panel is reachable on the public internet, put it behind **Cloudflare Access**, a VPN, or
  equivalent — do not rely on the password alone as the only perimeter.
- Use a strong `ADMIN_PASSWORD` and a long random `AUTH_SECRET` (see generators above).
- **Rotating `AUTH_SECRET` revokes all sessions** immediately. Changing `ADMIN_PASSWORD` alone does
  not invalidate cookies already issued.

### Controls in the app

| Control | What it does |
| --- | --- |
| Login rate limit | Failed attempts are limited per IP (lockout after repeated failures). |
| Session checks | HMAC cookie verified in the proxy and again inside protected API handlers. |
| CSRF Origin | Mutating authenticated API routes require a same-origin `Origin` / `Referer`. |
| Object MIME | Object GET responses avoid serving HTML/JS as executable types; `nosniff` applied. |
| Security headers | CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy; HSTS in production. |

## Troubleshooting

- **"Missing required environment variable…"** — the named key is absent or blank in `.env.local`.
  Note that `.env.local` takes priority over `.env`.
- **"R2 rejected the credentials."** — the access key pair is wrong, or the API token does not cover
  `R2_BUCKET_NAME`. Confirm you copied the S3 access key ID and secret rather than the token value,
  and that the token has Object Read & Write.
- **"The configured R2 bucket does not exist."** — `R2_BUCKET_NAME` is misspelled or lives in a
  different account than `R2_ACCOUNT_ID`.
- **"Could not reach R2."** — network or proxy problem, or a bad `R2_ACCOUNT_ID`, which would make
  the derived endpoint hostname wrong.
- **Login always says "Incorrect password."** — `ADMIN_PASSWORD` is blank or has stray whitespace or
  quotes around it in `.env.local`. Values are trimmed but quotes are not stripped.
- **Signed out unexpectedly** — `AUTH_SECRET` changed, which invalidates all issued cookies.
- **Dashboard totals are slow** — object count and total size are computed by listing every key in
  the bucket, so they get slower as the bucket grows. The folder tree is unaffected; it only lists one
  level at a time.
- **Port 3000 is already in use** — an earlier dev server is still running. On Windows:
  `Get-NetTCPConnection -LocalPort 3000` then `Stop-Process -Id <OwningProcess>`.
