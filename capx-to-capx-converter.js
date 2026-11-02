/* Construct 2 .capx (WebStorage) -> .capx (LocalStorage). Runs fully in the browser; needs JSZip. */
(() => {
'use strict';

/* Construct 2 LocalStorage ACE ids. Only the ones seen in the hand-converted SpacePurge sample are filled in.
   Fill in `removeItem` / `clear` ({id, name}) once verified; until then those actions are removed and reported. */
const LS = {
  setItem:    { id: '0', name: 'Set item' },
  checkItem:  { id: '3', name: 'Check item exists' },   // action
  onExists:   { id: '0', name: 'On item exists' },      // condition (trigger)
  removeItem: null,                                     // WebStorage "Remove local value"
  clear:      null                                      // WebStorage "Clear local storage"
};

const kids = (e, t) => [...e.children].filter(c => !t || c.tagName === t);
const kid = (e, t) => kids(e, t)[0] || null;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmt = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(1) + ' KB';
const norm = n => n.replace(/\\/g, '/');   // real .capx files use backslash separators
const tick = () => new Promise(r => setTimeout(r));
const mk = (doc, tag, attrs = {}, text) => {
  const e = doc.createElement(tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
};

/* ---------- C2-style XML writer (4 spaces, CRLF, BOM, ' />' for empty tags) ---------- */
function ser(el, d, out) {
  const pad = '    '.repeat(d);
  let s = pad + '<' + el.tagName;
  for (const a of el.attributes) s += ` ${a.name}="${esc(a.value)}"`;
  if (![...el.childNodes].some(n => n.nodeType === 1 || n.nodeType === 8)) {
    const t = el.textContent;
    out.push(t === '' ? s + ' />' : `${s}>${esc(t)}</${el.tagName}>`);
    return;
  }
  out.push(s + '>');
  for (const n of el.childNodes) {
    if (n.nodeType === 1) ser(n, d + 1, out);
    else if (n.nodeType === 8) out.push(pad + '    <!--' + n.nodeValue + '-->');
  }
  out.push(pad + '</' + el.tagName + '>');
}
const toXml = doc => { const o = []; ser(doc.documentElement, 0, o); return '\uFEFF<?xml version="1.0" encoding="utf-8" ?>\r\n' + o.join('\r\n') + '\r\n'; };

/* ---------- expressions: WebStorage.LocalValue(key) -> LocalStorage.ItemValue ---------- */
function rewrite(text, ctx, where) {
  const re = ctx.readRe; re.lastIndex = 0;
  let out = '', i = 0, m; const keys = [];
  while ((m = re.exec(text))) {
    let j = re.lastIndex, depth = 1, str = false;
    for (; j < text.length && depth; j++) {
      const c = text[j];
      if (str) { if (c === '\\') j++; else if (c === '"') str = false; }
      else if (c === '"') str = true;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    if (depth) break; // unbalanced, leave untouched
    const key = text.slice(re.lastIndex, j - 1).trim();
    if (/session/i.test(m[1])) ctx.warn(`${where}: SessionValue(${key}) mapped to LocalStorage (no session storage in this plugin)`);
    out += text.slice(i, m.index) + ctx.target + '.ItemValue';
    keys.push(key); i = j; re.lastIndex = j; ctx.st.reads++;
  }
  out += text.slice(i);
  if (ctx.leftRe.test(out)) ctx.warn(`${where}: unsupported WebStorage expression left in "${out}" - fix manually`);
  return { text: out, keys };
}

/* ---------- event tree ---------- */
const isWS = (el, ctx) => ctx.ws.has(el.getAttribute('type'));
const isExists = c => /key exists/i.test(c.getAttribute('name') || '') && c.getAttribute('inverted') !== '1';
const newBlock = ctx => mk(ctx.doc, 'event-block', { sid: ctx.sid() });
const ensure = (B, tag) => {
  let e = kid(B, tag);
  if (e) return e;
  e = mk(B.ownerDocument, tag);
  const subs = kid(B, 'sub-events');
  if (tag === 'conditions') B.insertBefore(e, B.firstChild);
  else if (subs) B.insertBefore(e, subs); else B.appendChild(e);
  return e;
};
const checkAct = (ctx, key) => {
  const a = mk(ctx.doc, 'action', { id: LS.checkItem.id, name: LS.checkItem.name, sid: ctx.sid(), type: ctx.target });
  a.appendChild(mk(ctx.doc, 'param', { id: '0', name: 'Key' }, key));
  return a;
};
const addCheck = (ctx, B, key) => {
  const seen = ctx.checks.get(B) || ctx.checks.set(B, new Set()).get(B);
  if (seen.has(key)) return;
  seen.add(key); ensure(B, 'actions').appendChild(checkAct(ctx, key)); ctx.st.checks++;
};
const toTrigger = (ctx, c) => {
  c.setAttribute('id', LS.onExists.id); c.setAttribute('name', LS.onExists.name); c.setAttribute('type', ctx.target);
  c.removeAttribute('inverted'); ctx.st.exists++;
};
const warnPicks = (ctx, P, where) => {
  if (ctx.picked.has(P)) return; ctx.picked.add(P);
  const c = kid(P, 'conditions');
  if (c && kids(c, 'condition').some(x => x.getAttribute('type') !== 'System'))
    ctx.warn(`${where}: parent event has object conditions; picked instances are NOT available inside the async "On item exists" trigger - review`);
};

function walk(container, parent, lift, ctx, scope) {
  const out = [];
  for (const n of [...container.childNodes]) {
    if (n.nodeType === 8) out.push(n);
    else if (n.nodeType !== 1) continue;
    else if (n.tagName === 'event-block') out.push(...block(n, parent, lift, ctx, scope));
    else { if (/^(event-)?group$/.test(n.tagName)) walk(kid(n, 'sub-events') || n, null, [], ctx, null); out.push(n); }
  }
  while (container.firstChild) container.removeChild(container.firstChild);
  out.forEach(n => container.appendChild(n));
}

function block(B, parent, parentLift, ctx, scope) {
  const where = `${ctx.sheet} › event ${B.getAttribute('sid')}`;
  const condsEl = kid(B, 'conditions'), actsEl = kid(B, 'actions'), subEl = kid(B, 'sub-events');
  const conds = condsEl ? kids(condsEl, 'condition') : [];
  let acts = actsEl ? kids(actsEl, 'action') : [];
  const lift = [];
  const subWalk = (node, sc) => { if (subEl) walk(subEl, node, lift, ctx, sc); };

  /* 1. unsupported WebStorage conditions: drop whole event (can't be expressed) */
  const wsC = conds.filter(c => isWS(c, ctx));
  const bad = wsC.find(c => !isExists(c));
  if (bad) {
    ctx.warn(`${where}: condition "${bad.getAttribute('name')}"${bad.getAttribute('inverted') === '1' ? ' (inverted)' : ''} has no verified LocalStorage id - whole event REMOVED`);
    ctx.st.removed++; return [];
  }

  /* 2. rewrite LocalValue() reads in every param, remember which action reads which key */
  const keysOf = new Map();
  for (const c of conds) if (!isWS(c, ctx)) for (const p of kids(c, 'param')) {
    const r = rewrite(p.textContent, ctx, where);
    if (r.keys.length) { p.textContent = r.text; ctx.warn(`${where}: storage value read inside condition "${c.getAttribute('name')}" - ItemValue only works inside an On item exists trigger - review`); }
  }
  for (const a of acts) {
    const keys = [];
    for (const p of kids(a, 'param')) { const r = rewrite(p.textContent, ctx, where); if (r.keys.length) { p.textContent = r.text; keys.push(...r.keys); } }
    keysOf.set(a, keys);
  }

  /* 3. WebStorage actions -> LocalStorage actions */
  for (const a of acts.filter(x => isWS(x, ctx))) {
    const nm = a.getAttribute('name') || '', n = nm.toLowerCase();
    const ace = /set (local|session) value/.test(n) ? LS.setItem : /remove/.test(n) ? LS.removeItem : /clear/.test(n) ? LS.clear : null;
    if (!ace) {
      ctx.warn(`${where}: action "${nm}" has no verified LocalStorage id - action REMOVED`);
      a.remove(); acts = acts.filter(x => x !== a); keysOf.delete(a); ctx.st.removed++; continue;
    }
    if (/session/.test(n)) ctx.warn(`${where}: "${nm}" uses session storage; mapped to LocalStorage`);
    a.setAttribute('id', ace.id); a.setAttribute('name', ace.name); a.setAttribute('type', ctx.target);
    ctx.st.sets++; ctx.dbg(`${where}: "${nm}" -> "${ace.name}"`);
  }

  /* 4a. event has "key exists" -> becomes an "On item exists" trigger */
  const ex = wsC.filter(isExists);
  if (ex.length) {
    const K = ex[0], key = (kid(K, 'param') || { textContent: '""' }).textContent;
    if (ex.length > 1) { ctx.warn(`${where}: several "key exists" conditions in one event; only ${key} is kept as trigger`); ex.slice(1).forEach(c => c.remove()); }
    const other = conds.filter(c => !ex.includes(c));
    const foreign = [...new Set(acts.flatMap(a => keysOf.get(a) || []))].filter(k => k !== key);
    if (foreign.length) ctx.warn(`${where}: also reads ${foreign.join(', ')}; ItemValue only holds ${key} here - review`);
    const wasOr = B.getAttribute('any') === '1';
    toTrigger(ctx, K); B.removeAttribute('any');

    if (parent && !other.length) {                    // same pattern as the hand-converted sample
      addCheck(ctx, parent, key); warnPicks(ctx, parent, where);
      subWalk(B, key); parentLift.push(B, ...lift);
      ctx.st.viaParent++; ctx.dbg(`${where}: ${key} -> trigger lifted next to parent, check added to parent actions`);
      return [];
    }
    if (!other.length) {                              // top level, nothing to hang the check on
      ctx.warn(`${where}: top-level "key exists" for ${key}; trigger converted but you must add LocalStorage "Check item exists" ${key} yourself`);
      subWalk(B, key); return [B, ...lift];
    }
    const c1 = newBlock(ctx);                         // keep the other conditions in a new "check" event
    if (wasOr) { ctx.warn(`${where}: OR-block mixed with storage condition; the storage condition is now AND-ed - review`); if (other.length > 1) c1.setAttribute('any', '1'); }
    const c1c = mk(ctx.doc, 'conditions'); other.forEach(c => c1c.appendChild(c)); c1.appendChild(c1c);
    c1.appendChild(mk(ctx.doc, 'actions')).appendChild(checkAct(ctx, key)); ctx.st.checks++;
    if (parent) warnPicks(ctx, parent, where);
    subWalk(B, key); ctx.st.viaSelf++; ctx.dbg(`${where}: ${key} -> check event + trigger event`);
    return [c1, B, ...lift];
  }

  /* 4b. no "key exists", but actions read a stored value -> check + trigger per key */
  const groups = new Map();
  for (const a of acts) {
    const ks = [...new Set((keysOf.get(a) || []).filter(k => k !== scope))];
    if (!ks.length) continue;
    if (ks.length > 1) ctx.warn(`${where}: action "${a.getAttribute('name')}" reads several keys; review`);
    (groups.get(ks[0]) || groups.set(ks[0], []).get(ks[0])).push(a);
  }
  const trig = [];
  for (const [key, list] of groups) {
    const t = newBlock(ctx);
    const cEl = t.appendChild(mk(ctx.doc, 'conditions'));
    const c = cEl.appendChild(mk(ctx.doc, 'condition', { id: LS.onExists.id, name: LS.onExists.name, sid: ctx.sid(), type: ctx.target }));
    c.appendChild(mk(ctx.doc, 'param', { id: '0', name: 'Key' }, key));
    const aEl = t.appendChild(mk(ctx.doc, 'actions')); list.forEach(a => aEl.appendChild(a));
    addCheck(ctx, B, key); trig.push(t); ctx.st.viaSelf++;
    ctx.warn(`${where}: read of ${key} moved into async On item exists (runs only if the key exists, one tick later)`);
  }
  subWalk(B, scope);
  return [B, ...trig, ...lift];
}

/* ---------- main ---------- */
async function convert(file, log, onPct) {
  const t0 = performance.now();
  const st = { sheets: 0, sets: 0, exists: 0, viaParent: 0, viaSelf: 0, reads: 0, checks: 0, removed: 0, warns: 0 };
  const warn = m => { st.warns++; log('warn', m); };
  const dbg = m => log('dbg', m);

  log('step', `Reading ${file.name} (${fmt(file.size)})`);
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  log('info', `Archive has ${names.length} files`);
  const capPath = names.find(n => /\.caproj$/i.test(n));
  if (!capPath) throw new Error('No .caproj file found - is this a Construct 2 .capx?');
  const root = norm(capPath).slice(0, norm(capPath).lastIndexOf('/') + 1);
  log('ok', `Project file: ${capPath}`);
  await tick();

  /* project file (plain text edits keep everything else byte-exact) */
  log('step', 'Patching project file');
  let proj = await zip.file(capPath).async('string');
  const wsNames = [...proj.matchAll(/<object-type\b[^>]*?\bname="([^"]*)"[^>]*>\s*<plugin\s+id="WebStorage"\s*\/>/g)].map(m => m[1]);
  if (!wsNames.length) throw new Error('No object using the WebStorage plugin found - nothing to convert.');
  if (wsNames.length > 1) warn(`Several WebStorage objects found (${wsNames.join(', ')}); only the first is renamed`);
  const lsM = proj.match(/<object-type\b[^>]*?\bname="([^"]*)"[^>]*>\s*<plugin\s+id="LocalStorage"\s*\/>/);
  const taken = n => new RegExp('<object-type\\b[^>]*?\\bname="' + escRe(n) + '"').test(proj);
  let target = lsM ? lsM[1] : 'LocalStorage';
  if (!lsM) for (let i = 1; taken(target); i++) target = 'LocalStorage' + i;
  log('info', `WebStorage object(s): ${wsNames.join(', ')} -> ${lsM ? 'existing LocalStorage object "' + target + '" will be reused' : 'new name "' + target + '"'}`);

  const pluginTag = /<plugin\b[^>]*\bid="WebStorage"[^>]*>[^<]*<\/plugin>/;
  const hasLsPlugin = /<plugin\b[^>]*\bid="LocalStorage"[^>]*>[^<]*<\/plugin>/.test(proj);
  if (hasLsPlugin) { proj = proj.replace(/[ \t]*<plugin\b[^>]*\bid="WebStorage"[^>]*>[^<]*<\/plugin>[ \t]*\r?\n?/, ''); log('dbg', 'WebStorage plugin entry removed (LocalStorage already listed)'); }
  else { proj = proj.replace(pluginTag, '<plugin author="Scirra" id="LocalStorage" version="1">Local Storage</plugin>'); log('dbg', 'plugin entry: WebStorage -> LocalStorage'); }
  if (lsM) {
    for (const n of wsNames) {
      proj = proj.replace(new RegExp('[ \\t]*<object-type\\b[^>]*?\\bname="' + escRe(n) + '"[^>]*>\\s*<plugin\\s+id="WebStorage"\\s*\\/>[\\s\\S]*?<\\/object-type>[ \\t]*\\r?\\n?'), '');
      proj = proj.replace(new RegExp('[ \\t]*<global-instance\\b[^>]*?\\btype="' + escRe(n) + '"[^>]*\\/>[ \\t]*\\r?\\n?', 'g'), '');
    }
    log('dbg', 'WebStorage object type + global instance removed');
  } else {
    proj = proj.replace(/(<object-type\b[^>]*?\bname=")[^"]*("[^>]*>\s*)<plugin\s+id="WebStorage"(\s*\/>)/, `$1${target}$2<plugin id="LocalStorage"$3`);
    proj = proj.replace(new RegExp('(<global-instance\\b[^>]*?\\btype=")' + escRe(wsNames[0]) + '"', 'g'), `$1${target}"`);
    log('dbg', `object type + global instance renamed to "${target}" (sid kept)`);
  }
  if (/WebStorage/.test(proj)) warn('"WebStorage" still appears in the project file - check manually');
  zip.file(capPath, proj, { createFolders: false });
  log('ok', 'Project file patched');
  await tick();

  /* event sheets */
  log('step', 'Converting event sheets');
  const ws = new Set(wsNames), used = new Set();
  const sid = () => { let s; do s = String(Math.floor(1e14 + Math.random() * 8.9e14)); while (used.has(s)); used.add(s); return s; };
  const names2 = '(?:' + wsNames.map(escRe).join('|') + ')';
  const base = {
    ws, target, st, warn, dbg, sid, checks: new WeakMap(), picked: new WeakSet(),
    readRe: new RegExp('\\b' + names2 + '\\.(Local|Session)Value\\(', 'gi'),
    leftRe: new RegExp('\\b' + names2 + '\\.\\w', 'i')
  };
  const esPrefix = (root + 'event sheets/').toLowerCase();
  const sheets = names.filter(n => norm(n).toLowerCase().startsWith(esPrefix) && /\.xml$/i.test(n) && !/\.uistate\.xml$/i.test(n));
  log('info', `${sheets.length} event sheet(s) found`);
  for (const p of sheets) {
    const sheet = norm(p).slice(esPrefix.length).replace(/\.xml$/i, '');
    const text = (await zip.file(p).async('string')).replace(/^\uFEFF/, '');
    if (!wsNames.some(n => text.includes('type="' + n + '"') || text.includes(n + '.'))) { log('dbg', `${sheet}: no WebStorage use, untouched`); continue; }
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`${sheet}: XML parse error`);
    const before = JSON.stringify(st);
    const events = kid(doc.documentElement, 'events') || doc.documentElement;
    walk(events, null, [], { ...base, doc, sheet }, null);
    zip.file(p, toXml(doc), { createFolders: false }); st.sheets++;
    log('ok', `${sheet}: converted (${Object.keys(st).filter(k => k !== 'warns').map(k => `${k} +${st[k] - JSON.parse(before)[k]}`).filter(s => !/\+0$/.test(s)).join(', ') || 'no changes'})`);
    await tick();
  }

  /* leftovers in other files */
  const others = names.filter(n => /\.xml$/i.test(n) && !sheets.includes(n) && !/\.uistate\.xml$/i.test(n));
  let leftovers = 0;
  for (const p of others) if ((await zip.file(p).async('string')).includes('WebStorage')) { leftovers++; warn(`${p}: still mentions WebStorage - check manually`); }
  log('info', `Scanned ${others.length} other XML files, ${leftovers} with leftovers`);

  log('step', 'Packing .capx');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    m => { if (onPct) onPct(m.percent); });
  const outName = file.name.replace(/\.(capx|zip)$/i, '') + '_LocalStorage.capx';
  log('ok', `Done in ${((performance.now() - t0) / 1000).toFixed(2)}s -> ${outName} (${fmt(blob.size)})`);
  log('info', `Summary: set item ${st.sets}, key-exists -> trigger ${st.exists} (via parent ${st.viaParent}, via new check event ${st.viaSelf}), reads rewritten ${st.reads}, check actions added ${st.checks}, removed ${st.removed}, warnings ${st.warns}`);
  return { blob, outName, st };
}

if (typeof module !== 'undefined') module.exports = { walk, toXml, kid, kids };

/* ---------- UI ---------- */
const $ = id => document.getElementById(id);
const lines = [];
function log(level, msg) {
  const d = new Date(), t = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  const tag = { step: 'STEP', info: 'INFO', ok: ' OK ', warn: 'WARN', err: 'FAIL', dbg: 'DBG ' }[level] || level;
  lines.push(`[${t}] ${tag} ${msg}`);
  const row = document.createElement('div'); row.className = 'ln ' + level;
  for (const [c, v] of [['t', t], ['lv', tag], ['m', msg]]) { const s = document.createElement('span'); s.className = c; s.textContent = v; row.appendChild(s); }
  const box = $('log'); box.appendChild(row); box.scrollTop = box.scrollHeight;
}

let url = null;
async function run(file) {
  if (!file) return;
  if (url) { URL.revokeObjectURL(url); url = null; }
  lines.length = 0; $('log').textContent = ''; $('logwrap').hidden = false; $('dl').hidden = true;
  $('status').textContent = 'working…'; $('status').className = 'badge run';
  try {
    if (!window.JSZip) throw new Error('JSZip failed to load (check your connection)');
    const r = await convert(file, log, p => { $('status').textContent = 'packing ' + Math.round(p) + '%'; });
    url = URL.createObjectURL(r.blob);
    $('dl').href = url; $('dl').download = r.outName; $('dl').textContent = '⬇ Download ' + r.outName; $('dl').hidden = false;
    $('status').textContent = r.st.warns ? `done · ${r.st.warns} warning(s)` : 'done'; $('status').className = 'badge ' + (r.st.warns ? 'warn' : 'ok');
  } catch (e) {
    log('err', e.message || String(e)); console.error(e);
    $('status').textContent = 'failed'; $('status').className = 'badge err';
  }
}

const fileIn = $('file'), drop = $('drop');
drop.addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', () => { run(fileIn.files[0]); fileIn.value = ''; });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => run(e.dataTransfer.files[0]));
$('verbose').addEventListener('change', e => $('log').classList.toggle('verbose', e.target.checked));
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(lines.join('\n')); $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy log', 1200); } catch { } });
})();