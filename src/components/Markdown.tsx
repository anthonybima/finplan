/** Small, safe Markdown renderer for Claude's answers (builds React elements; never injects HTML). */
import { Fragment, type ReactNode } from 'react';

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], k = `${key}-${n++}`;
    if (t.startsWith('**') || t.startsWith('__')) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) { const mm = t.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)!; out.push(<a key={k} href={mm[2]} target="_blank" rel="noreferrer noopener">{mm[1]}</a>); }
    else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) { const buf: string[] = []; i++; while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]); i++; blocks.push(<pre key={k++}><code>{buf.join('\n')}</code></pre>); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lvl = Math.min(4, h[1].length + 2); const T = (`h${lvl}`) as 'h3'; blocks.push(<T key={k++}>{inline(h[2])}</T>); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2; const body: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      blocks.push(<div key={k++} className="scroll-x"><table className="md-table"><thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{body.map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l); const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && (/^\s{2,}/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]) === ordered)) {
        const indent = /^\s{2,}/.test(lines[i]);
        const content = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '');
        items.push(<li key={items.length} style={indent ? { marginLeft: 18 } : undefined}>{inline(content)}</li>); i++;
      }
      blocks.push(ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>); continue;
    }
    if (/^>\s?/.test(l)) { const buf: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); blocks.push(<blockquote key={k++}>{inline(buf.join(' '))}</blockquote>); continue; }
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { blocks.push(<hr key={k++} />); i++; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s+|>\s?)/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) buf.push(lines[i++]);
    blocks.push(<p key={k++}>{buf.map((b, j) => <Fragment key={j}>{j > 0 && <br />}{inline(b, `p${k}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
