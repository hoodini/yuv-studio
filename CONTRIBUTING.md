# Contributing

Thanks for helping with YUV.AI Studio. Bug reports, fixes, translations and documentation are all welcome.

## Before you start

- **Bigger changes:** open an issue first and describe what you want to change, so no one does the work twice and the design fits the studio.
- **Security bugs:** never in a public issue. See [SECURITY.md](SECURITY.md).
- **The CLA:** your first pull request asks you to sign the [Contributor License Agreement](CLA.md) with one comment. It lets the project offer a commercial license and a hosted version next to the AGPL; you keep the copyright in what you wrote.

## Run it

```bash
npm install
npm run dev
```

The editor opens on http://localhost:5177. You also need ffmpeg on the PATH and Chrome or Edge installed (for exporting titles). See the README for transcription and the optional keys.

## Check your change

```bash
npx tsc --noEmit
npm run test:diff
npm run test:edit
npm run build
```

All four must pass. Then try the change in the editor itself, in Hebrew (right to left) and in English.

## Style

- TypeScript, strict. Match the formatting of the code around your change (2 spaces, single quotes, long lines are fine).
- Every edit goes through the operations in `shared/ops.ts`, so the editor, the REST API and the MCP server all see the same change. A new feature usually needs an operation, a REST route, an MCP tool and a line in `docs/API.md` / `docs/MCP.md`.
- Interface text is in both Hebrew and English (`src/i18n.ts`).
- One logical change per pull request, with a description of what changed and why.

## The name and logo

Contributions to the code are welcome; the names "YUV.AI" / "YUV.AI Studio" and the phoenix logo are trademarks and stay out of forks. See [TRADEMARK.md](TRADEMARK.md).
