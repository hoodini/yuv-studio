// stdio launcher for MCP clients that start a process: `npx tsx server/mcp-stdio.ts`.
// It talks to the running studio server (STUDIO_URL, default http://127.0.0.1:5177).
// For a studio reached over the internet, set STUDIO_URL to its https address and STUDIO_TOKEN to the access token.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcp } from './mcp';

const base = (process.env.STUDIO_URL || 'http://127.0.0.1:5177').replace(/\/$/, '');
await createMcp(base, process.env.STUDIO_TOKEN || '').connect(new StdioServerTransport());
