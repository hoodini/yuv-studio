import { Bot, Check, ChevronDown, KeyRound, ListChecks, Loader2, Lock, Mic, PenLine, Pin, Play, RotateCcw, Send, Settings2, Sparkles, Square, Wrench, X } from 'lucide-react';
import { captureFrame } from '../stageCapture';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
import { useEffect, useRef, useState } from 'react';
import { agentFx } from '../agentFx';
import { useT } from '../i18n';
import { playback } from '../playback';
import { useReviewChanges } from '../review';
import { flushSave, useStore } from '../store';
import { ReviewCard } from './ReviewCard';

interface Provider {
  id: string;
  label: string;
  local: boolean;
  keyless: boolean;
  defaultModel: string;
  keyUrl: string;
  hasKey: boolean;
  keyHint: string;
}
interface Settings {
  provider: string;
  model: string;
  baseUrl: string;
  planMode: 'big' | 'always' | 'off';
  rules: string[];
  providers: Provider[];
}
type PlanState = 'open' | 'approved' | 'declined' | 'replaced';
type Item =
  | { kind: 'user'; text: string; image?: string; at?: number }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: any; ok?: boolean; blocked?: boolean; preview?: string }
  | { kind: 'plan'; summary: string; steps: string[]; state: PlanState }
  | { kind: 'error'; text: string };

const SUGGEST_HE = ['תסיר את השתיקות', 'תוסיף כתוביות בעברית', 'זום עדין על הפתיחה', 'כותרת "פרק 1" בסמן', 'תייצא לרילס'];
const SUGGEST_EN = ['Remove the silences', 'Add English captions', 'A gentle zoom on the opening', 'A "Chapter 1" title at the playhead', 'Export for Reels'];

/**
 * The AI agent, inside the editor. It edits the open project with the studio's own tools, so every change appears
 * on the timeline as it happens, and the user can keep editing by hand between messages.
 */
export function AgentTab() {
  const project = useStore((s) => s.project)!;
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const stop = useRef<AbortController | null>(null);
  /** The user cancelled the open plan: the next message tells the agent so. */
  const declined = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const changes = useReviewChanges();
  const reviewing = useStore((s) => !!s.review);
  const marks = useStore((s) => s.marks);
  const drawing = useStore((s) => s.drawing);
  const [showRules, setShowRules] = useState(false);
  const [newRule, setNewRule] = useState('');
  /** Voice note: recording, then being transcribed by the studio's own engine. */
  const [voice, setVoice] = useState<'' | 'rec' | 'text'>('');
  const rec = useRef<MediaRecorder | null>(null);
  const toggleVoice = async () => {
    if (voice === 'rec') return void rec.current?.stop();
    if (voice) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return useStore.getState().notify(L('אין גישה למיקרופון. צריך לאשר אותה בדפדפן.', 'No access to the microphone. Allow it in the browser.'));
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    rec.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setVoice('text');
      try {
        const res = await fetch(`/api/voice-note?lang=${isHe ? 'he' : 'en'}`, { method: 'POST', headers: { 'content-type': r.mimeType || 'audio/webm' }, body: new Blob(chunks, { type: r.mimeType || 'audio/webm' }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        if (data.text) setText((cur) => (cur.trim() ? `${cur.trim()} ${data.text}` : data.text));
        else useStore.getState().notify(L('לא נשמע דיבור בהקלטה', 'No speech was heard in the recording'));
      } catch (e: any) {
        useStore.getState().notify(String(e.message || e));
      }
      setVoice('');
    };
    r.start();
    setVoice('rec');
  };
  const saveRules = (rules: string[]) => void save({ rules });
  // The editor glows while the agent works, also between tools while the model thinks.
  useEffect(() => {
    agentFx.setThinking(busy);
    return () => agentFx.setThinking(false);
  }, [busy]);
  // Nothing left to review once the turn is over: close the review.
  useEffect(() => {
    if (reviewing && !busy && !changes.length) useStore.setState({ review: null, hoverChange: null });
  }, [reviewing, busy, changes.length]);

  const load = () =>
    fetch('/api/agent/settings')
      .then((r) => r.json())
      .then((s: Settings) => {
        setSettings(s);
      });
  useEffect(() => void load(), []);
  useEffect(() => void setItems([]), [project.id]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [items]);

  const provider = settings?.providers.find((p) => p.id === settings.provider);
  const ready = !!(settings && provider && (provider.keyless || provider.hasKey) && (settings.model || provider.defaultModel));
  const save = async (patch: Record<string, any>) => {
    const res = await fetch('/api/agent/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    const data = await res.json();
    if (!res.ok) return useStore.getState().notify(data.error || 'Error');
    setSettings(data);
  };
  const loadModels = async () => {
    const res = await fetch('/api/agent/models');
    const data = await res.json();
    if (!res.ok) return useStore.getState().notify(data.error || 'Error');
    setModels(data);
  };

  const send = async (msg = text, approve = false) => {
    const m = msg.trim();
    if (!m || busy) return;
    if (!ready) {
      setShowSettings(true);
      useStore.getState().notify(L('קודם מחברים מודל: ספק ומפתח, או מודל מקומי', 'Connect a model first: a provider and key, or a local model'));
      return;
    }
    setText('');
    // A drawing on the frame goes with this message: the strokes, the clips under them and a picture of the frame.
    const marks = useStore.getState().marks;
    const shot = marks ? await captureFrame(marks) : null;
    if (marks) useStore.getState().set({ marks: null, drawing: false });
    // A new request instead of an answer replaces a plan still waiting.
    setItems((x) => [...x.map((it) => (it.kind === 'plan' && it.state === 'open' ? { ...it, state: approve ? ('approved' as const) : ('replaced' as const) } : it)), { kind: 'user', text: m, image: shot?.image || undefined, at: marks?.t }]);
    const wasDeclined = declined.current;
    declined.current = false;
    setBusy(true);
    await flushSave();
    const ctrl = new AbortController();
    stop.current = ctrl;
    try {
      const res = await fetch(`/api/projects/${project.id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: m, playhead: playback.time, selection: useStore.getState().selection, approve, declined: wasDeclined, marks: marks ? { t: marks.t, strokes: marks.strokes, items: shot?.items || [], image: shot?.image || undefined } : undefined }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || res.statusText);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === 'text') setItems((x) => [...x, { kind: 'text', text: e.text }]);
          else if (e.type === 'tool') setItems((x) => [...x, { kind: 'tool', name: e.name, input: e.input }]);
          else if (e.type === 'result')
            setItems((x) => {
              const out = [...x];
              for (let i = out.length - 1; i >= 0; i--) {
                const it = out[i];
                if (it.kind === 'tool' && it.name === e.name && it.ok === undefined) {
                  out[i] = { ...it, ok: e.ok, blocked: !!e.blocked, preview: e.preview };
                  break;
                }
              }
              return out;
            });
          else if (e.type === 'error') setItems((x) => [...x, { kind: 'error', text: e.error }]);
          else if (e.type === 'rules') setSettings((s) => (s ? { ...s, rules: e.rules } : s));
          else if (e.type === 'plan') setItems((x) => [...x, { kind: 'plan', summary: e.summary, steps: e.steps, state: 'open' }]);
          else if ((e.type === 'start' || e.type === 'done') && e.snapshot) void useStore.getState().startReview(e.snapshot);
        }
      }
    } catch (e: any) {
      if (!ctrl.signal.aborted) setItems((x) => [...x, { kind: 'error', text: String(e.message || e) }]);
    } finally {
      // The agent's last edits may still be on their way through the live updates: load them before the turn
      // counts as over, or the review would look empty and close.
      await useStore.getState().reload().catch(() => {});
      setBusy(false);
      stop.current = null;
    }
  };
  const answerPlan = (plan: Item & { kind: 'plan' }, state: 'approved' | 'declined') => {
    if (state === 'approved') return void send(L('מאושר, קדימה.', 'Approved, go ahead.'), true);
    declined.current = true;
    setItems((x) => x.map((it) => (it === plan ? { ...plan, state } : it)));
  };
  const reset = async () => {
    stop.current?.abort();
    await fetch(`/api/projects/${project.id}/chat`, { method: 'DELETE' });
    setItems([]);
  };

  if (!settings) return <div className="tab-body" />;
  return (
    <div className="tab-body agent-tab">
      <div className="engine-row">
        <span className={`engine-chip${ready ? '' : ' warn'}`}>
          <Bot size={14} />
          <span dir="ltr">{provider ? `${provider.label} · ${settings.model || provider.defaultModel || L('בחרו מודל', 'pick a model')}` : ''}</span>
        </span>
        <button className="mini" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings} title={L('הגדרות הסוכן', 'Agent settings')} aria-label={L('הגדרות הסוכן', 'Agent settings')}>
          <Settings2 size={15} />
        </button>
        <button className={`mini rules-btn${showRules ? ' active' : ''}`} onClick={() => setShowRules(!showRules)} aria-expanded={showRules} title={L('כללים קבועים לסוכן', 'Standing rules for the agent')} aria-label={L('כללים קבועים לסוכן', 'Standing rules for the agent')}>
          <Pin size={14} />
          {settings.rules.length > 0 && <b>{settings.rules.length}</b>}
        </button>
        <button className="mini" onClick={reset} disabled={!items.length} title={L('שיחה חדשה', 'New chat')} aria-label={L('שיחה חדשה', 'New chat')}>
          <RotateCcw size={15} />
        </button>
      </div>

      {showRules && (
        <div className="engine-box rules-box" role="region" aria-label={L('כללים קבועים', 'Standing rules')}>
          <strong>{L('כללים קבועים', 'Standing rules')}</strong>
          <p className="hint">{L('הסוכן שומר עליהם בכל עריכה ובכל פרויקט. אפשר גם להגיד לו "מעכשיו תמיד..." או "אף פעם אל...", והוא יוסיף כלל לבד.', 'The agent keeps to them in every edit and project. You can also tell it "from now on always…" or "never…", and it adds the rule itself.')}</p>
          {settings.rules.map((r, i) => (
            <div key={i} className="rule-row">
              <span dir="auto">{r}</span>
              <button className="mini" onClick={() => saveRules(settings.rules.filter((_, j) => j !== i))} aria-label={L('מחיקת הכלל', 'Delete the rule')} title={L('מחיקת הכלל', 'Delete the rule')}>
                <X size={13} />
              </button>
            </div>
          ))}
          <form
            className="replace-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newRule.trim()) return;
              saveRules([...settings.rules, newRule.trim()]);
              setNewRule('');
            }}
          >
            <input dir="auto" value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder={L('למשל: אף פעם לא אותו אפקט קול פעמיים', 'e.g. Never use the same sound effect twice')} />
            <button className="mini" type="submit" disabled={!newRule.trim()} aria-label={L('הוספה', 'Add')} title={L('הוספה', 'Add')}>
              <Check size={15} />
            </button>
          </form>
        </div>
      )}

      {showSettings && (
        <div className="engine-box agent-settings-sheet" role="dialog" aria-label={L('הגדרות הסוכן', 'Agent settings')}>
          <div className="sheet-head">
            <strong>{L('חיבור מודל לסוכן', 'Connect a model')}</strong>
            <button className="mini" onClick={() => setShowSettings(false)} title={L('סגירה', 'Close')} aria-label={L('סגירה', 'Close')}>
              <X size={15} />
            </button>
          </div>
          <label className="select">
            <span>{L('ספק', 'Provider')}</span>
            <select value={settings.provider} onChange={(e) => (setModels([]), setKey(''), void save({ provider: e.target.value }))}>
              {settings.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.hasKey ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </label>
          {provider && !provider.keyless && (
            <label className="select">
              <span>
                {L('מפתח API', 'API key')} {provider.hasKey && <em dir="ltr">({provider.keyHint})</em>}
              </span>
              <div className="replace-row">
                <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider.hasKey ? L('להחלפת המפתח', 'Replace the key') : L('הדביקו מפתח', 'Paste a key')} />
                <button className="mini" disabled={!key.trim()} onClick={() => (void save({ key }), setKey(''))} title={L('שמירה', 'Save')} aria-label={L('שמירה', 'Save')}>
                  <Check size={15} />
                </button>
              </div>
              {provider.keyUrl && (
                <a className="link-btn" href={provider.keyUrl} target="_blank" rel="noreferrer">
                  {L('איפה משיגים מפתח', 'Where to get a key')}
                </a>
              )}
            </label>
          )}
          {provider && (provider.local || provider.id === 'custom') && (
            <label className="select">
              <span>{L('כתובת השרת', 'Server address')}</span>
              <input className="text-input" dir="ltr" defaultValue={settings.baseUrl} placeholder={provider.id === 'custom' ? 'http://127.0.0.1:8000/v1' : L('ברירת מחדל', 'default')} onBlur={(e) => void save({ baseUrl: e.target.value })} />
            </label>
          )}
          <label className="select">
            <span>{L('תוכנית לפני עריכה', 'Plan before editing')}</span>
            <select value={settings.planMode} onChange={(e) => void save({ planMode: e.target.value })}>
              <option value="big">{L('רק לפני עריכה גדולה (מומלץ)', 'Only before big edits (recommended)')}</option>
              <option value="always">{L('תמיד, לפני כל שינוי', 'Always, before any change')}</option>
              <option value="off">{L('אף פעם', 'Never')}</option>
            </select>
          </label>
          <label className="select">
            <span>{L('מודל', 'Model')}</span>
            <div className="replace-row">
              <input dir="ltr" list="agent-models" defaultValue={settings.model} key={settings.provider} placeholder={provider?.defaultModel || L('שם המודל', 'model name')} onBlur={(e) => void save({ model: e.target.value })} />
              <button className="mini" onClick={loadModels} title={L('טעינת רשימת המודלים', 'Load the model list')} aria-label={L('טעינת רשימת המודלים', 'Load the model list')}>
                <ChevronDown size={15} />
              </button>
            </div>
            <datalist id="agent-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <p className="hint">{L('המפתח נשמר רק במחשב הזה. הסוכן עורך עם אותם כלים של ה-MCP, וכל שינוי מופיע בעורך מיד.', 'The key stays on this computer. The agent edits with the same tools as the MCP server, and every change shows up in the editor at once.')}</p>
          {ready && (
            <button className="pill sm strong" onClick={() => setShowSettings(false)}>
              <Check size={14} /> {L('מוכן, לצ׳אט', 'Ready, back to the chat')}
            </button>
          )}
        </div>
      )}

      <div className="agent-log" ref={log} aria-live="polite">
        {!items.length && !ready && (
          <div className="agent-connect">
            <Sparkles size={22} />
            <strong>{L('צ׳אט עם סוכן שעורך בשבילכם', 'Chat with an agent that edits for you')}</strong>
            <p>{L('כותבים בשפה רגילה, למשל "תסיר את השתיקות ותוסיף כתוביות", והסוכן עורך את הפרויקט מול העיניים. קודם מחברים מודל: Claude, OpenAI או אחר עם מפתח משלכם, או מודל שרץ על המחשב (Ollama, LM Studio).', 'Write in plain words, for example "remove the silences and add captions", and the agent edits the project while you watch. First connect a model: Claude, OpenAI or another with your own key, or a model running on this computer (Ollama, LM Studio).')}</p>
            <button className="pill-white" onClick={() => setShowSettings(true)}>
              <KeyRound size={14} /> {L('חיבור מודל', 'Connect a model')}
            </button>
          </div>
        )}
        {!items.length && ready && (
          <div className="agent-empty">
            <p className="hint">{L('בקשו עריכה במילים. אפשר לעצור בכל רגע ולהמשיך לערוך ידנית.', 'Ask for an edit in plain words. Stop at any moment and carry on by hand.')}</p>
            <div className="chip-row wrap">
              {(isHe ? SUGGEST_HE : SUGGEST_EN).map((s) => (
                <button key={s} className="chip-btn" onClick={() => void send(s)} disabled={!ready || busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) =>
          it.kind === 'user' ? (
            <div key={i} className="msg msg-user" dir="auto">
              {it.image && <img className="msg-shot" src={it.image} alt={L('הפריים עם הסימון', 'The frame with the drawing')} />}
              {it.at != null && (
                <span className="msg-mark" dir="ltr">
                  <PenLine size={12} /> {fmtTime(it.at)}
                </span>
              )}
              {it.text}
            </div>
          ) : it.kind === 'text' ? (
            <div key={i} className="msg msg-ai" dir="auto">
              {it.text}
            </div>
          ) : it.kind === 'plan' ? (
            <section key={i} className={`plan-card plan-${it.state}`} aria-label={L('התוכנית של הסוכן', "The agent's plan")}>
              <header>
                <ListChecks size={15} />
                <strong>{L('תוכנית לאישור', 'Plan to approve')}</strong>
                {it.state !== 'open' && <span className="plan-state">{it.state === 'approved' ? L('אושרה', 'Approved') : it.state === 'declined' ? L('בוטלה', 'Cancelled') : L('הוחלפה בבקשה חדשה', 'Replaced by a new request')}</span>}
              </header>
              {it.summary && (
                <p className="plan-summary" dir="auto">
                  {it.summary}
                </p>
              )}
              <ol>
                {it.steps.map((st, n) => (
                  <li key={n} dir="auto">
                    {st}
                  </li>
                ))}
              </ol>
              {it.state === 'open' && (
                <>
                  <div className="plan-actions">
                    <button className="pill-white" disabled={busy} onClick={() => answerPlan(it, 'approved')}>
                      <Play size={13} /> {L('לאשר ולבצע', 'Approve and run')}
                    </button>
                    <button className="pill-ghost" disabled={busy} onClick={() => answerPlan(it, 'declined')}>
                      <X size={13} /> {L('ביטול', 'Cancel')}
                    </button>
                  </div>
                  <p className="hint">{L('או כתבו למטה מה לשנות בתוכנית.', 'Or write below what to change in it.')}</p>
                </>
              )}
            </section>
          ) : it.kind === 'error' ? (
            <div key={i} className="msg msg-error" dir="auto">
              {it.text}
            </div>
          ) : (
            <details key={i} className={`tool-call${it.blocked ? ' blocked' : it.ok === false ? ' bad' : ''}`}>
              <summary dir="ltr">
                {it.ok === undefined ? <Loader2 className="spin" size={13} /> : it.blocked ? <Lock size={13} /> : it.ok ? <Check size={13} /> : <X size={13} />}
                <Wrench size={12} />
                <code>{it.name}</code>
              </summary>
              <pre dir="ltr">{JSON.stringify(it.input, null, 1)}</pre>
              {it.preview && <pre dir="ltr">{it.preview}</pre>}
            </details>
          ),
        )}
      </div>

      <ReviewCard changes={changes} busy={busy} />

      {(marks || drawing) && (
        <div className={`mark-chip${marks ? ' has' : ''}`}>
          <PenLine size={14} />
          <span>
            {marks
              ? L(`סימון על הפריים ב-${fmtTime(marks.t)} (${marks.strokes.length}) יישלח עם ההודעה`, `A drawing at ${fmtTime(marks.t)} (${marks.strokes.length}) goes with your message`)
              : L('מציירים על הפריים: להקיף מה לשנות, או למתוח קו לאן להזיז', 'Drawing on the frame: circle what to change, or draw a line to where it goes')}
          </span>
          {drawing && (
            <button className="link-btn" onClick={() => useStore.getState().set({ drawing: false })}>
              {L('סיום', 'Done')}
            </button>
          )}
          {marks && (
            <button className="mini" onClick={() => useStore.getState().set({ marks: null })} aria-label={L('מחיקת הסימון', 'Clear the drawing')} title={L('מחיקת הסימון', 'Clear the drawing')}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div className="agent-input">
        <button
          className={`send-btn mic-btn${voice === 'rec' ? ' rec' : ''}`}
          onClick={() => void toggleVoice()}
          disabled={voice === 'text'}
          title={voice === 'rec' ? L('עצירה ותמלול', 'Stop and transcribe') : L('הודעה קולית', 'Voice note')}
          aria-label={voice === 'rec' ? L('עצירה ותמלול', 'Stop and transcribe') : L('הודעה קולית', 'Voice note')}
        >
          {voice === 'text' ? <Loader2 className="spin" size={16} /> : voice === 'rec' ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
        </button>
        <textarea
          dir="auto"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send())}
          placeholder={ready ? L('מה לערוך? Enter לשליחה, Shift+Enter לשורה חדשה', 'What should I edit? Enter sends, Shift+Enter for a new line') : L('כתבו מה לערוך (קודם מחברים מודל)', 'Write what to edit (connect a model first)')}
        />
        {busy ? (
          <button className="send-btn" onClick={() => stop.current?.abort()} title={L('עצירה', 'Stop')} aria-label={L('עצירה', 'Stop')}>
            <Square size={16} />
          </button>
        ) : (
          <button className="send-btn" onClick={() => void send()} disabled={!text.trim()} title={L('שליחה', 'Send')} aria-label={L('שליחה', 'Send')}>
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
