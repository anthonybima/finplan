import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, Square, RotateCcw, Settings2, Eye, ShieldCheck, Sparkles, KeyRound } from 'lucide-react';
import type { ViewProps } from '../App';
import { toast } from '../components/ui';
import Markdown from '../components/Markdown';
import { KeySetup } from '../components/SmartScan';
import { availableEngines, anthropicChat, claudeChat, DEFAULT_MODEL, type Engines } from '../lib/smartScan';
import { buildContext, SUGGESTIONS, SYSTEM } from '../lib/aiContext';

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean };
// The conversation lives in memory only (never saved to disk or synced); it survives page switches until the app closes.
let memo: Msg[] = [];
let opts = { includeNames: true, includeTxns: true };

export default function AskClaude({ data, preset, onPresetUsed }: ViewProps & { preset?: string | null; onPresetUsed?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>(memo);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const [eng, setEng] = useState<Engines | null>(null);
  const [o, setO] = useState(opts);
  const [showKey, setShowKey] = useState(false);
  const [peek, setPeek] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const liveRef = useRef('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { memo = msgs; }, [msgs]);
  useEffect(() => { opts = o; }, [o]);
  const refresh = () => availableEngines().then(setEng);
  useEffect(() => { refresh(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs, live]);

  const engine: 'claude' | 'api' | null = eng?.claude ? 'claude' : eng?.api ? 'api' : null;
  const ctxJson = useMemo(() => JSON.stringify(buildContext(data, o)), [data, o]);

  const send = async (q0?: string) => {
    const q = (q0 ?? input).trim();
    if (!q || busy) return;
    if (!engine) { setShowKey(true); toast('Set up Claude first'); return; }
    const history = [...msgs.filter((m) => !m.error), { role: 'user' as const, content: q }];
    setMsgs([...msgs, { role: 'user', content: q }]); setInput(''); setBusy(true); setLive(''); liveRef.current = '';
    const turns = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const dataNote = `FinPlan data snapshot (JSON):\n${ctxJson}`;
    try {
      let answer: string;
      if (engine === 'claude') {
        ctl.current = new AbortController();
        answer = await claudeChat([{ role: 'user', content: `${SYSTEM}\n\n${dataNote}` }, ...turns], (t) => { liveRef.current = t; setLive(t); }, ctl.current.signal);
      } else {
        answer = await anthropicChat(`${SYSTEM}\n\n${dataNote}`, turns);
      }
      setMsgs((m) => [...m, { role: 'assistant', content: answer }]);
    } catch (e: any) {
      const partial = liveRef.current;
      setMsgs((m) => [...m, ...(partial ? [{ role: 'assistant' as const, content: partial }] : []), { role: 'assistant', content: e?.message || 'Claude could not answer', error: true }]);
    }
    setBusy(false); setLive('');
  };
  useEffect(() => { if (preset && eng) { onPresetUsed?.(); send(preset); } }, [preset, eng]);

  return (
    <div className="page ask">
      <div className="page-head">
        <div><h1><Bot size={24} style={{ verticalAlign: -4 }} /> Ask Claude</h1><div className="sub">Analysis of your own numbers: spending, debts, goals, portfolio and risk</div></div>
        <div className="row">
          <span className={`pill ${engine ? 'good' : ''}`}>{engine === 'claude' ? 'Claude · your Claude account' : engine === 'api' ? `Claude API · ${eng?.apiModel || DEFAULT_MODEL}` : 'Not set up'}</span>
          {msgs.length > 0 && <button className="btn sm" disabled={busy} onClick={() => setMsgs([])}><RotateCcw size={14} /> New chat</button>}
          {!eng?.claude && <button className="btn sm" onClick={() => setShowKey((v) => !v)}><Settings2 size={14} /> Settings</button>}
        </div>
      </div>

      {(showKey || (eng && !engine)) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}><KeyRound size={14} style={{ verticalAlign: -2 }} /> Connect Claude</div>
          <p className="small muted" style={{ margin: '0 0 8px' }}>Inside the Claude app this works with your Claude account automatically. On the website or the installed app, add your own Claude API key (console.anthropic.com, pay-as-you-go: a typical question costs about Rp 200–800). The key is encrypted in your vault and only sent to api.anthropic.com. It's the same key Smart scan uses.</p>
          <KeySetup onSaved={() => { setShowKey(false); refresh(); }} hasKey={!!eng?.api} model={eng?.apiModel || DEFAULT_MODEL} />
        </div>
      )}

      <div className="card ask-card">
        <div className="ask-log">
          {msgs.length === 0 && !busy && (
            <div className="ask-empty">
              <Sparkles size={28} color="var(--brand)" />
              <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>What would you like to know?</div>
              <div className="small muted" style={{ marginBottom: 12 }}>Claude reads a snapshot of your FinPlan data (balances, portfolio, cash flow, budgets, goals, risk) and answers with your numbers.</div>
              <div className="ask-sugg">{SUGGESTIONS.map((s) => <button key={s} className="chip-btn" disabled={!engine} onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role} ${m.error ? 'err' : ''}`}>
              {m.role === 'assistant' ? (m.error ? <span>{m.content}</span> : <Markdown text={m.content} />) : <span>{m.content}</span>}
            </div>
          ))}
          {busy && <div className="msg assistant">{live ? <Markdown text={live} /> : <span className="muted"><Sparkles size={14} className="spin" /> Claude is looking at your numbers…</span>}</div>}
          <div ref={end} />
        </div>
        <div className="ask-input">
          <textarea className="input" rows={2} value={input} placeholder={engine ? 'Ask about your money… (Enter to send, Shift+Enter for a new line)' : 'Set up Claude to start'}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={!engine} />
          {busy && engine === 'claude' ? <button className="btn" onClick={() => ctl.current?.abort()}><Square size={15} /> Stop</button>
            : <button className="btn primary" disabled={!engine || busy || !input.trim()} onClick={() => send()}><Send size={15} /> Send</button>}
        </div>
        <div className="ask-privacy small muted">
          <ShieldCheck size={13} style={{ verticalAlign: -2 }} /> Sent with each question:
          <label><input type="checkbox" checked={o.includeNames} onChange={(e) => setO({ ...o, includeNames: e.target.checked })} /> account & goal names</label>
          <label><input type="checkbox" checked={o.includeTxns} onChange={(e) => setO({ ...o, includeTxns: e.target.checked })} /> recent transactions (60)</label>
          <button className="linklike" onClick={() => setPeek((v) => !v)}><Eye size={13} style={{ verticalAlign: -2 }} /> {peek ? 'Hide' : 'See'} what Claude sees ({Math.round(ctxJson.length / 1024)} KB)</button>
          <span>· Never sent: passwords, API keys, account numbers. Chats aren't saved.</span>
        </div>
        {peek && <pre className="ask-peek">{JSON.stringify(JSON.parse(ctxJson), null, 2)}</pre>}
      </div>
      <p className="small muted">Claude's answers are educational analysis based on your data and FinPlan's model assumptions, not licensed financial advice.</p>
    </div>
  );
}
