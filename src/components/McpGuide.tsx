import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';

/**
 * How to connect the studio's MCP server to each AI client, with the address of this studio filled in.
 * Checked against each vendor's documentation on 13.11.2026 (docs/MCP.md has the sources).
 */
export function McpGuide() {
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const url = `${location.origin}/mcp`;
  const remote = !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(location.host);
  const auth = remote ? 'Bearer <token>' : '';
  const CLIENTS: { id: string; label: string; steps: [string, string][] }[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      steps: [
        [L('בטרמינל:', 'In a terminal:'), `claude mcp add --transport http --scope user yuv-studio ${url}${remote ? ` --header "Authorization: ${auth}"` : ''}`],
        [L('בדיקה:', 'Check:'), 'claude mcp list'],
      ],
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      steps: remote
        ? [
            [L('Settings > Connectors > Add custom connector, עם הכתובת הזו. ב-Authentication בחרו No sign-in, וב-Request headers הוסיפו authorization:', 'Settings > Connectors > Add custom connector with this address. Authentication: No sign-in; under Request headers add authorization:'), `${url}\n\nauthorization: ${auth}`],
            [L('אם אין אצלכם Request headers (בטא), הוסיפו ל-claude_desktop_config.json גשר mcp-remote:', 'If Request headers (beta) is missing for you, add an mcp-remote bridge to claude_desktop_config.json:'), JSON.stringify({ mcpServers: { 'yuv-studio': { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'], env: { AUTH_HEADER: auth } } } }, null, 2)],
          ]
        : [
            [L('Settings > Developer > Edit Config, ואז הוסיפו לקובץ claude_desktop_config.json (שימו את התיקייה של הסטודיו):', 'Settings > Developer > Edit Config, then add to claude_desktop_config.json (use your studio folder):'), JSON.stringify({ mcpServers: { 'yuv-studio': { command: 'npm', args: ['--silent', '--prefix', 'C:\\path\\to\\yuv-studio', 'run', 'mcp'] } } }, null, 2)],
            [L('הפעילו מחדש את Claude Desktop לגמרי.', 'Quit and reopen Claude Desktop.'), ''],
          ],
    },
    {
      id: 'codex',
      label: 'Codex (OpenAI)',
      steps: [
        [L('בטרמינל:', 'In a terminal:'), remote ? `codex mcp add yuv-studio --url ${url} --bearer-token-env-var YUV_STUDIO_TOKEN` : `codex mcp add yuv-studio --url ${url}`],
        [L('או ב-~/.codex/config.toml:', 'Or in ~/.codex/config.toml:'), `[mcp_servers.yuv-studio]\nurl = "${url}"${remote ? '\nbearer_token_env_var = "YUV_STUDIO_TOKEN"' : ''}`],
        [L('בדיקה:', 'Check:'), 'codex mcp list'],
      ],
    },
    {
      id: 'cursor',
      label: 'Cursor',
      steps: [[L('ב-~/.cursor/mcp.json:', 'In ~/.cursor/mcp.json:'), JSON.stringify({ mcpServers: { 'yuv-studio': { url, ...(remote ? { headers: { Authorization: 'Bearer ${env:YUV_STUDIO_TOKEN}' } } : {}) } } }, null, 2)]],
    },
    {
      id: 'vscode',
      label: 'VS Code · Copilot',
      steps: [[L('ב-~/.copilot/mcp-config.json:', 'In ~/.copilot/mcp-config.json:'), JSON.stringify({ mcpServers: { 'yuv-studio': { type: 'http', url, ...(remote ? { headers: { Authorization: 'Bearer ${YUV_STUDIO_TOKEN}' } } : {}), tools: ['*'] } } }, null, 2)]],
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      steps: [
        [L('בטרמינל:', 'In a terminal:'), `gemini mcp add -s user -t http ${remote ? `-H "Authorization: ${auth}" ` : ''}yuv-studio ${url}`],
        [L('בדיקה:', 'Check:'), 'gemini mcp list'],
      ],
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      steps: [
        [
          L(
            'ChatGPT מתחבר מהענן, ולכן לא מגיע ל-127.0.0.1, ואין בו שדה לטוקן קבוע (רק OAuth או בלי אימות). כרגע אין לו דרך בטוחה להתחבר לסטודיו. השתמשו ב-Codex במקום.',
            'ChatGPT connects from the cloud, so it cannot reach 127.0.0.1, and it has no field for a fixed token (only OAuth or none). There is no safe way to connect it to the studio yet. Use Codex instead.',
          ),
          '',
        ],
      ],
    },
  ];
  const [tab, setTab] = useState(CLIENTS[0].id);
  const [copied, setCopied] = useState('');
  const c = CLIENTS.find((x) => x.id === tab)!;
  return (
    <div className="mcp-guide">
      <div className="chip-row wrap" role="tablist">
        {CLIENTS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={`chip-btn${tab === x.id ? ' active' : ''}`} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {c.steps.map(([label, code], i) => (
        <div key={i} className="mcp-step">
          <p className="hint">{label}</p>
          {code && (
            <div className="code-wrap">
              <pre dir="ltr">{code}</pre>
              <button className="mini" onClick={() => (void navigator.clipboard.writeText(code), setCopied(`${tab}${i}`))} title={L('העתקה', 'Copy')} aria-label={L('העתקה', 'Copy')}>
                {copied === `${tab}${i}` ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
      ))}
      {remote && <p className="hint">{L('את <token> מחליפים בטוקן הגישה של הסטודיו (STUDIO_TOKEN בקובץ ‎.env). אל תשמרו אותו בקובץ שמשותף עם אחרים.', 'Replace <token> with the studio access token (STUDIO_TOKEN in .env). Keep it out of files you share.')}</p>}
    </div>
  );
}
