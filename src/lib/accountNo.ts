/** Account numbers: kept in full (encrypted vault + encrypted sync), shown masked (···9990) unless revealed. Never sent to Claude. */
export const cleanNo = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
export const refOf = (no?: string) => { const c = cleanNo(no || ''); return c.length >= 4 ? `···${c.slice(-4)}` : c ? `···${c}` : undefined; };
/** "2582289990" → "2582 2899 90" */
export const fmtNo = (no: string) => cleanNo(no).replace(/(.{4})(?=.)/g, '$1 ');
export const showNo = (a: { accountNo?: string; ref?: string }, reveal: boolean) => (reveal && a.accountNo ? fmtNo(a.accountNo) : a.ref || refOf(a.accountNo) || '');
