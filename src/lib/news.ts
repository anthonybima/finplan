import type { NewsItem } from './types';

import { fetchText } from './net';

/** Official publisher RSS feeds (headlines + short summaries; full articles open on the publisher's site). */
export interface NewsSource { url: string; publisher: string; section: string; on?: boolean }
export const NEWS_SOURCES: NewsSource[] = [
  { publisher: 'Wall Street Journal', section: 'Markets', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', on: true },
  { publisher: 'Wall Street Journal', section: 'Economy', url: 'https://feeds.content.dowjones.io/public/rss/socialeconomyfeed', on: true },
  { publisher: 'Wall Street Journal', section: 'US Business', url: 'https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness' },
  { publisher: 'Wall Street Journal', section: 'Personal Finance', url: 'https://feeds.content.dowjones.io/public/rss/RSSPersonalFinance' },
  { publisher: 'New York Times', section: 'Business', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', on: true },
  { publisher: 'New York Times', section: 'Economy', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml', on: true },
  { publisher: 'New York Times', section: 'DealBook', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml' },
  { publisher: 'Bloomberg', section: 'Markets', url: 'https://www.bloomberg.com/feeds/markets/news.rss', on: true },
  { publisher: 'Bloomberg', section: 'Economics', url: 'https://www.bloomberg.com/feeds/economics/news.rss', on: true },
  { publisher: 'Bloomberg', section: 'Technology', url: 'https://www.bloomberg.com/feeds/technology/news.rss' },
  { publisher: 'Bloomberg', section: 'Crypto', url: 'https://www.bloomberg.com/feeds/crypto/news.rss' },
  { publisher: 'Investing.com', section: 'Stock market', url: 'https://www.investing.com/rss/news_25.rss', on: true },
  { publisher: 'Investing.com', section: 'Economy', url: 'https://www.investing.com/rss/news_14.rss' },
  { publisher: 'Investing.com', section: 'Forex', url: 'https://www.investing.com/rss/news_1.rss' },
  { publisher: 'Investing.com', section: 'Commodities', url: 'https://www.investing.com/rss/news_11.rss', on: true },
  { publisher: 'Investing.com', section: 'Crypto', url: 'https://www.investing.com/rss/news_301.rss' },
  { publisher: 'CNBC Indonesia', section: 'Market', url: 'https://www.cnbcindonesia.com/market/rss', on: true },
  { publisher: 'Google News', section: 'IHSG & Bank Indonesia', url: 'https://news.google.com/rss/search?q=IHSG+OR+saham+OR+%22Bank+Indonesia%22&hl=id&gl=ID&ceid=ID:id', on: true },
  { publisher: 'Google News', section: 'Ekonomi & rupiah', url: 'https://news.google.com/rss/search?q=ekonomi+indonesia+rupiah&hl=id&gl=ID&ceid=ID:id', on: true },
  { publisher: 'Google News', section: 'Global markets', url: 'https://news.google.com/rss/search?q=stock+market+OR+federal+reserve+OR+inflation&hl=en-US&gl=US&ceid=US:en' },
];
export const sourceOf = (url: string) => NEWS_SOURCES.find((n) => n.url === url);

function strip(html: string) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

export function parseFeed(xml: string, fallbackSource: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = [...doc.querySelectorAll('item, entry')];
  return items.map((it) => {
    const get = (sel: string) => it.querySelector(sel)?.textContent?.trim() || '';
    const link = get('link') || it.querySelector('link')?.getAttribute('href') || '';
    let title = get('title');
    let source = get('source') || doc.querySelector('channel > title')?.textContent?.trim() || fallbackSource;
    // Google News puts " - Source" at the end of titles
    const dash = title.lastIndexOf(' - ');
    if (link.includes('news.google.com') && dash > 20) { source = title.slice(dash + 3); title = title.slice(0, dash); }
    const date = get('pubDate') || get('published') || get('updated') || get('dc\\:date');
    const summary = strip(get('description') || get('summary') || get('content')).slice(0, 260);
    return { title: strip(title), link, date: date ? new Date(date).toISOString() : '', source, summary: summary.startsWith(title.slice(0, 30)) ? '' : summary };
  }).filter((n) => n.title && n.link);
}

const CACHE_KEY = 'finplan.news.v1';

export function loadCachedNews(): { at: number; items: NewsItem[] } | null {
  try { const r = localStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

export async function refreshNews(feeds: string[]) {
  const results = await Promise.allSettled(feeds.map(async (f) => {
    const known = sourceOf(f);
    const items = parseFeed(await fetchText(f), known?.publisher || new URL(f).hostname);
    // Publisher feeds: label with the publisher (Google News items keep their own outlet name)
    return known && known.publisher !== 'Google News' ? items.map((n) => ({ ...n, source: known.publisher, section: known.section })) : items;
  }));
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  let failed = 0;
  for (const r of results) {
    if (r.status === 'rejected') { failed++; continue; }
    for (const n of r.value) { const k = n.title.toLowerCase().slice(0, 60); if (!seen.has(k)) { seen.add(k); items.push(n); } }
  }
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const payload = { at: Date.now(), items: items.slice(0, 150) };
  if (items.length) try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
  return { ...payload, failed };
}

/** Tag a headline with what part of a personal portfolio it may affect. */
const TAGS: [RegExp, string, string][] = [
  [/suku bunga|bi rate|interest rate|fed\b|federal reserve|fomc|rate (cut|hike)/i, 'Rates', 'Affects deposits, bonds and loan costs'],
  [/inflasi|inflation|cpi|harga (beras|bbm|cabai)/i, 'Inflation', 'Affects purchasing power and real returns'],
  [/rupiah|dolar|dollar|kurs|exchange rate|usd\/idr/i, 'Currency', 'Affects imported costs and USD assets'],
  [/ihsg|saham|stock|bursa|idx|nasdaq|s&p|dow jones|emiten/i, 'Stocks', 'Affects equity holdings and equity funds'],
  [/emas|gold|antam/i, 'Gold', 'Affects gold holdings'],
  [/bitcoin|crypto|kripto|ethereum/i, 'Crypto', 'Affects crypto holdings'],
  [/obligasi|sbn|\bori\b|\bsr0|sukuk|bond|yield|treasury/i, 'Bonds', 'Affects bond prices and yields'],
  [/pajak|tax|ppn|pph/i, 'Tax', 'May affect take-home pay or returns'],
  [/properti|kpr|property|housing|real estate/i, 'Property', 'Affects property and mortgages'],
  [/bbm|pertalite|minyak|oil|energi|listrik/i, 'Energy', 'Affects transport & utility costs'],
];
export function tagNews(n: NewsItem) {
  const text = n.title + ' ' + n.summary;
  return TAGS.filter(([re]) => re.test(text)).map(([, tag, why]) => ({ tag, why }));
}
