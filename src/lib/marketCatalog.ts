/** Instruments for the dashboard maker. `sym` is the Yahoo Finance symbol; `tv` the TradingView symbol. */
export interface Instrument { sym: string; name: string; group: string; tv?: string; ccy?: string; decimals?: number; inv?: number }

export const CATALOG: Instrument[] = [
  // Currencies
  { sym: 'USDIDR=X', name: 'USD/IDR', group: 'Currencies', tv: 'FX_IDC:USDIDR', ccy: 'IDR', decimals: 0 },
  { sym: 'SGDIDR=X', name: 'SGD/IDR', group: 'Currencies', tv: 'FX_IDC:SGDIDR', ccy: 'IDR', decimals: 0 },
  { sym: 'EURIDR=X', name: 'EUR/IDR', group: 'Currencies', tv: 'FX_IDC:EURIDR', ccy: 'IDR', decimals: 0 },
  { sym: 'JPYIDR=X', name: 'JPY/IDR', group: 'Currencies', tv: 'FX_IDC:JPYIDR', ccy: 'IDR', decimals: 2 },
  { sym: 'CNYIDR=X', name: 'CNY/IDR', group: 'Currencies', tv: 'FX_IDC:CNYIDR', ccy: 'IDR', decimals: 0 },
  { sym: 'MYRIDR=X', name: 'MYR/IDR', group: 'Currencies', tv: 'FX_IDC:MYRIDR', ccy: 'IDR', decimals: 0 },
  { sym: 'DX-Y.NYB', name: 'US Dollar Index (DXY)', group: 'Currencies', tv: 'TVC:DXY', decimals: 2 },
  // Indonesia stocks (IDX)
  { sym: 'BBCA.JK', name: 'BBCA · Bank Central Asia', group: 'Indonesia stocks', tv: 'IDX:BBCA', ccy: 'IDR', decimals: 0 },
  { sym: 'BBRI.JK', name: 'BBRI · Bank Rakyat Indonesia', group: 'Indonesia stocks', tv: 'IDX:BBRI', ccy: 'IDR', decimals: 0 },
  { sym: 'BMRI.JK', name: 'BMRI · Bank Mandiri', group: 'Indonesia stocks', tv: 'IDX:BMRI', ccy: 'IDR', decimals: 0 },
  { sym: 'BBNI.JK', name: 'BBNI · Bank Negara Indonesia', group: 'Indonesia stocks', tv: 'IDX:BBNI', ccy: 'IDR', decimals: 0 },
  { sym: 'TLKM.JK', name: 'TLKM · Telkom Indonesia', group: 'Indonesia stocks', tv: 'IDX:TLKM', ccy: 'IDR', decimals: 0 },
  { sym: 'ASII.JK', name: 'ASII · Astra International', group: 'Indonesia stocks', tv: 'IDX:ASII', ccy: 'IDR', decimals: 0 },
  { sym: 'GOTO.JK', name: 'GOTO · GoTo Gojek Tokopedia', group: 'Indonesia stocks', tv: 'IDX:GOTO', ccy: 'IDR', decimals: 0 },
  { sym: 'UNVR.JK', name: 'UNVR · Unilever Indonesia', group: 'Indonesia stocks', tv: 'IDX:UNVR', ccy: 'IDR', decimals: 0 },
  { sym: 'ICBP.JK', name: 'ICBP · Indofood CBP', group: 'Indonesia stocks', tv: 'IDX:ICBP', ccy: 'IDR', decimals: 0 },
  { sym: 'ADRO.JK', name: 'ADRO · Alamtri (Adaro)', group: 'Indonesia stocks', tv: 'IDX:ADRO', ccy: 'IDR', decimals: 0 },
  { sym: 'ANTM.JK', name: 'ANTM · Aneka Tambang', group: 'Indonesia stocks', tv: 'IDX:ANTM', ccy: 'IDR', decimals: 0 },
  { sym: 'AMMN.JK', name: 'AMMN · Amman Mineral', group: 'Indonesia stocks', tv: 'IDX:AMMN', ccy: 'IDR', decimals: 0 },
  { sym: 'BREN.JK', name: 'BREN · Barito Renewables', group: 'Indonesia stocks', tv: 'IDX:BREN', ccy: 'IDR', decimals: 0 },
  { sym: 'MDKA.JK', name: 'MDKA · Merdeka Copper Gold', group: 'Indonesia stocks', tv: 'IDX:MDKA', ccy: 'IDR', decimals: 0 },
  { sym: 'PGAS.JK', name: 'PGAS · Perusahaan Gas Negara', group: 'Indonesia stocks', tv: 'IDX:PGAS', ccy: 'IDR', decimals: 0 },
  { sym: 'INCO.JK', name: 'INCO · Vale Indonesia', group: 'Indonesia stocks', tv: 'IDX:INCO', ccy: 'IDR', decimals: 0 },
  { sym: 'PTBA.JK', name: 'PTBA · Bukit Asam', group: 'Indonesia stocks', tv: 'IDX:PTBA', ccy: 'IDR', decimals: 0 },
  { sym: 'KLBF.JK', name: 'KLBF · Kalbe Farma', group: 'Indonesia stocks', tv: 'IDX:KLBF', ccy: 'IDR', decimals: 0 },
  { sym: 'CPIN.JK', name: 'CPIN · Charoen Pokphand', group: 'Indonesia stocks', tv: 'IDX:CPIN', ccy: 'IDR', decimals: 0 },
  { sym: 'BRIS.JK', name: 'BRIS · Bank Syariah Indonesia', group: 'Indonesia stocks', tv: 'IDX:BRIS', ccy: 'IDR', decimals: 0 },
  // Indonesia & US indices
  { sym: '^JKSE', name: 'IHSG (JCI)', group: 'Indices', tv: 'IDX:COMPOSITE', decimals: 2 },
  { sym: '^JKLQ45', name: 'LQ45', group: 'Indices', tv: 'IDX:LQ45', decimals: 2 },
  { inv: 166, sym: '^GSPC', name: 'S&P 500', group: 'Indices', tv: 'SP:SPX', decimals: 2 },
  { sym: '^IXIC', name: 'Nasdaq Composite', group: 'Indices', tv: 'NASDAQ:IXIC', decimals: 2 },
  { inv: 169, sym: '^DJI', name: 'Dow Jones', group: 'Indices', tv: 'DJ:DJI', decimals: 2 },
  { sym: '^RUT', name: 'Russell 2000', group: 'Indices', tv: 'TVC:RUT', decimals: 2 },
  { sym: '^VIX', name: 'VIX (volatility)', group: 'Indices', tv: 'TVC:VIX', decimals: 2 },
  // ETFs
  { sym: 'SPY', name: 'S&P 500 ETF (SPY)', group: 'US ETFs', tv: 'AMEX:SPY', ccy: 'USD' },
  { sym: 'QQQ', name: 'Nasdaq-100 ETF (QQQ)', group: 'US ETFs', tv: 'NASDAQ:QQQ', ccy: 'USD' },
  { sym: 'SCHD', name: 'Schwab US Dividend (SCHD)', group: 'US ETFs', tv: 'AMEX:SCHD', ccy: 'USD' },
  { sym: 'RSP', name: 'S&P 500 Equal Weight (RSP)', group: 'US ETFs', tv: 'AMEX:RSP', ccy: 'USD' },
  { sym: 'VOO', name: 'Vanguard S&P 500 (VOO)', group: 'US ETFs', tv: 'AMEX:VOO', ccy: 'USD' },
  { sym: 'VTI', name: 'Vanguard Total Market (VTI)', group: 'US ETFs', tv: 'AMEX:VTI', ccy: 'USD' },
  { sym: 'GLD', name: 'Gold ETF (GLD)', group: 'US ETFs', tv: 'AMEX:GLD', ccy: 'USD' },
  { sym: 'TLT', name: '20Y+ Treasury (TLT)', group: 'US ETFs', tv: 'NASDAQ:TLT', ccy: 'USD' },
  { sym: 'EIDO', name: 'iShares MSCI Indonesia (EIDO)', group: 'US ETFs', tv: 'AMEX:EIDO', ccy: 'USD' },
  // Crypto
  { inv: 945629, sym: 'BTC-USD', name: 'Bitcoin (BTC/USD)', group: 'Crypto', tv: 'BITSTAMP:BTCUSD', ccy: 'USD' },
  { sym: 'ETH-USD', name: 'Ethereum (ETH/USD)', group: 'Crypto', tv: 'BITSTAMP:ETHUSD', ccy: 'USD' },
  { sym: 'SOL-USD', name: 'Solana (SOL/USD)', group: 'Crypto', tv: 'COINBASE:SOLUSD', ccy: 'USD' },
  { sym: 'BNB-USD', name: 'BNB (BNB/USD)', group: 'Crypto', tv: 'BINANCE:BNBUSDT', ccy: 'USD' },
  { sym: 'XRP-USD', name: 'XRP (XRP/USD)', group: 'Crypto', tv: 'BITSTAMP:XRPUSD', ccy: 'USD' },
  // Global commodities
  { inv: 8830, sym: 'GC=F', name: 'Gold', group: 'Commodities', tv: 'COMEX:GC1!', ccy: 'USD' },
  { inv: 8836, sym: 'SI=F', name: 'Silver', group: 'Commodities', tv: 'COMEX:SI1!', ccy: 'USD' },
  { inv: 8849, sym: 'CL=F', name: 'Crude Oil WTI', group: 'Commodities', tv: 'NYMEX:CL1!', ccy: 'USD' },
  { inv: 8833, sym: 'BZ=F', name: 'Brent Crude', group: 'Commodities', tv: 'NYMEX:BB1!', ccy: 'USD' },
  { inv: 8831, sym: 'HG=F', name: 'Copper', group: 'Commodities', tv: 'COMEX:HG1!', ccy: 'USD' },
  { inv: 8862, sym: 'NG=F', name: 'Natural Gas', group: 'Commodities', tv: 'NYMEX:NG1!', ccy: 'USD' },
  { sym: 'PL=F', name: 'Platinum', group: 'Commodities', tv: 'NYMEX:PL1!', ccy: 'USD' },
  { sym: 'ZW=F', name: 'Wheat', group: 'Commodities', tv: 'CBOT:ZW1!', ccy: 'USD' },
  { sym: 'KC=F', name: 'Coffee', group: 'Commodities', tv: 'ICEUS:KC1!', ccy: 'USD' },
  // Asia Pacific
  { inv: 178, sym: '^N225', name: 'Nikkei 225 (Japan)', group: 'Asia Pacific', tv: 'TVC:NI225', decimals: 2 },
  { inv: 179, sym: '^HSI', name: 'Hang Seng (Hong Kong)', group: 'Asia Pacific', tv: 'TVC:HSI', decimals: 2 },
  { sym: '000001.SS', name: 'Shanghai Composite', group: 'Asia Pacific', tv: 'SSE:000001', decimals: 2 },
  { sym: '^KS11', name: 'KOSPI (Korea)', group: 'Asia Pacific', tv: 'KRX:KOSPI', decimals: 2 },
  { sym: '^STI', name: 'Straits Times (Singapore)', group: 'Asia Pacific', tv: 'TVC:STI', decimals: 2 },
  { sym: '^AXJO', name: 'ASX 200 (Australia)', group: 'Asia Pacific', tv: 'ASX:XJO', decimals: 2 },
  { sym: '^NSEI', name: 'Nifty 50 (India)', group: 'Asia Pacific', tv: 'NSE:NIFTY', decimals: 2 },
  { sym: '^TWII', name: 'TAIEX (Taiwan)', group: 'Asia Pacific', tv: 'TWSE:TAIEX', decimals: 2 },
  { sym: '^KLSE', name: 'KLCI (Malaysia)', group: 'Asia Pacific', tv: 'FTSEMYX:FBMKLCI', decimals: 2 },
  { sym: '^SET.BK', name: 'SET (Thailand)', group: 'Asia Pacific', tv: 'SET:SET', decimals: 2 },
  { sym: 'PSEI.PS', name: 'PSEi (Philippines)', group: 'Asia Pacific', tv: 'PSE:PSEI', decimals: 2 },
];

export const findInstrument = (sym: string): Instrument => CATALOG.find((i) => i.sym === sym)
  || (/^[A-Z0-9]{4}\.JK$/.test(sym) ? { sym, name: sym.slice(0, 4), group: 'Indonesia stocks', tv: `IDX:${sym.slice(0, 4)}`, ccy: 'IDR', decimals: 0 } : { sym, name: sym, group: 'Custom' });
export const GROUPS = [...new Set(CATALOG.map((i) => i.group))];

/** Investing.com official chart widget (webmaster tools). Pair IDs: Investing.com → Webmaster Tools → Technical Charts → pick a symbol → copy pair_ID from the embed code. */
export const investingChartUrl = (pairId: number) => `https://ssltvc.investing.com/init.php?domain_ID=1&lang_ID=1&pair_ID=${pairId}&timezone_ID=8`;
export const ALGOBARS_URL = 'https://algobars.com';

/** Stockbit has no public API or embeddable chart; FinPlan opens the stock in Stockbit instead. */
export const stockbitUrl = (sym: string) => `https://stockbit.com/symbol/${sym.replace(/\.JK$/, '')}`;
export const idxCode = (s: string) => s.trim().toUpperCase().replace(/\.JK$/, '');
