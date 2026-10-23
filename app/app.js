/* Notre budget (version en ligne) — logique commune aux pages budget.html et commun.html.
   Les données sont dans Supabase ; chaque personne ne peut lire et modifier que son
   propre budget et le budget commun (règles appliquées par la base, cf. supabase/1-schema.sql). */
(function () {
  const PAGE = document.documentElement.dataset.space;      // 'perso' ou 'commun'
  const SHARED = PAGE === 'commun';
  let SPACE = SHARED ? 'commun' : null;                       // 'a' (Noah), 'b' (Eve) ou 'commun'
  const DIR = { a: 'noah', b: 'eve', commun: 'commun' };
  const KEY = { noah: 'a', eve: 'b' };
  const PAGES = { perso: 'budget.html', commun: 'commun.html' };
  let ME = null; // { person: 'noah'|'eve', names: { noah, eve }, household, email }
  const CFG = window.NB_CONFIG || {};
  const sb = (window.supabase && CFG.url && CFG.anonKey && !/XXXX|COLLER/.test(CFG.url + CFG.anonKey))
    ? window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

  const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const MS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  const CATS = {
    out: [
      { id: 'logement', l: 'Logement', c: '#A8487A' }, { id: 'courses', l: 'Courses', c: '#E0954A' },
      { id: 'transport', l: 'Transport', c: '#4D8DC2' }, { id: 'abonnements', l: 'Abonnements', c: '#7B69C6' },
      { id: 'sorties', l: 'Sorties & restos', c: '#D25F7E' }, { id: 'sante', l: 'Santé & sport', c: '#3E9C93' },
      { id: 'shopping', l: 'Shopping', c: '#C8A33A' }, { id: 'voyages', l: 'Voyages', c: '#5AA35F' },
      { id: 'pot', l: 'Pot commun', c: '#7656C2' }, { id: 'yumi', l: 'Yumi', c: '#8C5A3C' },
      { id: 'autre', l: 'Autre', c: '#9A8FA6' }],
    in: [
      { id: 'salaire', l: 'Salaire', c: '#3B8A6B' }, { id: 'versement', l: 'Versement perso', c: '#7656C2' },
      { id: 'aides', l: 'Aides (APL, CAF…)', c: '#4D8DC2' }, { id: 'bourse', l: 'Bourse', c: '#2F7FA6' },
      { id: 'cadeau', l: 'Cadeau', c: '#D25F7E' }, { id: 'vente', l: 'Vente', c: '#E0954A' },
      { id: 'autre', l: 'Autre', c: '#9A8FA6' }]
  };
  const GOAL_COLORS = ['#A8487A', '#3B8A6B', '#4D8DC2', '#E0954A', '#7B69C6'];
  /* Taux en vigueur au 1er août 2026 ; modifiables compte par compte. */
  const ACCOUNT_PRESETS = {
    livretA: { name: 'Livret A', rate: 1.7, cap: 22950 },
    lep: { name: 'LEP', rate: 2.5, cap: 10000 },
    jeune: { name: 'Livret Jeune', rate: 1.7, cap: 1600 },
    ldds: { name: 'LDDS', rate: 1.7, cap: 12000 },
    autre: { name: 'Compte épargne', rate: 0, cap: 0 }
  };
  const SEED_ACCOUNTS = {
    a: [['livret-a', 'livretA'], ['lep', 'lep'], ['livret-jeune', 'jeune']],
    b: [['livret-jeune', 'jeune'], ['livret-a', 'livretA']]
  };

  /* ---------- utilitaires ---------- */
  const ym = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const addM = (m, k) => { let [y, mo] = m.split('-').map(Number); mo += k; y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12 + 12) % 12 + 1; return y + '-' + String(mo).padStart(2, '0'); };
  const diffM = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
  const mLabel = m => { const [y, mo] = m.split('-').map(Number); return MONTHS[mo - 1] + ' ' + y; };
  const today = () => { const d = new Date(); return ym(d) + '-' + String(d.getDate()).padStart(2, '0'); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 }).format(n);
  const eur0 = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const parseAmt = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
  const cat = (type, id) => (CATS[type].find(c => c.id === id) || CATS[type][CATS[type].length - 1]);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  /* ---------- état ---------- */
  function ensureShape() {
    ST.data = ST.data || {};
    for (const c of ['entries', 'goals', 'accounts']) ST.data[c] = ST.data[c] || {};
  }
  let ST = { version: 0, data: { entries: {}, goals: {}, accounts: {} } };
  const S = { month: ym(), tab: 'mois', mode: 'loading', online: true };

  const names = () => ME ? [ME.names.noah, ME.names.eve] : ['Noah', 'Eve'];
  const spaceName = sp => sp === 'a' ? names()[0] : sp === 'b' ? names()[1] : 'Commun';
  const whoName = w => w === 'a' ? names()[0] : w === 'b' ? names()[1] : 'Commun';

  /* Exemples affichés tant que l'espace est vide ; jamais enregistrés. */
  function demo() {
    const m = ym(), p = k => addM(m, k);
    let i = 0; const E = o => Object.assign({ id: 'demo' + (i++) }, o);
    if (SPACE === 'a') return {
      entries: [
        E({ type: 'in', kind: 'fixed', label: 'Salaire alternance', amount: 1150, cat: 'salaire', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Versement au pot commun', amount: 600, cat: 'pot', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Abonnement TER', amount: 75, cat: 'transport', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Salle de sport', amount: 30, cat: 'sante', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Forfait mobile', amount: 15, cat: 'abonnements', start: p(-6) }),
        E({ type: 'out', kind: 'once', label: 'Jeu vidéo', amount: 40, cat: 'shopping', date: m + '-06' }),
        E({ type: 'out', kind: 'once', label: 'Déjeuners au resto', amount: 36, cat: 'sorties', date: m + '-10' }),
        E({ type: 'in', kind: 'once', label: 'Prime', amount: 300, cat: 'autre', date: p(-2) + '-28' }),
        E({ type: 'out', kind: 'once', label: 'Écouteurs', amount: 89, cat: 'shopping', date: p(-3) + '-14' })],
      goals: [{ id: 'g1', name: 'Nouvel ordi', target: 1200, deadline: p(7), color: 2, contribs: [{ m: p(-3), a: 150 }, { m: p(-2), a: 200 }, { m: p(-1), a: 150 }, { m, a: 100 }] }]
    };
    if (SPACE === 'b') return {
      entries: [
        E({ type: 'in', kind: 'fixed', label: 'Salaire', amount: 1480, cat: 'salaire', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Versement au pot commun', amount: 750, cat: 'pot', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Netflix + Spotify', amount: 28, cat: 'abonnements', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Navigo', amount: 86, cat: 'transport', start: p(-6) }),
        E({ type: 'out', kind: 'once', label: 'Manteau', amount: 95, cat: 'shopping', date: m + '-03' }),
        E({ type: 'out', kind: 'once', label: 'Verre avec les copines', amount: 24, cat: 'sorties', date: m + '-09' }),
        E({ type: 'out', kind: 'once', label: 'Pharmacie', amount: 18, cat: 'sante', date: p(-1) + '-17' })],
      goals: [{ id: 'g1', name: 'Coussin perso', target: 1500, deadline: '', color: 1, contribs: [{ m: p(-4), a: 200 }, { m: p(-2), a: 250 }, { m, a: 150 }] }]
    };
    return {
      entries: [
        E({ type: 'in', kind: 'fixed', label: 'Versement de ' + names()[0], amount: 600, cat: 'versement', who: 'a', start: p(-6) }),
        E({ type: 'in', kind: 'fixed', label: 'Versement de ' + names()[1], amount: 750, cat: 'versement', who: 'b', start: p(-6) }),
        E({ type: 'in', kind: 'fixed', label: 'APL', amount: 190, cat: 'aides', who: 'both', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Loyer', amount: 760, cat: 'logement', who: 'both', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Courses (budget)', amount: 380, cat: 'courses', who: 'both', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Électricité', amount: 62, cat: 'logement', who: 'both', start: p(-6) }),
        E({ type: 'out', kind: 'fixed', label: 'Box internet', amount: 30, cat: 'abonnements', who: 'both', start: p(-6) }),
        E({ type: 'out', kind: 'once', label: 'Resto anniversaire', amount: 86, cat: 'sorties', who: 'both', date: m + '-04' }),
        E({ type: 'out', kind: 'once', label: 'Billets de train', amount: 124, cat: 'voyages', who: 'both', date: p(-1) + '-12' }),
        E({ type: 'out', kind: 'once', label: 'Weekend à Lyon', amount: 310, cat: 'voyages', who: 'both', date: p(-4) + '-15' })],
      goals: [{ id: 'g1', name: 'Voyage au Japon', target: 3000, deadline: p(10), color: 0, contribs: [{ m: p(-3), a: 250, who: 'a' }, { m: p(-2), a: 300, who: 'b' }, { m: p(-1), a: 150, who: 'both' }, { m, a: 100, who: 'both' }] }]
    };
  }
  let DEMO = null;
  const list = obj => Object.entries(obj || {}).map(([id, d]) => Object.assign({}, d, { id }));
  const real = () => ({ entries: list(ST.data.entries), goals: list(ST.data.goals) });
  const accounts = () => list(ST.data.accounts).sort((x, y) => (x.order ?? 99) - (y.order ?? 99) || x.name.localeCompare(y.name));
  const isDemo = () => { const r = real(); return !(r.entries.length || r.goals.length || accounts().some(a => (a.movements || []).length)); };
  const data = () => { if (isDemo()) { DEMO = DEMO || demo(); return DEMO; } return real(); };
  const balance = acc => (acc.movements || []).reduce((s, m) => s + m.a, 0);
  /* Intérêts d'un livret réglementé : calculés par quinzaine.
     Un dépôt rapporte à partir de la quinzaine suivante (le 1er ou le 16),
     un retrait cesse de rapporter dès la quinzaine où il a lieu.
     Estimation pour l'année entière au taux actuel, sans futurs mouvements. */
  function interests(acc, year) {
    const rate = (+acc.rate || 0) / 100; if (!rate) return 0;
    const qOf = d => { const [y, m, j] = d.split('-').map(Number); return { y, q: (m - 1) * 2 + (j >= 16 ? 1 : 0) }; };
    const mv = (acc.movements || []).map(m => { const { y, q } = qOf(m.date || today()); const start = y < year ? -1 : y > year ? 99 : (m.a > 0 && !m.initial ? q + 1 : q); return { a: m.a, start }; });
    let total = 0;
    for (let q = 0; q < 24; q++) { const bal = mv.reduce((s, m) => s + (q >= m.start ? m.a : 0), 0); total += Math.max(0, bal) * rate / 24; }
    return Math.round(total * 100) / 100;
  }

  /* ---------- stockage ---------- */
  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = 'index.html'; throw new Error('login'); }
    const { data, error } = await sb.from('members').select('user_id, person, name, household');
    if (error) throw error;
    const mine = (data || []).find(m => m.user_id === session.user.id);
    if (!mine) { location.href = 'index.html?attente=1'; throw new Error('login'); }
    const names = { noah: 'Noah', eve: 'Eve' };
    data.forEach(m => { names[m.person === 'a' ? 'noah' : 'eve'] = m.name; });
    ME = { person: mine.person === 'a' ? 'noah' : 'eve', names, household: mine.household, email: session.user.email };
  }
  async function loadServer() {
    const { data, error } = await sb.from('docs').select('col, id, doc').eq('household', ME.household).eq('space', SPACE);
    if (error) throw error;
    const d = { entries: {}, goals: {}, accounts: {} };
    (data || []).forEach(r => { if (d[r.col]) d[r.col][r.id] = r.doc; });
    ST = { version: Date.now(), data: d };
  }
  const key = (col, id) => ({ household: ME.household, space: SPACE, col, id });
  async function op(payload) {
    // application immédiate à l'écran, puis envoi à la base
    const b = ST.data[payload.col]; if (payload.doc === null) delete b[payload.id]; else b[payload.id] = payload.doc;
    render();
    try {
      const k = key(payload.col, payload.id);
      const { error } = payload.doc === null
        ? await sb.from('docs').delete().match(k)
        : await sb.from('docs').upsert(Object.assign({}, k, { doc: payload.doc }));
      if (error) throw error;
      setOnline(true); if (SHARED && payload.col === 'entries') queueSync(); return true;
    } catch (e) {
      setOnline(false); toast('Pas enregistré : vérifiez votre connexion internet');
      try { await loadServer(); } catch (_) { } render(); return false;
    }
  }
  const saveDoc = (col, id, doc) => op({ col, id: id || newId(), doc });
  const removeDoc = (col, id) => op({ col, id, doc: null });
  const rawDoc = (col, id) => JSON.parse(JSON.stringify(ST.data[col][id] || null));
  /* Enregistre la nouvelle version d'un document et propose « Annuler » pour revenir à l'ancienne. */
  async function saveWithUndo(col, id, doc, msg) {
    const prev = rawDoc(col, id);
    if (await (doc === null ? removeDoc(col, id) : saveDoc(col, id, doc))) toast(msg, prev ? () => saveDoc(col, id, prev) : null);
  }

  function setOnline(v) { if (S.online !== v) { S.online = v; renderSync(); } }
  let reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => { try { await loadServer(); setOnline(true); render(); queueSync(); } catch (_) { setOnline(false); } }, 250);
  }

  /* ---------- participations du Commun -> budget perso ----------
     Chaque participation que je saisis sur un achat commun crée dans MON budget perso une dépense
     du même nom (id « commun-<id de l'achat> », champ fromCommun). Elle est recalculée à chaque
     chargement : si l'achat change ou disparaît, ou si je retire ma part, elle suit.
     Chacun ne peut écrire que dans son propre budget (règles de la base) : la synchro est donc
     faite par la personne elle-même, depuis n'importe laquelle des deux pages. */
  const MIRROR = 'commun-';
  let syncQ = Promise.resolve();
  const queueSync = () => { syncQ = syncQ.then(syncMirrors).catch(() => { }); return syncQ; };
  async function syncMirrors() {
    if (!sb || !ME || S.mode !== 'server') return;
    const me = KEY[ME.person], base = { household: ME.household, space: me, col: 'entries' };
    let common, mine;
    if (SHARED) {
      common = ST.data.entries;
      const r = await sb.from('docs').select('id, doc').match(base).like('id', MIRROR + '%'); if (r.error) throw r.error;
      mine = Object.fromEntries((r.data || []).map(x => [x.id, x.doc]));
    } else {
      const r = await sb.from('docs').select('id, doc').match({ household: ME.household, space: 'commun', col: 'entries' }); if (r.error) throw r.error;
      common = Object.fromEntries((r.data || []).map(x => [x.id, x.doc]));
      mine = Object.fromEntries(Object.entries(ST.data.entries).filter(([id]) => id.startsWith(MIRROR)));
    }
    const want = {};
    for (const [id, e] of Object.entries(common || {})) {
      const part = partOf(e, me);
      if (e.type === 'out' && e.kind !== 'fixed' && e.who !== me && part > 0 && (MIRROR + id).length <= 64)
        want[MIRROR + id] = { type: 'out', kind: 'once', label: e.label, amount: part, cat: e.cat, date: e.date || today(), fromCommun: id };
    }
    const same = (a, b) => a && ['label', 'amount', 'cat', 'date', 'fromCommun'].every(k => a[k] === b[k]);
    const ups = Object.entries(want).filter(([id, d]) => !same(mine[id], d)).map(([id, d]) => Object.assign({}, base, { id, doc: Object.assign({}, d, { updatedAt: Date.now() }) }));
    const dels = Object.keys(mine).filter(id => !want[id]);
    if (!ups.length && !dels.length) return;
    if (ups.length) { const r = await sb.from('docs').upsert(ups); if (r.error) throw r.error; }
    for (const id of dels) { const r = await sb.from('docs').delete().match(Object.assign({}, base, { id })); if (r.error) throw r.error; }
    if (!SHARED) { await loadServer(); DEMO = null; render(); }
  }
  function subscribe() {
    sb.channel('docs-' + SPACE)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'household=eq.' + ME.household }, p => {
        const sp = (p.new && p.new.space) || (p.old && p.old.space);
        if (!sp || sp === SPACE) scheduleReload(); else if (sp === 'commun' && !SHARED) queueSync();
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') setOnline(true); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setOnline(false); });
  }
  async function poll() { if (!document.hidden && S.mode === 'server') scheduleReload(); }


  /* ---------- calculs ---------- */
  function inMonth(e, m) { if (e.kind === 'fixed') return e.start <= m && (!e.end || e.end >= m); return (e.date || '').slice(0, 7) === m; }
  function totals(m) {
    const { entries, goals } = data(); const list = entries.filter(e => inMonth(e, m));
    let inc = 0, out = 0, outF = 0;
    for (const e of list) { if (e.type === 'in') inc += e.amount; else { out += e.amount; if (e.kind === 'fixed') outF += e.amount; } }
    let sav = 0; for (const g of goals) for (const c of (g.contribs || [])) if (c.m === m) sav += c.a;
    for (const acc of accounts()) for (const mv of (acc.movements || [])) if (!mv.initial && (mv.date || '').slice(0, 7) === m) sav += mv.a;
    return { list, inc, out, outF, sav, rest: inc - out - sav };
  }
  const saved = g => (g.contribs || []).reduce((s, c) => s + c.a, 0);
  /* Participations à un achat commun ponctuel : champ facultatif doc.parts = { a: 120, b: 80 }.
     Les achats sans ce champ (tous ceux d'avant) restent valides. */
  const hasParts = e => SHARED && e.type === 'out' && e.kind !== 'fixed';
  const partOf = (e, k) => +((e.parts || {})[k]) || 0;
  const r2 = n => Math.round(n * 100) / 100;
  const otherOf = k => k === 'a' ? 'b' : 'a';
  /* Achat payé par une personne (who = 'a' ou 'b') : l'autre peut y ajouter sa participation,
     qui est retirée de ce qu'a payé l'acheteur. Achat commun (who = 'both') : chacun peut indiquer sa part. */
  const payerOf = e => (e.who === 'a' || e.who === 'b') ? e.who : null;
  /* Ce que chacun a réellement sorti de sa poche pour une dépense, et ce qui reste au pot commun. */
  function paidBy(e) {
    const r = { a: 0, b: 0, common: 0 }, pay = payerOf(e);
    if (pay) { const op = hasParts(e) ? Math.min(e.amount, partOf(e, otherOf(pay))) : 0; r[otherOf(pay)] = op; r[pay] = e.amount - op; }
    else { const pa = hasParts(e) ? partOf(e, 'a') : 0, pb = hasParts(e) ? partOf(e, 'b') : 0; r.a = pa; r.b = pb; r.common = e.amount - pa - pb; }
    return r;
  }

  /* ---------- graphiques ---------- */
  function donutSVG(parts, total) {
    const R = 48, C = 2 * Math.PI * R; let off = 0; const gap = parts.length > 1 ? 2.5 : 0;
    const segs = parts.map(p => { const len = Math.max(0, p.v / total * C - gap); const s = `<circle cx="75" cy="75" r="${R}" fill="none" stroke="${p.c}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"/>`; off += p.v / total * C; return s; }).join('');
    return `<svg viewBox="0 0 150 150" role="img" aria-label="Répartition des dépenses"><circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="20"/>${segs}<text x="75" y="76" text-anchor="middle" class="donut-total num" font-size="${eur0(total).length > 7 ? 17 : 20}">${eur0(total)}</text><text x="75" y="93" text-anchor="middle" class="donut-sub">dépensés</text></svg>`;
  }
  function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(x => n <= x) * p; }
  function barsSVG(months) {
    const W = 340, H = 190, L = 44, B = 24, T = 10, Rr = 8, iw = W - L - Rr, ih = H - T - B;
    const rows = months.map(m => Object.assign({ m }, totals(m)));
    const mx = niceMax(Math.max(...rows.map(r => Math.max(r.inc, r.out + r.sav)), 1));
    const y = v => T + ih - (v / mx) * ih, gw = iw / rows.length, bw = Math.min(16, gw / 3.2);
    let g = ''; for (let i = 0; i <= 4; i++) { const v = mx * i / 4; g += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax num" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v >= 1000 ? (v / 1000).toLocaleString('fr-FR') + ' k' : Math.round(v)}</text>`; }
    let b = '';
    rows.forEach((r, i) => {
      const cx = L + gw * i + gw / 2, cur = r.m === S.month, op = cur ? 1 : .75;
      b += `<rect x="${cx - bw - 1.5}" y="${y(r.inc)}" width="${bw}" height="${Math.max(0, y(0) - y(r.inc))}" rx="4" fill="var(--in)" opacity="${op}"/>`;
      b += `<rect x="${cx + 1.5}" y="${y(r.out)}" width="${bw}" height="${Math.max(0, y(0) - y(r.out))}" rx="4" fill="var(--out)" opacity="${op}"/>`;
      if (r.sav > 0) b += `<rect x="${cx + 1.5}" y="${y(r.out + r.sav)}" width="${bw}" height="${Math.max(0, y(r.out) - y(r.out + r.sav))}" rx="4" fill="var(--accent)" opacity="${op}"/>`;
      b += `<text class="ax" x="${cx}" y="${H - 7}" text-anchor="middle" ${cur ? 'style="font-weight:700;fill:var(--ink)"' : ''}>${MS[+r.m.slice(5) - 1]}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenus et dépenses sur six mois">${g}${b}</svg>`;
  }
  function ringSVG(pct, color) {
    const R = 22, C = 2 * Math.PI * R, len = Math.min(1, Math.max(0, pct)) * C;
    return `<svg class="ring" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="7"/><circle cx="28" cy="28" r="${R}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${len} ${C}" transform="rotate(-90 28 28)"/><text x="28" y="32" text-anchor="middle" font-size="12" class="num">${Math.round(pct * 100)}%</text></svg>`;
  }

  /* ---------- rendu ---------- */
  const main = document.getElementById('main');
  function banner() {
    let h = '';
    if (isDemo()) h += `<div class="banner"><b>Ceci est un exemple.</b> Appuyez sur + pour ajouter votre première entrée ${SHARED ? 'commune' : 'perso'} : l’exemple disparaîtra.</div>`;
    return h;
  }
  function whoChip(w) { return `<span class="chip ${w === 'a' || w === 'b' ? w : ''}">${esc(whoName(w))}</span>`; }
  function rowHTML(e, showDate) {
    const c = cat(e.type, e.cat), sub = [];
    if (SHARED) sub.push(whoChip(e.who));
    if (!SHARED && e.fromCommun) sub.push('<span class="chip">Ma part · Commun</span>');
    if (e.kind === 'fixed') sub.push('<span>chaque mois</span>');
    else if (showDate && e.date) { const [, mo, d] = e.date.split('-'); sub.push(`<span>${+d} ${MS[+mo - 1]}</span>`); }
    if (!SHARED || e.kind !== 'fixed') sub.push(`<span>${esc(c.l)}</span>`);
    let pl = '';
    const pay = payerOf(e);
    if (hasParts(e) && pay) {
      const op = partOf(e, otherOf(pay));
      if (op > 0) { const r = paidBy(e); pl = `<span class="s parts">${[pay, otherOf(pay)].map(k => `<span class="chip ${k}">${esc(spaceName(k))} ${eur(r[k])}</span>`).join('')}</span>`; }
    } else if (hasParts(e)) {
      const given = ['a', 'b'].filter(k => partOf(e, k) > 0), left = r2(e.amount - partOf(e, 'a') - partOf(e, 'b'));
      pl = !given.length ? '<span class="s parts"><span>Touchez pour indiquer votre part</span></span>'
        : `<span class="s parts">${given.map(k => `<span class="chip ${k}">${esc(spaceName(k))} ${eur(partOf(e, k))}</span>`).join('')}${left > 0 ? `<span>reste ${eur(left)}</span>` : left < 0 ? `<span class="over">${eur(-left)} de trop</span>` : '<span class="ok">réglé</span>'}</span>`;
    }
    return `<button class="row" data-edit="${esc(e.id)}"><span class="ico" style="background:${c.c}22;color:${c.c}">${esc(c.l.slice(0, 2))}</span><span class="mid"><span class="t">${esc(e.label)}</span><span class="s">${sub.join('')}</span>${pl}</span><span class="amt num ${e.type === 'in' ? 'in' : ''}">${e.type === 'in' ? '+' : '−'}${eur(e.amount)}</span></button>`;
  }
  function renderMois() {
    const t = totals(S.month), n = names(); let h = banner();
    const spentPct = t.inc > 0 ? Math.min(1, t.out / t.inc) : 0, savPct = t.inc > 0 ? Math.min(1 - spentPct, Math.max(0, t.sav) / t.inc) : 0;
    const who = SHARED ? 'du pot commun' : 'de ' + spaceName(SPACE);
    h += `<section class="card hero"><div><div class="label">Reste à vivre ${esc(who)} en ${esc(MONTHS[+S.month.slice(5) - 1])}</div><div class="big num ${t.rest < 0 ? 'neg' : ''}">${eur0(t.rest)}</div></div>
      <div class="stats"><div class="stat in"><span>${SHARED ? 'Rentrées' : 'Revenus'}</span><b class="num">${eur0(t.inc)}</b></div><div class="stat out"><span>Dépenses</span><b class="num">${eur0(t.out)}</b></div><div class="stat sav"><span>Épargné</span><b class="num">${eur0(t.sav)}</b></div></div>
      <div class="gauge" aria-hidden="true"><i style="width:${spentPct * 100}%;background:var(--out)"></i><i style="width:${savPct * 100}%;background:var(--accent)"></i></div>
      <div class="gnote">${t.inc > 0 ? `${Math.round(spentPct * 100)} % dépensés, ${Math.round(savPct * 100)} % mis de côté` : 'Ajoutez des revenus pour voir la jauge'}</div>
      ${t.inc > 0 ? `<div class="mood ${t.rest < 0 ? 'bad' : ''}">${t.rest < 0 ? 'Dans le rouge ce mois-ci : un œil sur les ponctuels ?' : t.rest >= t.inc * .1 ? (SHARED ? 'Joli mois, vous restez bien dans le vert.' : 'Joli mois, tu restes bien dans le vert.') : 'Dans le vert, de justesse.'}</div>` : ''}</section>`;
    const byCat = {}; for (const e of t.list) if (e.type === 'out') byCat[e.cat] = (byCat[e.cat] || 0) + e.amount;
    const parts = Object.entries(byCat).map(([k, v]) => Object.assign({}, cat('out', k), { v })).sort((a, b) => b.v - a.v);
    h += `<section class="card"><h2>Où part l’argent</h2>`;
    h += parts.length ? `<div class="donutrow">${donutSVG(parts, t.out)}<ul class="legend">${parts.map(p => `<li><i class="dot" style="background:${p.c}"></i><span class="nm">${esc(p.l)}</span><b class="num">${eur0(p.v)}</b><span class="pc num">${Math.round(p.v / t.out * 100)}%</span></li>`).join('')}</ul></div>` : `<div class="empty">Aucune dépense ce mois-ci.</div>`;
    h += `</section>`;
    if (SHARED) {
      const P = { a: { in: 0, out: 0 }, b: { in: 0, out: 0 } }; let common = 0;
      for (const e of t.list) {
        if (e.type === 'in') { if (e.who === 'a' || e.who === 'b') P[e.who].in += e.amount; continue; }
        const r = paidBy(e); P.a.out += r.a; P.b.out += r.b; common += r.common;
      }
      const ti = P.a.in + P.b.in;
      h += `<section class="card split"><h2>Qui met quoi</h2>`;
      if (ti > 0) { const pa = P.a.in / ti; h += `<div class="bar" role="img" aria-label="Part des versements : ${esc(n[0])} ${Math.round(pa * 100)} %, ${esc(n[1])} ${Math.round((1 - pa) * 100)} %"><i style="width:${pa * 100}%;background:var(--c-a)">${pa > .15 ? esc(n[0]) + ' ' + Math.round(pa * 100) + '%' : ''}</i><i style="width:${(1 - pa) * 100}%;background:var(--c-b)">${1 - pa > .15 ? esc(n[1]) + ' ' + Math.round((1 - pa) * 100) + '%' : ''}</i></div>`; }
      h += `<div class="people">${['a', 'b'].map(k => `<div class="person"><div class="who"><i style="background:var(--c-${k})"></i>${esc(spaceName(k))}</div><span>Verse <b class="num">${eur0(P[k].in)}</b></span><span>A payé <b class="num">${eur0(P[k].out)}</b></span></div>`).join('')}</div>`;
      h += `<div class="common-box"><div class="who"><i></i>Dépenses communes</div><b class="num">${eur0(common)}</b><span>payées avec le pot commun</span></div>`;
      h += `<p class="hint" style="margin:0">« A payé » : ce que chacun a avancé de sa poche, participations comprises. Notez chaque versement en rentrée avec le bon prénom.</p></section>`;
    }
    const inc = t.list.filter(e => e.type === 'in'), fx = t.list.filter(e => e.type === 'out' && e.kind === 'fixed'), on = t.list.filter(e => e.type === 'out' && e.kind !== 'fixed').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    h += `<section class="card"><h2>Le détail <button class="link" data-add="once">+ Ajouter</button></h2>${t.list.length && !isDemo() ? `<p class="hint" style="margin:-4px 0 6px">${SHARED ? 'Touchez un achat pour indiquer votre participation ou le modifier.' : 'Touchez une ligne pour la modifier, la dupliquer ou la supprimer.'}</p>` : ''}<div class="list">`;
    if (!t.list.length) h += `<div class="empty">Rien pour ce mois. Ajoutez une entrée avec le bouton +.</div>`;
    if (on.length) h += `<div class="group-t"><span>Ponctuels</span><span class="num">${eur0(on.reduce((s, e) => s + e.amount, 0))}</span></div>` + on.map(e => rowHTML(e, true)).join('');
    if (fx.length) h += `<div class="group-t"><span>Dépenses fixes</span><span class="num">${eur0(t.outF)}</span></div>` + fx.map(e => rowHTML(e)).join('');
    if (inc.length) h += `<div class="group-t"><span>${SHARED ? 'Rentrées' : 'Revenus'}</span><span class="num">${eur0(t.inc)}</span></div>` + inc.map(e => rowHTML(e, true)).join('');
    return h + `</div></section>`;
  }
  function renderFixes() {
    const fx = data().entries.filter(e => e.kind === 'fixed' && inMonth(e, S.month));
    const ins = fx.filter(e => e.type === 'in'), outs = fx.filter(e => e.type === 'out');
    const ti = ins.reduce((s, e) => s + e.amount, 0), to = outs.reduce((s, e) => s + e.amount, 0);
    let h = banner();
    h += `<section class="card hero"><div><div class="label">Ce qui reste chaque mois, une fois les fixes payés</div><div class="big num ${ti - to < 0 ? 'neg' : ''}">${eur0(ti - to)}</div></div><div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat in"><span>${SHARED ? 'Rentrées fixes' : 'Revenus fixes'}</span><b class="num">${eur0(ti)}</b></div><div class="stat out"><span>Charges fixes</span><b class="num">${eur0(to)}</b></div></div></section>`;
    h += `<section class="card"><h2>Charges fixes <button class="link" data-add="fixed-out">+ Ajouter</button></h2><div class="list">${outs.length ? outs.sort((a, b) => b.amount - a.amount).map(e => rowHTML(e)).join('') : `<div class="empty">${SHARED ? 'Loyer, courses, électricité, internet…' : 'Abonnements, transport, versement au pot commun…'}</div>`}</div></section>`;
    h += `<section class="card"><h2>${SHARED ? 'Rentrées fixes' : 'Revenus fixes'} <button class="link" data-add="fixed-in">+ Ajouter</button></h2><div class="list">${ins.length ? ins.map(e => rowHTML(e)).join('') : `<div class="empty">${SHARED ? 'Les versements de chacun, les APL…' : 'Salaire, alternance, bourse…'}</div>`}</div></section>`;
    return h;
  }
  function accountCard(acc) {
    const bal = balance(acc), cap = +acc.cap || 0, pct = cap ? bal / cap : 0, year = +S.month.slice(0, 4);
    const intr = interests(acc, year), mv = (acc.movements || []).slice().sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    const open = S.openAcc === acc.id, shown = open ? mv : mv.slice(0, 3);
    let h = `<div class="acc"><div class="acc-h"><button class="acc-name" data-acc-edit="${esc(acc.id)}">${esc(acc.name)}<span class="chip">${String(acc.rate).replace('.', ',')} %</span></button><b class="acc-bal num">${eur(bal)}</b></div>`;
    if (cap) h += `<div class="progress thin"><i style="width:${Math.min(100, Math.max(0, pct * 100))}%;background:${pct >= 1 ? 'var(--out)' : 'var(--accent)'}"></i></div><div class="acc-meta"><span>${pct >= 1 ? '<b>Plafond atteint</b>' : `${Math.round(pct * 100)} % du plafond (${eur0(cap)})`}</span><span>~ <b class="num">${eur(intr)}</b> d’intérêts en ${year}</span></div>`;
    else if (intr) h += `<div class="acc-meta"><span></span><span>~ <b class="num">${eur(intr)}</b> d’intérêts en ${year}</span></div>`;
    if (acc.note) h += `<div class="acc-note">${esc(acc.note)}</div>`;
    if (mv.length) h += `<div class="list mv">${shown.map(m => { const [, mo, d] = (m.date || '').split('-'); return `<button class="row" data-move="${esc(acc.id)}" data-mv="${esc(m.id)}"><span class="mid"><span class="t">${esc(m.label || (m.initial ? 'Solde de départ' : m.a > 0 ? 'Dépôt' : 'Retrait'))}</span><span class="s">${d ? `${+d} ${MS[+mo - 1]} ${m.date.slice(0, 4)}` : ''}</span></span><span class="amt num ${m.a > 0 ? 'in' : ''}">${m.initial ? '' : m.a > 0 ? '+' : '−'}${eur(Math.abs(m.a))}</span></button>`; }).join('')}</div>`;
    if (mv.length > 3) h += `<button class="link more" data-acc-toggle="${esc(acc.id)}">${open ? 'Réduire' : `Voir les ${mv.length} mouvements`}</button>`;
    h += `<div class="acc-act">${bal === 0 && !mv.length ? `<button class="btn small" data-deposit="${esc(acc.id)}" data-initial="1">Indiquer le solde</button>` : `<button class="btn small" data-deposit="${esc(acc.id)}">Déposer</button><button class="btn small ghost" data-withdraw="${esc(acc.id)}">Retirer</button>`}</div></div>`;
    return h;
  }
  function renderEpargne() {
    const { goals } = data(), accs = accounts(); let h = banner();
    const totS = goals.reduce((s, g) => s + saved(g), 0), totT = goals.reduce((s, g) => s + g.target, 0), totL = accs.reduce((s, a) => s + balance(a), 0);
    const year = +S.month.slice(0, 4), totI = accs.reduce((s, a) => s + interests(a, year), 0);
    h += `<section class="card hero"><div><div class="label">Épargne ${SHARED ? 'commune' : 'de ' + esc(spaceName(SPACE))}</div><div class="big num">${eur0(totL + totS)}</div></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat sav"><span>Livrets</span><b class="num">${eur0(totL)}</b></div><div class="stat sav"><span>Objectifs</span><b class="num">${eur0(totS)}</b></div><div class="stat in"><span>Intérêts ${year}</span><b class="num">~${eur0(totI)}</b></div></div></section>`;
    h += `<section class="card"><h2>${SHARED ? 'Comptes communs' : 'Livrets'} <button class="link" data-addacc="1">+ Ajouter</button></h2>`;
    h += accs.length ? accs.map(accountCard).join('') : `<div class="empty">${SHARED ? 'Un livret ou un compte joint ? Ajoutez-le ici.' : 'Aucun livret pour l’instant.'}<button class="btn small" data-addacc="1">Ajouter un compte</button></div>`;
    h += `<p class="hint" style="margin:12px 0 0">Touchez un mouvement pour le modifier ou le supprimer. Intérêts estimés par quinzaine, au taux actuel.</p></section>`;
    h += `<section class="card"><h2>Objectifs <button class="link" data-addgoal="1">+ Nouvel objectif</button></h2>`;
    void totT;
    if (!goals.length) h += `<div class="empty">${SHARED ? 'Un voyage, un appart, un coussin de sécurité…' : 'Un ordi, le permis, un coussin perso…'}<button class="btn small" data-addgoal="1">Créer un objectif</button></div>`;
    goals.forEach(g => {
      const s = saved(g), pct = g.target > 0 ? s / g.target : 0, col = GOAL_COLORS[(g.color || 0) % GOAL_COLORS.length];
      let need;
      if (s >= g.target) need = '<b>Objectif atteint</b> 🎉';
      else if (g.deadline) { const left = diffM(S.month, g.deadline); need = left > 0 ? `Il faut <b class="num">${eur0((g.target - s) / left)}</b> par mois jusqu’en ${esc(mLabel(g.deadline))}` : `Échéance dépassée (${esc(mLabel(g.deadline))})`; }
      else need = `Encore <b class="num">${eur0(g.target - s)}</b> à mettre de côté`;
      h += `<div class="goal"><div class="gh">${ringSVG(pct, col)}<div class="mid"><button class="gt" data-editgoal="${esc(g.id)}">${esc(g.name)}</button><div class="gs num">${eur(s)} sur ${eur(g.target)}</div></div><button class="btn small ghost" data-contrib="${esc(g.id)}">Verser</button></div><div class="progress"><i style="width:${Math.min(100, Math.max(0, pct * 100))}%;background:${col}"></i></div><div class="need">${need}</div></div>`;
    });
    return h + `</section>`;
  }
  function renderTendances() {
    const months = [...Array(6)].map((_, i) => addM(S.month, i - 5)), rows = months.map(m => totals(m));
    const avg = k => rows.reduce((s, r) => s + r[k], 0) / 6, avgIn = avg('inc'), avgOut = avg('out'), avgSav = avg('sav');
    let h = banner();
    h += `<section class="card chart"><h2>6 derniers mois</h2>${barsSVG(months)}<div class="keys"><span><i style="background:var(--in)"></i>${SHARED ? 'Rentrées' : 'Revenus'}</span><span><i style="background:var(--out)"></i>Dépenses</span><span><i style="background:var(--accent)"></i>Épargne</span></div></section>`;
    h += `<section class="card"><h2>En moyenne par mois</h2><div class="kpis"><div class="stat in"><span>${SHARED ? 'Rentrées' : 'Revenus'}</span><b class="num">${eur0(avgIn)}</b></div><div class="stat out"><span>Dépenses</span><b class="num">${eur0(avgOut)}</b></div><div class="stat sav"><span>Épargne</span><b class="num">${eur0(avgSav)}</b></div><div class="stat"><span>Taux d’épargne</span><b class="num">${avgIn > 0 ? Math.round(avgSav / avgIn * 100) : 0} %</b></div></div></section>`;
    const byCat = {}; months.forEach(m => data().entries.filter(e => e.type === 'out' && inMonth(e, m)).forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; }));
    const parts = Object.entries(byCat).map(([k, v]) => Object.assign({}, cat('out', k), { v })).sort((a, b) => b.v - a.v);
    h += `<section class="card"><h2>Les gros postes sur 6 mois</h2>`;
    h += parts.length ? `<div class="list" style="gap:10px">${parts.map(p => `<div><div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:4px"><span>${esc(p.l)}</span><b class="num">${eur0(p.v)}</b></div><div class="progress" style="height:8px"><i style="width:${p.v / parts[0].v * 100}%;background:${p.c}"></i></div></div>`).join('')}</div>` : '<div class="empty">Pas encore de dépenses.</div>';
    return h + `</section>`;
  }
  function renderSync() {
    const el = document.getElementById('sync'); if (!el) return;
    if (S.mode === 'server') { el.hidden = false; el.className = 'sync' + (S.online ? '' : ' off'); el.innerHTML = `<i></i>${S.online ? 'Synchronisé' : 'Hors ligne'}`; }
    else el.hidden = true;
  }
  function render() {
    const n = names();
    renderNav();
    document.title = (SHARED ? 'Commun' : spaceName(SPACE)) + ' · Notre budget';
    const ml = document.getElementById('month-label');
    ml.innerHTML = `${esc(mLabel(S.month))}<small>${S.month === ym() ? 'ce mois-ci' : diffM(ym(), S.month) > 0 ? 'à venir' : 'passé'}</small>`;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false'));
    renderSync();
    if (S.mode === 'loading') return;
    main.innerHTML = { mois: renderMois, fixes: renderFixes, epargne: renderEpargne, tendances: renderTendances }[S.tab]();
    void n;
  }

  /* ---------- formulaires ---------- */
  const root = document.getElementById('sheet-root');
  function openSheet(html, onReady) {
    root.innerHTML = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    const ov = document.getElementById('ov'); ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
    onReady(ov.querySelector('.sheet'));
    const f = ov.querySelector('input:not([type=radio])'); if (f && matchMedia('(min-width:640px)').matches) f.focus();
  }
  function closeSheet() { root.innerHTML = ''; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && root.innerHTML) closeSheet(); });
  function toast(msg, undo) {
    const r = document.getElementById('toast-root');
    r.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${undo ? '<button type="button" class="undo">Annuler</button>' : ''}</div>`;
    if (undo) r.querySelector('.undo').onclick = async () => { r.innerHTML = ''; clearTimeout(toast.t); if (await undo()) toast('Modification annulée'); };
    clearTimeout(toast.t); toast.t = setTimeout(() => { r.innerHTML = ''; }, undo ? 6000 : 2600);
  }

  const seg = (name, opts, val) => `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === val ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
  const whoSeg = val => seg('who', [['a', names()[0]], ['b', names()[1]], ['both', 'Commun']], val || 'both');
  const armDelete = (btn, fn) => { btn.onclick = () => { if (btn.dataset.armed) fn(); else { btn.dataset.armed = 1; btn.textContent = 'Confirmer ?'; } }; };

  function entrySheet(e, preset, template) {
    const isNew = !e;
    if (isNew && template) e = template;
    else if (isNew) {
      const t = preset === 'fixed-in' ? 'in' : 'out';
      e = { type: t, kind: preset && preset.startsWith('fixed') ? 'fixed' : 'once', label: '', amount: '', cat: t === 'in' ? (SHARED ? 'versement' : 'salaire') : (SHARED ? 'courses' : 'sorties'), who: 'both', date: S.month === ym() ? today() : S.month + '-01', start: S.month };
    }
    openSheet(`<h3>${isNew ? 'Nouvelle entrée' : 'Modifier'}</h3><form id="ef" novalidate>
      ${seg('type', [['out', 'Dépense'], ['in', SHARED ? 'Rentrée' : 'Revenu']], e.type)}
      <label class="field"><span>Montant</span><input class="amount num" id="f-amount" inputmode="decimal" placeholder="0 €" value="${e.amount === '' ? '' : String(e.amount).replace('.', ',')}" autocomplete="off"></label>
      <label class="field"><span>Libellé</span><input id="f-label" maxlength="60" placeholder="${SHARED ? 'Courses, loyer…' : 'Resto, cinéma…'}" value="${esc(e.label)}"></label>
      <div class="field"><span>Catégorie</span><div class="cats" id="f-cats"></div></div>
      ${SHARED ? `<div class="field"><span>Qui</span>${whoSeg(e.who)}</div>` : ''}
      <div class="field"><span>Fréquence</span>${seg('kind', [['once', 'Ponctuel'], ['fixed', 'Chaque mois']], e.kind)}</div>
      <div id="f-when"></div>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger small" id="f-del">Supprimer</button><button type="button" class="btn ghost small" id="f-dup">Dupliquer</button>'}<div class="r"><button type="button" class="btn ghost" id="f-cancel">Annuler</button><button class="btn" type="submit">${isNew ? 'Ajouter' : 'Enregistrer'}</button></div></div>
      <div id="f-delchoice" class="delchoice" hidden></div>
    </form>`, sh => {
      const f = sh.querySelector('#ef'), el = f.elements; let curCat = e.cat;
      const drawCats = () => { const t = el.type.value; if (!CATS[t].some(c => c.id === curCat)) curCat = CATS[t][0].id; sh.querySelector('#f-cats').innerHTML = CATS[t].map(c => `<label><input type="radio" name="cat" value="${c.id}" ${c.id === curCat ? 'checked' : ''}><span><i style="background:${c.c}"></i>${esc(c.l)}</span></label>`).join(''); };
      const drawWhen = () => {
        sh.querySelector('#f-when').innerHTML = el.kind.value === 'fixed'
          ? `<div class="two"><label class="field"><span>À partir de</span><input type="month" id="f-start" value="${esc(e.start || S.month)}"></label><label class="field"><span>Jusqu’à (optionnel)</span><input type="month" id="f-end" value="${esc(e.end || '')}"></label></div><p class="hint">Compté automatiquement chaque mois sur la période.</p>`
          : `<label class="field"><span>Date</span><input type="date" id="f-date" value="${esc(e.date || today())}"></label>`;
      };
      drawCats(); drawWhen();
      f.addEventListener('change', ev => { if (ev.target.name === 'type') drawCats(); if (ev.target.name === 'kind') drawWhen(); if (ev.target.name === 'cat') curCat = ev.target.value; });
      sh.querySelector('#f-cancel').onclick = closeSheet;
      const del = sh.querySelector('#f-del');
      if (del) {
        const stopFrom = S.month > (e.start || '') ? S.month : null;
        if (e.kind === 'fixed' && stopFrom) {
          del.onclick = () => {
            const box = sh.querySelector('#f-delchoice'); box.hidden = false;
            box.innerHTML = `<p class="hint" style="margin:0">Cette charge revient chaque mois depuis ${esc(mLabel(e.start))}. Que voulez-vous faire ?</p><button type="button" class="btn ghost" id="f-stop">L’arrêter à partir de ${esc(mLabel(stopFrom))}</button><button type="button" class="btn danger" id="f-wipe">La supprimer de tout l’historique</button>`;
            box.querySelector('#f-stop').onclick = async () => { const doc = rawDoc('entries', e.id); doc.end = addM(stopFrom, -1); closeSheet(); await saveWithUndo('entries', e.id, doc, `Arrêtée à partir de ${mLabel(stopFrom)}`); };
            box.querySelector('#f-wipe').onclick = async () => { closeSheet(); await saveWithUndo('entries', e.id, null, 'Entrée supprimée'); };
            box.scrollIntoView({ block: 'nearest' });
          };
        } else armDelete(del, async () => { closeSheet(); await saveWithUndo('entries', e.id, null, 'Entrée supprimée'); });
        sh.querySelector('#f-dup').onclick = () => { const copy = Object.assign({}, e); delete copy.id; delete copy.parts; if (copy.kind === 'once') copy.date = S.month === ym() ? today() : S.month + '-01'; else { copy.start = S.month; delete copy.end; } closeSheet(); entrySheet(null, null, copy); };
      }
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const amount = parseAmt(sh.querySelector('#f-amount').value), label = sh.querySelector('#f-label').value.trim();
        if (!(amount > 0)) { toast('Indiquez un montant supérieur à 0'); sh.querySelector('#f-amount').focus(); return; }
        const body = { type: el.type.value, kind: el.kind.value, label: label || cat(el.type.value, curCat).l, amount, cat: curCat, updatedAt: Date.now() };
        if (SHARED) body.who = el.who.value;
        if (!isNew && e.parts && hasParts(body)) {
          const parts = Object.assign({}, rawDoc('entries', e.id)?.parts || e.parts); if (payerOf(body)) delete parts[body.who];
          if (Object.keys(parts).length) body.parts = parts;
        }
        if (body.kind === 'fixed') {
          body.start = sh.querySelector('#f-start').value || S.month; const end = sh.querySelector('#f-end').value;
          if (end) { if (end < body.start) { toast('La date de fin est avant le début'); return; } body.end = end; }
        } else body.date = sh.querySelector('#f-date').value || today();
        closeSheet();
        if (isNew) { if (await saveDoc('entries', null, body)) toast('Ajouté'); }
        else await saveWithUndo('entries', e.id, body, 'Modifié');
        if (isNew && body.kind === 'once' && body.date.slice(0, 7) !== S.month) { S.month = body.date.slice(0, 7); render(); }
      });
    });
  }
  function partSheet(e) {
    const me = KEY[ME.person], other = otherOf(me), pay = payerOf(e), mine0 = partOf(e, me);
    const val = n => n ? String(n).replace('.', ',') : '';
    const card = (k, label, id, v) => `<div class="person"><div class="who"><i style="background:var(--c-${k})"></i>${esc(spaceName(k))}${k === me ? ' (moi)' : ''}</div><span>${label} <b class="num" id="${id}">${eur(v)}</b></span></div>`;
    const actions = submit => `<div class="actions"><button type="button" class="btn ghost small" id="p-edit">Modifier l’achat</button><div class="r"><button type="button" class="btn ghost" id="p-cancel">${submit ? 'Annuler' : 'Fermer'}</button>${submit ? '<button class="btn" type="submit">Enregistrer</button>' : ''}</div></div>`;
    const total = `<div class="part-total"><span>Prix de l’achat${pay ? ` · payé par ${esc(spaceName(pay))}` : ''}</span><b class="num">${eur(e.amount)}</b></div>`;
    const wire = sh => { sh.querySelector('#p-cancel').onclick = closeSheet; sh.querySelector('#p-edit').onclick = () => { closeSheet(); entrySheet(e); }; };

    // C'est moi qui ai payé : je vois la participation de l'autre, c'est à lui de la saisir.
    if (pay === me) {
      const r = paidBy(e);
      openSheet(`<h3>${esc(e.label)}</h3><form id="pf" novalidate>${total}
        <div class="people">${card(me, 'A payé', 'p-a', r[me])}${card(other, 'A participé', 'p-b', r[other])}</div>
        <p class="hint" style="margin:0">${r[other] > 0 ? `${esc(spaceName(other))} a participé : c’est déduit de ce que tu as payé.` : `${esc(spaceName(other))} peut toucher cet achat pour indiquer sa participation : elle sera déduite de ce que tu as payé.`}</p>
        ${actions(false)}</form>`, wire);
      return;
    }
    // Achat payé par l'autre (ma part est déduite de la sienne) ou achat du pot commun.
    const theirs = pay ? 0 : partOf(e, other), cap = r2(e.amount - theirs), half = r2(e.amount / 2);
    openSheet(`<h3>${esc(e.label)}</h3><form id="pf" novalidate>${total}
      <label class="field"><span>Ma participation</span><input class="amount num" id="p-mine" inputmode="decimal" placeholder="0 €" value="${val(mine0)}" autocomplete="off"></label>
      <div class="quick"><button type="button" class="btn ghost small" data-fill="${half}">La moitié · ${eur(half)}</button>${!pay && cap > 0 && cap !== half ? `<button type="button" class="btn ghost small" data-fill="${cap}">Tout le reste · ${eur(cap)}</button>` : ''}${mine0 ? '<button type="button" class="btn ghost small" data-fill="0">Retirer ma part</button>' : ''}</div>
      <div class="people">${pay ? card(pay, 'A payé', 'p-o', e.amount - mine0) + card(me, 'A participé', 'p-m', mine0) : card(me, 'A mis', 'p-m', mine0) + card(other, 'A mis', 'p-o', theirs)}</div>
      <p class="hint" id="p-hint" style="margin:0"></p>
      ${actions(true)}</form>`, sh => {
      wire(sh);
      const inp = sh.querySelector('#p-mine');
      const cur = () => { const v = inp.value.trim(); return v === '' ? 0 : parseAmt(v); };
      const upd = () => {
        const v = cur(), ok = v >= 0, h = sh.querySelector('#p-hint');
        sh.querySelector('#p-m').textContent = eur(ok ? v : 0);
        if (pay) sh.querySelector('#p-o').textContent = eur(Math.max(0, e.amount - (ok ? v : 0)));
        if (!ok) { h.textContent = 'Montant invalide'; return; }
        const left = r2(cap - v);
        h.textContent = left < 0 ? `C’est ${eur(-left)} de plus que le prix.`
          : pay ? `${spaceName(pay)} n’aura payé que ${eur(left)}, ta part de ${eur(v)} est déduite.`
          : left > 0 ? `Il restera ${eur(left)} pour le pot commun.` : 'L’achat est entièrement réglé.';
      };
      upd(); inp.addEventListener('input', upd);
      sh.querySelectorAll('[data-fill]').forEach(b => { b.onclick = () => { inp.value = val(+b.dataset.fill); upd(); }; });
      sh.querySelector('#pf').addEventListener('submit', async ev => {
        ev.preventDefault();
        const v = cur(); if (!(v >= 0)) { toast('Indiquez un montant (0 pour retirer votre part)'); inp.focus(); return; }
        const body = rawDoc('entries', e.id); if (!body) { closeSheet(); toast('Cet achat a été supprimé entre-temps'); return; }
        if (body.who === me) { closeSheet(); toast('Cet achat est maintenant à ton nom'); return; }
        const max = r2(body.amount - (payerOf(body) ? 0 : partOf(body, other)));
        if (v > max + 0.001) { toast(`Ça dépasse le prix : ta part peut aller jusqu’à ${eur(Math.max(0, max))}`); return; }
        const parts = Object.assign({}, body.parts); if (v > 0) parts[me] = v; else delete parts[me];
        if (Object.keys(parts).length) body.parts = parts; else delete body.parts;
        body.updatedAt = Date.now();
        closeSheet(); await saveWithUndo('entries', e.id, body, v > 0 ? `Ta part : ${eur(v)} · ajoutée à ton budget perso` : 'Ta part a été retirée (et de ton budget perso)');
      });
    });
  }
  function linkedSheet(e) {
    openSheet(`<h3>${esc(e.label)}</h3>
      <div class="part-total"><span>Ma participation à un achat commun</span><b class="num">${eur(e.amount)}</b></div>
      <p class="hint" style="margin:0">Cette dépense est créée et mise à jour automatiquement depuis la page Commun. Pour la changer ou la supprimer, modifiez votre participation sur l’achat là-bas.</p>
      <div class="actions"><div class="r"><button type="button" class="btn ghost" id="l-close">Fermer</button><a class="btn" href="${PAGES.commun}">Aller sur Commun</a></div></div>`, sh => { sh.querySelector('#l-close').onclick = closeSheet; });
  }
  function goalSheet(g) {
    const isNew = !g; g = g || { name: '', target: '', deadline: '', color: data().goals.length % GOAL_COLORS.length, contribs: [] };
    openSheet(`<h3>${isNew ? 'Nouvel objectif' : 'Modifier l’objectif'}</h3><form id="gf" novalidate>
      <label class="field"><span>Nom</span><input id="g-name" maxlength="50" placeholder="Voyage, appart, coussin de sécurité…" value="${esc(g.name)}"></label>
      <div class="two"><label class="field"><span>Montant visé</span><input id="g-target" inputmode="decimal" class="num" placeholder="2000" value="${g.target === '' ? '' : String(g.target).replace('.', ',')}"></label>
      <label class="field"><span>Pour quand (optionnel)</span><input type="month" id="g-dead" value="${esc(g.deadline || '')}"></label></div>
      <div class="field"><span>Couleur</span><div class="cats">${GOAL_COLORS.map((c, i) => `<label><input type="radio" name="col" value="${i}" ${i === (g.color || 0) ? 'checked' : ''}><span><i style="background:${c};width:14px;height:14px"></i></span></label>`).join('')}</div></div>
      ${!isNew && (g.contribs || []).length ? `<div class="field"><span>Versements · touchez pour modifier ou supprimer</span><div class="list">${g.contribs.map((c, i) => [c, i]).reverse().map(([c, i]) => `<button type="button" class="row" data-ci="${i}"><span class="mid"><span class="t">${esc(mLabel(c.m))}</span>${SHARED ? `<span class="s">${whoChip(c.who)}</span>` : ''}</span><span class="amt num ${c.a > 0 ? 'in' : ''}">${c.a < 0 ? '−' : '+'}${eur(Math.abs(c.a))}</span></button>`).join('')}</div></div>` : ''}
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger small" id="g-del">Supprimer</button>'}<div class="r"><button type="button" class="btn ghost" id="g-cancel">Annuler</button><button class="btn" type="submit">${isNew ? 'Créer' : 'Enregistrer'}</button></div></div>
    </form>`, sh => {
      const f = sh.querySelector('#gf'); sh.querySelector('#g-cancel').onclick = closeSheet;
      const del = sh.querySelector('#g-del'); if (del) armDelete(del, async () => { closeSheet(); await saveWithUndo('goals', g.id, null, 'Objectif supprimé'); });
      sh.querySelectorAll('[data-ci]').forEach(b => { b.onclick = () => { closeSheet(); contribSheet(g, +b.dataset.ci); }; });
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const name = sh.querySelector('#g-name').value.trim(), target = parseAmt(sh.querySelector('#g-target').value);
        if (!name) { toast('Donnez un nom à l’objectif'); return; } if (!(target > 0)) { toast('Indiquez un montant visé'); return; }
        const body = { name, target, deadline: sh.querySelector('#g-dead').value || '', color: +f.elements.col.value, contribs: g.contribs || [], updatedAt: Date.now() };
        closeSheet();
        if (isNew) { if (await saveDoc('goals', null, body)) toast('Objectif créé'); } else await saveWithUndo('goals', g.id, body, 'Objectif modifié');
      });
    });
  }
  function contribSheet(g, idx) {
    const editing = Number.isInteger(idx) && g.contribs && g.contribs[idx], c0 = editing ? g.contribs[idx] : { m: S.month, a: '', who: 'both' };
    openSheet(`<h3>${editing ? 'Modifier le versement' : `Verser pour « ${esc(g.name)} »`}</h3><form id="cf" novalidate>
      <label class="field"><span>Montant</span><input class="amount num" id="c-amount" inputmode="decimal" placeholder="50 €" value="${c0.a === '' ? '' : String(c0.a).replace('.', ',')}"></label>
      <p class="hint">Un montant négatif (−50) enregistre un retrait.</p>
      ${SHARED ? `<div class="field"><span>Qui</span>${whoSeg(c0.who || 'both')}</div>` : ''}
      <label class="field"><span>Mois</span><input type="month" id="c-month" value="${esc(c0.m)}"></label>
      <div class="actions">${editing ? '<button type="button" class="btn danger small" id="c-del">Supprimer</button>' : ''}<div class="r"><button type="button" class="btn ghost" id="c-cancel">Annuler</button><button class="btn" type="submit">${editing ? 'Enregistrer' : 'Verser'}</button></div></div>
    </form>`, sh => {
      const f = sh.querySelector('#cf'); sh.querySelector('#c-cancel').onclick = closeSheet;
      const withContribs = contribs => { const body = rawDoc('goals', g.id); body.contribs = contribs; body.updatedAt = Date.now(); return body; };
      const del = sh.querySelector('#c-del');
      if (del) armDelete(del, async () => { const cs = g.contribs.slice(); cs.splice(idx, 1); closeSheet(); await saveWithUndo('goals', g.id, withContribs(cs), 'Versement supprimé'); });
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const a = parseAmt(sh.querySelector('#c-amount').value); if (!a) { toast('Indiquez un montant'); return; }
        const c = { m: sh.querySelector('#c-month').value || S.month, a }; if (SHARED) c.who = f.elements.who.value;
        const cs = (g.contribs || []).slice(); if (editing) cs[idx] = c; else cs.push(c);
        closeSheet();
        if (editing) await saveWithUndo('goals', g.id, withContribs(cs), 'Versement modifié');
        else if (await saveDoc('goals', g.id, withContribs(cs.slice(-300)))) toast(a > 0 ? `${eur(a)} mis de côté` : 'Retrait enregistré');
      });
    });
  }
  function accountSheet(acc) {
    const isNew = !acc; acc = acc || Object.assign({}, ACCOUNT_PRESETS[SHARED ? 'autre' : 'livretA'], { note: '' });
    openSheet(`<h3>${isNew ? 'Nouveau compte' : 'Modifier le compte'}</h3><form id="af" novalidate>
      ${isNew ? `<div class="field"><span>Type</span><div class="cats">${Object.entries(ACCOUNT_PRESETS).map(([k, p]) => `<label><input type="radio" name="preset" value="${k}" ${p.name === acc.name ? 'checked' : ''}><span>${esc(k === 'autre' ? 'Autre' : p.name)}</span></label>`).join('')}</div></div>` : ''}
      <label class="field"><span>Nom</span><input id="a-name" maxlength="40" value="${esc(acc.name)}"></label>
      <div class="two"><label class="field"><span>Taux (%)</span><input id="a-rate" inputmode="decimal" class="num" value="${String(acc.rate ?? 0).replace('.', ',')}"></label>
      <label class="field"><span>Plafond (€, 0 = aucun)</span><input id="a-cap" inputmode="decimal" class="num" value="${String(acc.cap ?? 0).replace('.', ',')}"></label></div>
      <p class="hint">Livret A et LDDS : 1,7 %, LEP : 2,5 % depuis le 1er août 2026. Le taux du Livret Jeune dépend de la banque (au moins celui du Livret A).</p>
      <label class="field"><span>Note (optionnel)</span><input id="a-note" maxlength="80" placeholder="Banque, numéro de fin…" value="${esc(acc.note || '')}"></label>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger small" id="a-del">Supprimer</button>'}<div class="r"><button type="button" class="btn ghost" id="a-cancel">Annuler</button><button class="btn" type="submit">${isNew ? 'Ajouter' : 'Enregistrer'}</button></div></div>
    </form>`, sh => {
      const f = sh.querySelector('#af'); sh.querySelector('#a-cancel').onclick = closeSheet;
      f.addEventListener('change', ev => { if (ev.target.name === 'preset') { const p = ACCOUNT_PRESETS[ev.target.value]; sh.querySelector('#a-name').value = p.name; sh.querySelector('#a-rate').value = String(p.rate).replace('.', ','); sh.querySelector('#a-cap').value = p.cap; } });
      const del = sh.querySelector('#a-del'); if (del) armDelete(del, async () => { closeSheet(); await saveWithUndo('accounts', acc.id, null, `${acc.name} supprimé`); });
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const name = sh.querySelector('#a-name').value.trim(), rate = parseAmt(sh.querySelector('#a-rate').value), cap = parseAmt(sh.querySelector('#a-cap').value);
        if (!name) { toast('Donnez un nom au compte'); return; } if (!(rate >= 0)) { toast('Taux invalide'); return; } if (!(cap >= 0)) { toast('Plafond invalide'); return; }
        const body = isNew ? { order: accounts().length, movements: [] } : rawDoc('accounts', acc.id);
        Object.assign(body, { name, rate, cap, note: sh.querySelector('#a-note').value.trim(), updatedAt: Date.now() });
        closeSheet();
        if (isNew) { if (await saveDoc('accounts', null, body)) toast('Compte ajouté'); } else await saveWithUndo('accounts', acc.id, body, 'Compte modifié');
      });
    });
  }
  function moveSheet(acc, mvId, mode) {
    const mv = mvId ? (acc.movements || []).find(m => m.id === mvId) : null;
    const kind0 = mv ? (mv.initial ? 'initial' : mv.a > 0 ? 'dep' : 'ret') : (mode || 'dep');
    openSheet(`<h3>${esc(acc.name)}</h3><form id="mf" novalidate>
      ${seg('mk', [['dep', 'Dépôt'], ['ret', 'Retrait'], ['initial', 'Solde de départ']], kind0)}
      <label class="field"><span>Montant</span><input class="amount num" id="m-amount" inputmode="decimal" placeholder="0 €" value="${mv ? String(Math.abs(mv.a)).replace('.', ',') : ''}"></label>
      <div class="two"><label class="field"><span>Date</span><input type="date" id="m-date" value="${esc(mv ? mv.date : today())}"></label>
      <label class="field"><span>Libellé (optionnel)</span><input id="m-label" maxlength="50" placeholder="Virement mensuel…" value="${esc(mv && mv.label || '')}"></label></div>
      <p class="hint" id="m-hint"></p>
      <div class="actions">${mv ? '<button type="button" class="btn danger small" id="m-del">Supprimer</button>' : ''}<div class="r"><button type="button" class="btn ghost" id="m-cancel">Annuler</button><button class="btn" type="submit">${mv ? 'Enregistrer' : 'Valider'}</button></div></div>
    </form>`, sh => {
      const f = sh.querySelector('#mf'); sh.querySelector('#m-cancel').onclick = closeSheet;
      const others = (acc.movements || []).filter(m => m !== mv), balOthers = others.reduce((s, m) => s + m.a, 0);
      const hint = () => { const k = f.elements.mk.value; sh.querySelector('#m-hint').textContent = k === 'initial' ? 'Le solde du compte à cette date. Il ne compte pas comme une épargne du mois.' : k === 'dep' ? `Compté comme épargne du mois. Il rapporte à partir de la quinzaine suivante.${+acc.cap ? ` Place restante : ${eur(Math.max(0, acc.cap - balOthers))}.` : ''}` : `Solde disponible : ${eur(balOthers)}.`; };
      hint(); f.addEventListener('change', hint);
      const withMoves = moves => { const body = rawDoc('accounts', acc.id); body.movements = moves; body.updatedAt = Date.now(); return body; };
      const del = sh.querySelector('#m-del'); if (del) armDelete(del, async () => { closeSheet(); await saveWithUndo('accounts', acc.id, withMoves(others), 'Mouvement supprimé'); });
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const k = f.elements.mk.value, amt = parseAmt(sh.querySelector('#m-amount').value);
        if (!(amt > 0)) { toast('Indiquez un montant supérieur à 0'); return; }
        const a = k === 'ret' ? -amt : amt;
        if (k === 'ret' && amt > balOthers + 0.001) { toast(`Retrait impossible : il n’y a que ${eur(balOthers)} sur le compte`); return; }
        if (k === 'dep' && +acc.cap && balOthers + amt > acc.cap + 0.001) { toast(`Ce dépôt dépasserait le plafond de ${eur0(acc.cap)}`); return; }
        const m = { id: mv ? mv.id : newId(), a, date: sh.querySelector('#m-date').value || today(), label: sh.querySelector('#m-label').value.trim() };
        if (k === 'initial') m.initial = true;
        closeSheet();
        if (mv) await saveWithUndo('accounts', acc.id, withMoves(others.concat([m])), 'Mouvement modifié');
        else if (await saveDoc('accounts', acc.id, withMoves(others.concat([m]).slice(-500)))) toast(k === 'ret' ? `${eur(amt)} retirés` : k === 'initial' ? 'Solde enregistré' : `${eur(amt)} déposés`);
      });
    });
  }
  function chooserSheet() {
    const accs = accounts();
    openSheet(`<h3>Ajouter</h3><div class="choices">
      ${accs.map(a => `<button type="button" class="choice" data-c-dep="${esc(a.id)}"><b>Dépôt sur ${esc(a.name)}</b><span>Solde ${eur(balance(a))}</span></button>`).join('')}
      <button type="button" class="choice" data-c-goal="1"><b>Nouvel objectif</b><span>Voyage, appart, coussin…</span></button>
      <button type="button" class="choice" data-c-acc="1"><b>Nouveau compte</b><span>Livret, LDDS, compte joint…</span></button></div>`, sh => {
      sh.querySelectorAll('[data-c-dep]').forEach(b => { b.onclick = () => { const a = accounts().find(x => x.id === b.dataset.cDep); closeSheet(); if (a) moveSheet(a, null, balance(a) === 0 && !(a.movements || []).length ? 'initial' : 'dep'); }; });
      sh.querySelector('[data-c-goal]').onclick = () => { closeSheet(); goalSheet(); };
      sh.querySelector('[data-c-acc]').onclick = () => { closeSheet(); accountSheet(); };
    });
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportCSV() {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', rows = [['Type', 'Fréquence', 'Libellé', 'Catégorie', 'Montant', 'Date / début', 'Fin', 'Qui'].concat(SHARED ? ['Part ' + names()[0], 'Part ' + names()[1]] : [])];
    real().entries.forEach(e => rows.push([e.type === 'in' ? 'Revenu' : 'Dépense', e.kind === 'fixed' ? 'Chaque mois' : 'Ponctuel', e.label, cat(e.type, e.cat).l, String(e.type === 'in' ? e.amount : -e.amount).replace('.', ','), e.kind === 'fixed' ? e.start : e.date, e.end || '', SHARED ? whoName(e.who) : spaceName(SPACE)].concat(SHARED ? ['a', 'b'].map(k => partOf(e, k) ? String(partOf(e, k)).replace('.', ',') : '') : [])));
    accounts().forEach(a => (a.movements || []).forEach(m => rows.push([m.initial ? 'Solde de départ' : m.a > 0 ? 'Dépôt' : 'Retrait', 'Épargne', m.label || '', a.name, String(m.a).replace('.', ','), m.date, '', ''])));
    download(`budget-${SHARED ? 'commun' : spaceName(SPACE).toLowerCase()}-${today()}.csv`, '﻿' + rows.map(r => r.map(q).join(';')).join('\n'), 'text/csv;charset=utf-8');
  }
  function renderNav() {
    const nav = document.getElementById('spaces'); if (!nav || !ME) return;
    const mine = KEY[ME.person];
    const link = (page, sp, label) => `<a href="${PAGES[page]}" data-sp="${sp}" ${page === PAGE ? 'aria-current="page"' : ''}><i></i><span>${esc(label)}</span></a>`;
    nav.innerHTML = link('perso', mine, 'Mon budget') + link('commun', 'commun', 'Commun');
  }
  function settingsSheet() {
    openSheet(`<h3>${esc(ME ? ME.names[ME.person] : '')}</h3><div class="choices">
        <button type="button" class="choice" id="s-code"><b>Changer mon mot de passe</b><span>${esc(ME ? ME.email : '')}</span></button>
        <button type="button" class="choice" id="s-csv"><b>Exporter cette page en CSV</b><span>Pour Excel ou Numbers</span></button>
        <button type="button" class="choice" id="s-json"><b>Télécharger une sauvegarde de cette page</b><span>Fichier .json</span></button>
        <label class="choice" for="s-import"><b>Restaurer une sauvegarde de cette page</b><span>Remplace les données actuelles de ${SHARED ? 'Commun' : 'Mon budget'}</span></label><input type="file" id="s-import" accept="application/json,.json" hidden>
        <button type="button" class="choice" id="s-net"><b>Ouvrir sur un autre appareil</b><span>QR code à scanner</span></button>
        <button type="button" class="choice" id="s-logout"><b>Se déconnecter</b><span>Sur cet appareil</span></button>
      </div>
      <div class="actions"><div class="r"><button type="button" class="btn ghost" id="s-cancel">Fermer</button></div></div>`, sh => {
      sh.querySelector('#s-cancel').onclick = closeSheet;
      sh.querySelector('#s-code').onclick = () => { closeSheet(); codeSheet(); };
      sh.querySelector('#s-csv').onclick = () => { exportCSV(); toast('Export CSV téléchargé'); };
      sh.querySelector('#s-json').onclick = () => { download(`budget-${DIR[SPACE]}-${today()}.json`, JSON.stringify({ space: DIR[SPACE], data: ST.data }, null, 1), 'application/json'); toast('Sauvegarde téléchargée'); };
      sh.querySelector('#s-import').onchange = async ev => {
        const file = ev.target.files[0]; if (!file) return;
        let j; try { j = JSON.parse(await file.text()); } catch (_) { toast('Ce fichier n’est pas une sauvegarde valide'); return; }
        if (!j || !j.data || j.space !== DIR[SPACE]) { toast('Cette sauvegarde ne correspond pas à cette page'); return; }
        closeSheet();
        try {
          const rows = []; for (const c of ['entries', 'goals', 'accounts']) for (const [id, doc] of Object.entries(j.data[c] || {})) rows.push(Object.assign(key(c, id), { doc }));
          let r = await sb.from('docs').delete().match({ household: ME.household, space: SPACE }); if (r.error) throw r.error;
          if (rows.length) { r = await sb.from('docs').insert(rows); if (r.error) throw r.error; }
          await loadServer(); DEMO = null; render(); toast('Sauvegarde restaurée');
        } catch (_) { toast('Restauration impossible'); try { await loadServer(); render(); } catch (__) { } }
      };
      sh.querySelector('#s-net').onclick = () => { closeSheet(); shareSheet(); };
      sh.querySelector('#s-logout').onclick = async () => { try { await sb.auth.signOut(); } catch (_) { } location.href = 'index.html'; };
    });
  }
  async function shareSheet() {
    const urls = [new URL('./', location.href).href.replace(/\/$/, '')];
    const best = urls.find(u => /\/\/\d/.test(u)) || urls[0];
    let svg = '';
    try { const q = qrcode(0, 'M'); q.addData(best + '/'); q.make(); svg = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (_) { }
    openSheet(`<h3>Ouvrir sur un autre appareil</h3>
      <div class="share-sheet">${svg ? `<div class="qr big">${svg}</div>` : ''}
        <p class="hint" style="margin:0;text-align:center">Scannez avec l’appareil photo du téléphone, puis « Ajouter à l’écran d’accueil » pour l’avoir comme une appli.</p>
        <div class="field"><span>Ou tapez l’adresse</span>${urls.map(u => `<code class="addr">${esc(u)}</code>`).join('')}</div></div>
      <div class="actions"><div class="r"><button type="button" class="btn ghost" id="q-close">Fermer</button></div></div>`, sh => { sh.querySelector('#q-close').onclick = closeSheet; });
  }
  function codeSheet() {
    openSheet(`<h3>Changer mon mot de passe</h3><form id="kf" novalidate>
      <label class="field"><span>Mot de passe actuel</span><input id="k-cur" type="password" autocomplete="current-password"></label>
      <label class="field"><span>Nouveau mot de passe (8 caractères minimum)</span><input id="k-new" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Confirmer</span><input id="k-new2" type="password" autocomplete="new-password"></label>
      <div class="actions"><div class="r"><button type="button" class="btn ghost" id="k-cancel">Annuler</button><button class="btn" type="submit">Changer</button></div></div>
    </form>`, sh => {
      sh.querySelector('#k-cancel').onclick = closeSheet;
      sh.querySelector('#kf').addEventListener('submit', async ev => {
        ev.preventDefault();
        const cur = sh.querySelector('#k-cur').value, nw = sh.querySelector('#k-new').value;
        if (nw.length < 8) { toast('8 caractères minimum'); return; }
        if (nw !== sh.querySelector('#k-new2').value) { toast('Les deux mots de passe sont différents'); return; }
        const chk = await sb.auth.signInWithPassword({ email: ME.email, password: cur });
        if (chk.error) { toast('Mot de passe actuel incorrect'); return; }
        const { error } = await sb.auth.updateUser({ password: nw });
        if (error) { toast('Changement impossible : ' + error.message); return; }
        closeSheet(); toast('Mot de passe changé');
      });
    });
  }

  /* ---------- événements ---------- */
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; S.tab = b.dataset.tab; try { sessionStorage.setItem('nb-tab', S.tab); } catch (_) { } render(); window.scrollTo({ top: 0 }); });
  document.getElementById('prev').onclick = () => { S.month = addM(S.month, -1); remember(); render(); };
  document.getElementById('next').onclick = () => { S.month = addM(S.month, 1); remember(); render(); };
  document.getElementById('btn-settings').onclick = settingsSheet;
  document.getElementById('fab').onclick = () => { if (S.tab === 'epargne') chooserSheet(); else if (S.tab === 'fixes') entrySheet(null, 'fixed-out'); else entrySheet(null, 'once'); };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-edit],[data-add],[data-addgoal],[data-editgoal],[data-contrib],[data-addacc],[data-acc-edit],[data-acc-toggle],[data-deposit],[data-withdraw],[data-move]'); if (!t) return;
    if (t.dataset.add !== undefined) return entrySheet(null, t.dataset.add);
    if (t.dataset.addgoal !== undefined) return goalSheet();
    if (t.dataset.addacc !== undefined) return accountSheet();
    const acc = id => accounts().find(a => a.id === id);
    if (t.dataset.accEdit) { const a = acc(t.dataset.accEdit); if (a) accountSheet(a); return; }
    if (t.dataset.accToggle) { S.openAcc = S.openAcc === t.dataset.accToggle ? null : t.dataset.accToggle; return render(); }
    if (t.dataset.deposit) { const a = acc(t.dataset.deposit); if (a) moveSheet(a, null, t.dataset.initial ? 'initial' : 'dep'); return; }
    if (t.dataset.withdraw) { const a = acc(t.dataset.withdraw); if (a) moveSheet(a, null, 'ret'); return; }
    if (t.dataset.move) { const a = acc(t.dataset.move); if (a) moveSheet(a, t.dataset.mv); return; }
    if (isDemo()) return toast('C’est un exemple : ajoutez vos propres entrées avec +');
    const { entries, goals } = data();
    if (t.dataset.edit) { const en = entries.find(x => x.id === t.dataset.edit); if (en) (!SHARED && en.fromCommun ? linkedSheet(en) : hasParts(en) ? partSheet(en) : entrySheet(en)); }
    if (t.dataset.editgoal) { const g = goals.find(x => x.id === t.dataset.editgoal); if (g) goalSheet(g); }
    if (t.dataset.contrib) { const g = goals.find(x => x.id === t.dataset.contrib); if (g) contribSheet(g); }
  });
  // On garde l'onglet et le mois quand on passe d'une page à l'autre.
  function remember() { try { sessionStorage.setItem('nb-month', S.month); } catch (_) { } }

  /* ---------- démarrage ---------- */
  try { const t = sessionStorage.getItem('nb-tab'); if (['mois', 'fixes', 'epargne', 'tendances'].includes(t)) S.tab = t; const m = sessionStorage.getItem('nb-month'); if (/^\d{4}-\d{2}$/.test(m || '')) S.month = m; } catch (_) { }
  render();
  (async () => {
    if (!sb) { main.innerHTML = '<div class="card"><div class="empty">L’appli n’est pas encore reliée à Supabase : remplissez <b>config.js</b> (voir le guide).</div></div>'; return; }
    try {
      await loadMe();
      if (!SHARED) SPACE = KEY[ME.person];
      await loadServer(); S.mode = 'server';
    } catch (e) { if (e.message !== 'login') main.innerHTML = '<div class="card"><div class="empty">Impossible de charger le budget. Vérifiez votre connexion internet, puis rechargez la page.</div></div>'; return; }
    DEMO = null; render();
    queueSync();
    subscribe();
    setInterval(poll, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('online', poll);
  })();
})();
