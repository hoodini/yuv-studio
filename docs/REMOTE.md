# Use the studio from anywhere

The studio needs ffmpeg, a GPU for Whisper and direct access to large video files. A serverless host cannot give it that, so the practical way to reach it from anywhere is to leave it running on your own computer and publish it at a private address on your domain through a Cloudflare Tunnel.

```
phone / laptop  ->  https://studio.example.com  ->  Cloudflare  ->  tunnel  ->  your PC :5177
```

What you get: the same projects, the same files, the same GPU, from any browser. On a phone the studio opens in its mobile mode (see the User guide) and can be installed to the home screen. What it costs: the PC has to be on, and uploads from outside travel over your home connection. Uploads go in 8 MB pieces, so Cloudflare's 100 MB request limit does not stop large files, and a dropped connection resumes.

## 1. Set a token and the public host name

Create `.env` in the project folder:

```
STUDIO_ALLOWED_HOSTS=studio.example.com
STUDIO_TOKEN=<a long random secret>
```

Make the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Restart the studio. It refuses to start with a public host name unless the token is at least 32 characters with some variety in them; the command above gives 43.

From now on:

- `http://127.0.0.1:5177` on the PC itself works as before, with no login.
- The public address shows a login form. Typing the token there signs that browser in for 30 days; the cookie holds a random session id, not the token.
- After ten wrong tokens within ten minutes, from anyone, no token is checked until the ten minutes pass: the login form and API or MCP calls answer 429. A browser that is already signed in keeps working.
- API and MCP calls through the public address send `Authorization: Bearer <token>`.

Signing out and revoking access:

- `POST /logout` signs the current browser out. `POST /logout?all=1` signs every browser out; run it on the PC itself if a device is lost: `curl -X POST "http://127.0.0.1:5177/logout?all=1"`.
- Changing `STUDIO_TOKEN` and restarting ends every session and invalidates the old token for API and MCP clients.

## 2. Add the host name to the tunnel

With an existing tunnel, add one rule above the final catch-all in `~/.cloudflared/config.yml`:

```yaml
ingress:
  - hostname: studio.example.com
    service: http://localhost:5177
  - service: http_status:404
```

Create the DNS record and restart the tunnel:

```bash
cloudflared tunnel route dns <tunnel name or id> studio.example.com
```

No tunnel yet: `cloudflared tunnel login`, then `cloudflared tunnel create studio`, then the two steps above.

## 3. Recommended: Cloudflare Access (sign in with your email)

With Access, Cloudflare asks for a one-time code sent to your email before a request ever reaches your PC, and the studio trusts that sign-in, so the token page is gone for browsers. Zero Trust Free covers up to 50 users at no cost.

1. Zero Trust > Integrations > Identity providers > **Add an identity provider > One-time PIN**. New accounts may have only the "Cloudflare" login method, which signs you in with your Cloudflare account email; if that is not the email in your policy, Access answers "That account does not have access".
2. In the Cloudflare dashboard, Zero Trust > Access controls > Applications, add a **self-hosted** application for `studio.example.com` with an **Allow** policy that includes only your email.
3. Add a second self-hosted application for the paths that must stay open: `studio.example.com/home`, `studio.example.com/brand` (the public home page) and `studio.example.com/mcp`, with a **Bypass** policy for **Everyone**. The studio still demands the token on `/mcp`, so agents keep working with their Bearer header exactly as before.
4. Tell the studio about Access in `.env`, then restart it:

   ```
   STUDIO_ACCESS_TEAM=yourteam.cloudflareaccess.com
   STUDIO_ACCESS_AUD=<the application's Audience tag>
   STUDIO_ACCESS_EMAILS=you@example.com
   ```

   The Audience tag is on the application's page, and also in the `kid=` part of the address an unsigned-in visit is redirected to.

How it works: Access adds a signed token (`Cf-Access-Jwt-Assertion`) to every request it lets through. The studio checks its signature against your team's public keys, the audience, the expiry and the email, and only then lets the request in without the studio token. A made-up or copied header fails the signature check. `STUDIO_ACCESS_EMAILS` is a second check on top of the Access policy.

`/api` stays behind Access: the editor in your browser uses it with your sign-in. A script that calls the API from outside needs an Access service token (Access controls > Service credentials) sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`, plus a Service Auth policy on the main application.

## 4. Keep it running

- Start the studio with the PC: a Task Scheduler task that runs `scripts/start-studio.vbs` at logon. The script starts `npm start` with no window and writes the output to `data/studio.log`. Register it once in PowerShell (adjust the path):

  ```powershell
  $a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"C:\path\to\yuv-studio\scripts\start-studio.vbs"'
  $t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'YUV Studio' -Action $a -Trigger $t -Settings $s
  ```

  It starts at logon only; if the studio crashes it stays down until the next logon or `Start-ScheduledTask 'YUV Studio'`.
- Keep the PC from sleeping while you are away.

## Linking it from your site

A page on your site (for example an AI Labs page) can simply link to `https://studio.example.com`. The studio itself keeps running on the PC; the site only holds the link. Nobody without the token gets past the login form.

## What is and is not protected

- With Cloudflare Access (section 3), your email sign-in is the lock for the browser and `/api`; the token still guards `/mcp`.
- The token is the lock. Anyone who has it can read any file on the PC through the studio's import-by-path feature, so treat it like a password and never commit `.env`.
- Requests whose `Host` is not on the allowed list are refused, and so are requests sent by other websites.
- The connection is encrypted by Cloudflare up to the tunnel; the last hop is inside your PC.
- This is built for one person. There are no user accounts and no per-project permissions.
