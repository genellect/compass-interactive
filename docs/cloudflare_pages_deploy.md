# Cloudflare Pages Deploy Guide

## Recommended Path: GitHub Integration

Use Cloudflare Pages GitHub integration first.

Settings:

```text
Repository: my270yuto0413-cmyk/compass-interactive
Production branch: main
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Root directory: empty
Node version: 24
```

Production environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Do not set these in Cloudflare Pages frontend environment variables:

```text
ADMIN_PIN
ADMIN_SESSION_SECRET
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
DATABASE_URL
DATABASE_PASSWORD
OPENAI_API_KEY
VITE_ADMIN_PIN
VITE_OPENAI_API_KEY
```

Admin and service-role secrets belong in Supabase Edge Function Secrets, not in Cloudflare Pages.

## If Cloudflare GitHub Login Fails

Common causes:

```text
- Cloudflare browser session is stale
- GitHub OAuth authorization popup was blocked
- Browser blocks third-party cookies or cross-site tracking
- GitHub account is different from the repository owner account
- Cloudflare GitHub App was authorized for selected repositories, but compass-interactive was not selected
- GitHub organization or account requires extra approval/SSO
- Browser extension, VPN, or network filter blocks OAuth callback
```

Recommended checks:

```text
1. Open Cloudflare in a private/incognito window.
2. Disable ad blockers or privacy extensions temporarily.
3. Sign out of GitHub, then sign in as my270yuto0413-cmyk.
4. Retry: Workers & Pages -> Create application -> Pages -> Connect to Git.
5. In GitHub, check Settings -> Applications -> Installed GitHub Apps -> Cloudflare Pages.
6. Ensure the compass-interactive private repository is included in repository access.
```

## Emergency Fallback: Direct Upload

Direct Upload can deploy without GitHub integration, but it is not the preferred long-term path.

Important limitation:

```text
Cloudflare Pages projects created by Direct Upload cannot later be converted to Git integration.
Use this only if GitHub OAuth remains blocked and a temporary public URL is urgently needed.
```

Run from the project root:

```powershell
npm run deploy:cloudflare:direct
```

The first run may ask you to authenticate with Cloudflare in the browser.

If you prefer an API token instead of browser login, set a Cloudflare API token in your local shell only. Do not commit it.

## Post-deploy Smoke Test

After Cloudflare issues a URL, check:

```text
/join
/lecture
/display
/admin
```

Flow:

```text
1. Open /join.
2. Enter JC2026.
3. Confirm /lecture opens.
4. Submit a comment.
5. Open another browser and confirm comments/likes realtime.
6. Answer a poll and confirm poll results.
7. Open /display and confirm comments, likes, poll results, and PDF area.
8. Open /admin and confirm PIN gate.
```

If deploy build fails, copy the Cloudflare build log and fix the first actual error line first.
