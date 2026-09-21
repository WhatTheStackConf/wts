import { createHash } from "node:crypto";

// Standalone crew document: no site shell, analytics, fonts or third-party requests.
const baseCss = `
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#10151d;color:#eef2f7}*{box-sizing:border-box}body{margin:0;padding:24px;max-width:1280px;margin-inline:auto}h1{font-size:clamp(26px,5vw,40px);margin:12px 0}p{line-height:1.5;color:#b8c4d4}.tag{color:#ffd24a;font-size:12px;letter-spacing:.14em;font-weight:700}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:24px 0}button,input{font:inherit;padding:12px;border:1px solid #526277;border-radius:8px;background:#1e2938;color:inherit;min-height:46px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:3px solid #ffd24a;outline-offset:3px}input[type=search]{flex:1;min-width:200px}label{display:flex;align-items:center;gap:8px}input[type=checkbox]{width:20px;min-height:20px}.table-wrap{overflow-x:auto;border:1px solid #354254;border-radius:12px}table{border-collapse:collapse;width:100%;text-align:left}th{font-size:12px;letter-spacing:.06em;color:#b8c4d4;background:#1b2532}th,td{padding:14px;border-bottom:1px solid #354254;vertical-align:top}td{overflow-wrap:anywhere}td:nth-child(2){min-width:180px}td:nth-child(3){min-width:240px}tbody tr:last-child td{border-bottom:0}.sub{display:block;font-size:12px;color:#a6b8ca;margin-top:5px}.number{font-variant-numeric:tabular-nums;white-space:nowrap}.notice{padding:14px;border-left:3px solid #ffd24a;background:#1b2532;font-size:14px}#status{min-height:24px}#empty{padding:20px}footer{font-size:13px;margin-top:24px;color:#a6b8ca}@media(max-width:600px){body{padding:16px}th,td{padding:10px}.controls button{flex:1}h1{margin-top:10px}}`;

const css = baseCss + `@media(max-width:600px){.table-wrap{overflow:visible;border:0}table,tbody{display:block}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}tbody tr{display:block;border:1px solid #354254;border-radius:12px;margin-bottom:12px;padding:8px}td,td:nth-child(2),td:nth-child(3){display:grid;grid-template-columns:100px minmax(0,1fr);min-width:0;white-space:normal;border:0;padding:8px;gap:4px 8px}td::before{content:attr(data-label);font-size:12px;color:#a6b8ca}td .sub{grid-column:2;margin-top:0}}`;

const script = String.raw`
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const token = new URLSearchParams(location.hash.slice(1)).get('key') || '';
  let data = null, visible = [], busy = false, expiryTimer;
  const status = el('status');
  function clear(message) {
    data = null; visible = []; el('rows').replaceChildren(); el('summary').textContent = '';
    el('export').disabled = true; el('empty').hidden = false; el('empty').textContent = message; status.textContent = message;
  }
  function cell(row, text, className) {
    const td = document.createElement('td'); td.dataset.label = ['Rank','Name / handle','Account','XP','Achievements'][row.children.length]; td.textContent = String(text); if(className) td.className = className; row.append(td); return td;
  }
  function render() {
    if (!data) return;
    const query = el('search').value.trim().toLocaleLowerCase();
    const pool = data.rows.filter(r => el('admins').checked || r.role !== 'admin');
    let priorXp, rank = 0;
    const ranked = pool.map((r,i) => { if(priorXp !== r.xp) rank = i + 1; priorXp = r.xp; return {...r, rank}; });
    visible = ranked.filter(r => [r.name,r.email,r.username,r.publicHandle,r.accountId].some(v => v.toLocaleLowerCase().includes(query)));
    const frag = document.createDocumentFragment();
    for (const r of visible) {
      const tr = document.createElement('tr'); cell(tr,r.rank,'number');
      const name = cell(tr,r.name || 'Name not provided');
      const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = r.publicHandle + (r.role === 'admin' ? ' · ADMIN' : ''); name.append(sub);
      const account = cell(tr,r.email || r.username || r.accountId);
      const id = document.createElement('span'); id.className = 'sub'; id.textContent = 'Account: ' + r.accountId; account.append(id);
      cell(tr,r.xp,'number'); cell(tr,r.achievements,'number'); frag.append(tr);
    }
    el('rows').replaceChildren(frag); el('export').disabled = !visible.length;
    el('empty').hidden = visible.length > 0; el('empty').textContent = 'No matching scoring accounts.';
    el('summary').textContent = visible.length + ' matching · ' + pool.length + ' accounts with current admin setting · ' + data.total + ' scoring accounts overall';
    status.textContent = 'Updated ' + new Date(data.updatedAt).toLocaleString('en-GB',{timeZone:'Europe/Skopje'}) + ' (Skopje) · refreshes every 30 seconds';
  }
  async function refresh() {
    if(busy) return;
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) { clear('Open the complete crew share link, including the part after #.'); return; }
    busy = true; el('refresh').disabled = true;
    try {
      const response = await fetch('/api/crew-raffle',{headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
      if(!response.ok) { clear(response.status === 404 ? 'This crew link is unavailable or expired.' : 'Refresh failed. Retry before using this list.'); return; }
      data = await response.json();
      const remaining = Date.parse(data.expiresAt)-Date.now();
      if(remaining <= 0) { clear('This crew link has expired.'); return; }
      clearTimeout(expiryTimer); expiryTimer = setTimeout(() => clear('This crew link has expired.'),Math.min(remaining,2147483647));
      el('expiry').textContent = 'Link expires ' + new Date(data.expiresAt).toLocaleString('en-GB',{timeZone:'Europe/Skopje'}) + ' (Skopje).';
      render();
    } catch { clear('Could not refresh. Check your connection and retry.'); }
    finally { busy = false; el('refresh').disabled = false; }
  }
  el('search').addEventListener('input',render); el('admins').addEventListener('change',render);
  el('refresh').addEventListener('click',refresh);
  el('copy').addEventListener('click',async () => {
    try { await navigator.clipboard.writeText(location.href); el('copy').textContent = 'Link copied'; }
    catch { el('copy').textContent = 'Copy the address bar link'; }
  });
  el('export').addEventListener('click',() => {
    if(!data || Date.now() >= Date.parse(data.expiresAt)) { clear('This crew link has expired.'); return; }
    const quote = value => { let text = String(value ?? ''); if(/^[=+\-@\t\r\n]/.test(text)) text = "'"+text; return '"'+text.replace(/"/g,'""')+'"'; };
    const lines = [['Rank','Registered name','Email','Username','Public handle','XP','Achievements','Account ID','Role','Snapshot UTC'], ...visible.map(r => [r.rank,r.name,r.email,r.username,r.publicHandle,r.xp,r.achievements,r.accountId,r.role,data.updatedAt])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+lines.map(r => r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href=url; a.download='wts-crew-raffle-'+data.updatedAt.slice(0,19).replace(/:/g,'-')+'.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('pagehide',() => clear('Reopen the crew link to refresh.'));
  window.addEventListener('pageshow',event => { if(event.persisted) refresh(); });
  document.addEventListener('visibilitychange',() => { if(!document.hidden) refresh(); });
  setInterval(() => { if(!document.hidden) refresh(); },30000);
  refresh();
})();`;

const hash = (text: string) => createHash("sha256").update(text).digest("base64");
export const crewRaffleCsp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
export const crewRaffleHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>WTS · Crew raffle leaderboard</title><style>${css}</style></head><body><header><span class="tag">WHAT THE STACK 2026 · CREW ONLY</span><h1>Raffle leaderboard</h1><p>Registered accounts, XP and earned achievements. Keep this link and any exports within the crew.</p></header><p class="notice">This is the live scoring list, not a final eligibility decision. Admin accounts are hidden by default. Public-board opt-outs remain included. Review other staff/test exclusions before the draw; missing names are not guessed from emails.</p><div class="controls"><input id="search" type="search" placeholder="Search name, email or handle" aria-label="Search accounts"><button id="refresh" type="button">Refresh now</button><button id="export" type="button" disabled>Download CSV</button><button id="copy" type="button">Copy crew link</button><label><input id="admins" type="checkbox">Include admin accounts</label></div><p id="status" role="status" aria-live="polite">Loading leaderboard…</p><p id="summary"></p><div class="table-wrap"><table><caption hidden>Accounts ranked by leaderboard XP; equal scores share a rank.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Name / handle</th><th scope="col">Account</th><th scope="col">XP</th><th scope="col">Achievements</th></tr></thead><tbody id="rows"></tbody></table><p id="empty" hidden></p></div><footer><p>Equal XP shares a rank. Names are self-reported account names, not verified legal identities. A CSV is a snapshot of the currently filtered view.</p><p id="expiry"></p></footer><noscript>JavaScript is required to open this crew link.</noscript><script>${script}</script></body></html>`;
