import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Rss } from 'lucide-react';
import type { ViewProps } from '../App';
import type { NewsItem } from '../lib/types';
import { loadCachedNews, NEWS_SOURCES, refreshNews, sourceOf, tagNews } from '../lib/news';
import { allocation } from '../lib/risk';
import { Card, Field, Modal, toast } from '../components/ui';
import { DEFAULT_FEEDS } from '../lib/store';

const RELEVANT: Record<string, string[]> = { stock: ['Stocks'], mutualfund: ['Stocks', 'Bonds'], bond: ['Bonds', 'Rates'], deposit: ['Rates'], gold: ['Gold'], crypto: ['Crypto'], property: ['Property', 'Rates'], cash: ['Inflation'] };

export default function News({ data, update }: ViewProps) {
  const cached = loadCachedNews();
  const [items, setItems] = useState<NewsItem[]>(cached?.items || []);
  const [at, setAt] = useState<number | null>(cached?.at || null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [tag, setTag] = useState('All');
  const [pub, setPub] = useState('All');
  const [feeds, setFeeds] = useState(false);

  const mine = useMemo(() => {
    const s = new Set<string>(['Inflation']);
    for (const r of allocation(data.accounts).rows) for (const t of RELEVANT[r.cls] || []) s.add(t);
    if (data.accounts.some((a) => a.kind === 'debt')) s.add('Rates');
    return s;
  }, [data.accounts]);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await refreshNews(data.settings.feeds);
      if (r.items.length) { setItems(r.items); setAt(r.at); }
      if (!r.items.length) setErr('Could not reach the news feeds. Check your internet connection; on the web version some networks block feed proxies — the desktop and mobile apps fetch feeds directly.');
      else if (r.failed) toast(`${r.failed} feed(s) unavailable`);
    } catch { setErr('News refresh failed.'); }
    setLoading(false);
  };
  useEffect(() => { if (!at || Date.now() - at > 30 * 60_000) load(); }, []);

  const tagged = useMemo(() => items.map((n) => ({ n, tags: tagNews(n) })), [items]);
  const allTags = ['All', 'For my portfolio', ...new Set(tagged.flatMap((x) => x.tags.map((t) => t.tag)))];
  const pubOf = (src: string) => NEWS_SOURCES.find((x) => x.publisher === src)?.publisher || 'More outlets';
  const pubs = ['All', ...new Set(items.map((n) => pubOf(n.source)))];
  const shown = tagged.filter((x) => pub === 'All' || pubOf(x.n.source) === pub).filter((x) => tag === 'All' || (tag === 'For my portfolio' ? x.tags.some((t) => mine.has(t.tag)) : x.tags.some((t) => t.tag === tag)));

  return (
    <>
      <div className="page-head">
        <div><h1>Financial news</h1><div className="sub">{at ? `Updated ${new Date(at).toLocaleString()}` : 'Not loaded yet'} · tagged by what it may affect</div></div>
        <div className="row"><button className="btn" onClick={() => setFeeds(true)}><Rss size={16} /> Sources</button>
          <button className="btn primary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> {loading ? 'Loading…' : 'Refresh'}</button></div>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        {pubs.map((p) => <button key={p} className={`chip ${pub === p ? 'on' : ''}`} onClick={() => setPub(p)}>{p}</button>)}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        {allTags.map((t) => <button key={t} className={`chip ${tag === t ? 'on' : ''}`} onClick={() => setTag(t)}>{t}</button>)}
      </div>
      {err && <div className="banner" style={{ background: 'var(--warn-soft)' }}>{err}</div>}
      <Card>
        {shown.map(({ n, tags }, i) => (
          <a key={i} className="news-item" href={n.link} target="_blank" rel="noreferrer">
            <div className="nt">{n.title}</div>
            {n.summary && <div className="small muted" style={{ marginTop: 3 }}>{n.summary}</div>}
            <div className="meta"><span><b>{n.source}</b>{n.section ? ` · ${n.section}` : ''}</span>{n.date && <span>· {new Date(n.date).toLocaleString()}</span>}
              {tags.map((t) => <span key={t.tag} className={`pill ${mine.has(t.tag) ? 'tip' : ''}`} title={t.why}>{t.tag}</span>)}</div>
          </a>
        ))}
        {!shown.length && <div className="empty">{loading ? 'Fetching headlines…' : 'No headlines for this filter.'}</div>}
      </Card>
      {feeds && <FeedsModal feeds={data.settings.feeds} onClose={() => setFeeds(false)} onSave={(f) => { update((d) => ({ ...d, settings: { ...d.settings, feeds: f } })); setFeeds(false); }} />}
    </>
  );
}

function FeedsModal({ feeds, onClose, onSave }: { feeds: string[]; onClose: () => void; onSave: (f: string[]) => void }) {
  const [on, setOn] = useState<Set<string>>(new Set(feeds.filter((f) => sourceOf(f))));
  const [custom, setCustom] = useState(feeds.filter((f) => !sourceOf(f)).join('\n'));
  const publishers = [...new Set(NEWS_SOURCES.map((n) => n.publisher))];
  const toggle = (u: string) => setOn((s) => { const x = new Set(s); x.has(u) ? x.delete(u) : x.add(u); return x; });
  return (
    <Modal title="News sources" onClose={onClose} wide>
      <p className="small muted" style={{ marginTop: 0 }}>Official RSS feeds: FinPlan shows headlines and the publisher's short summary; articles open on the publisher's site (WSJ, NYT and Bloomberg articles may need a subscription).</p>
      <div className="grid g2">
        {publishers.map((p) => (
          <div key={p} className="card" style={{ padding: 12 }}>
            <b>{p}</b>
            {NEWS_SOURCES.filter((n) => n.publisher === p).map((n) => (
              <label key={n.url} className="row small" style={{ marginTop: 6, gap: 8, flexWrap: 'nowrap' }}>
                <input type="checkbox" checked={on.has(n.url)} onChange={() => toggle(n.url)} /> {n.section}
              </label>
            ))}
          </div>
        ))}
      </div>
      <Field label="Other RSS/Atom feeds (one URL per line)" full>
        <textarea className="input" rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} placeholder="https://news.google.com/rss/search?q=reksadana&hl=id&gl=ID&ceid=ID:id" />
      </Field>
      <div className="row between mt"><button className="btn" onClick={() => { setOn(new Set(DEFAULT_FEEDS)); setCustom(''); }}>Reset defaults</button>
        <button className="btn primary" onClick={() => onSave([...on, ...custom.split('\n').map((x) => x.trim()).filter((x) => /^https:\/\//.test(x))])}>Save</button></div>
    </Modal>
  );
}
