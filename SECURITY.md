# Security policy

YUV.AI Studio runs on your own computer and edits your own media, and it can be opened from other devices through a tunnel (docs/REMOTE.md). A bug in it can expose files, keys or the computer it runs on, so security reports are welcome and taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**.

Include what you can:

- the version (or commit) and how the studio was started (local only, or remote with `STUDIO_TOKEN` / Cloudflare Access);
- the steps to reproduce, and what an attacker gains;
- a proof of concept, if you have one.

You will get an answer within 7 days. When the issue is confirmed, the fix is released as soon as possible, and you are credited in the changelog unless you prefer not to be.

## Supported versions

Only the latest release gets security fixes.

## What is in scope

- Reading or changing projects, media, settings or keys without the access token when remote access is on.
- Reading files outside the studio's data folder, or running commands, through the REST API, the MCP server or uploaded media.
- Cross-site attacks against the editor (XSS, CSRF, clickjacking).
- Leaks of API keys stored in the studio's settings.

## Out of scope

- A local user, or an AI agent you connected yourself, doing what the studio's tools allow: the studio trusts whoever runs it on `127.0.0.1`.
- Exposing the studio to the internet without `STUDIO_TOKEN` or Cloudflare Access, against docs/REMOTE.md.
- Vulnerabilities in ffmpeg, Chrome, Python or other software the studio calls; please report those upstream.
