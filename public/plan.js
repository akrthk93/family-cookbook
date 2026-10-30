/* Cook together: step model + multi-dish scheduler.
   Pure functions, no DOM, so it runs in the app and in tests (node). */
(function (root) {
"use strict";

/* ---------- kitchen ---------- */
// Which shared thing a vessel ties up. "big" needs a big burner; "burner" takes any (small first).
const VESSELS = {
  ip:    { res: "ip",     name: "Instant Pot" },
  af:    { res: "af",     name: "air fryer" },
  pc:    { res: "big",    name: "pressure cooker" },
  wok:   { res: "big",    name: "wok" },
  pan:   { res: "big",    name: "skillet" },
  deep:  { res: "big",    name: "deep pan" },
  pot:   { res: "big",    name: "big pot" },
  tawa:  { res: "big",    name: "tawa" },
  steam: { res: "big",    name: "steamer" },
  sauce: { res: "burner", name: "saucepan" },
};
const KITCHEN = { ip: 1, af: 1, big: 2, small: 1 };

/* ---------- reading a step ---------- */
const DUR_RE = /(\d+(?:\.\d+)?|[½¼¾])(?:\s*(?:[–-]|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b(?!\s+(?:less|more|past|longer|before|after|under|over|shorter)\b)/gi;
function minutesIn(text) {
  const out = [];
  for (const m of String(text).matchAll(DUR_RE)) {
    const lo = { "½": .5, "¼": .25, "¾": .75 }[m[1]] ?? parseFloat(m[1]);
    const u = m[3].toLowerCase();
    out.push({ at: m.index, mins: lo * (u.startsWith("s") ? 1 / 60 : u.startsWith("h") ? 60 : 1) });
  }
  return out;
}
const V_RE = [
  ["af",    /air[ -]?fr/i],
  ["pc",    /\bpressure cooker\b|whistle|hawkins/i],
  ["ip",    /instant pot|\bIP\b|pressure cook|sauté (?:mode|function)|set to sauté|natural release|quick release|valve|lock the lid|seal(?:ing)? (?:the )?lid|seal lid|the pot\b/i],
  ["tawa",  /tawa|griddle/i],
  ["steam", /idli|steamer/i],
  ["wok",   /\bwok\b|kadai|kadhai/i],
  ["sauce", /saucepan|small pan|small pot|milk pan/i],
  ["pot",   /pasta pot|stockpot|large pot|pot of (?:well-)?(?:heavily )?salted water|salted water|boil(?:ing)? water/i],
  ["pan",   /skillet|frying pan|\bpan\b|non-?stick/i],
];
const HEAT_RE = /\b(heat|cook|fry|fried|saut|simmer|stir|boil|brown|toast|reduce|add|toss|bring|render|sear|wilt|scramble|melt|deglaze|temper|bloom|crack|smash|flip|warm|caramel)/i;
const WAIT_RE = /pressure cook|natural release|marinat|\brest\b|let (?:it )?(?:sit|rest)|soak|chill|refrigerat|air fry|simmer|braise|steep|cover(?:ed)?,? (?:and )?cook|steam|bring .*to (?:a )?(?:gentle )?boil|boil the pasta|cook (?:the )?(?:spaghetti|pasta|orecchiette|penne|noodles)|thaw/i;
const PASTA_RE = /(?:cook|boil) (?:the )?(?:spaghetti|pasta|orecchiette|penne|noodles)|boil the pasta|salted water/i;
const BEFORE_RE = /overnight|the night before|day before/i;

function vesselFromText(t) { for (const [v, re] of V_RE) if (re.test(t)) return v; return null; }
function vesselFromEquip(equip) {
  const e = String(equip || "");
  for (const [v, re] of V_RE) if (re.test(e)) return v;
  return /pot/i.test(e) ? "pot" : null;
}

/* A recipe as a list of tasks ("units"): one per step, or one per part when a step has parts
   (air fry 5 min, toss, air fry 5 min; pressure cook until it beeps, natural release 10 min).
   Each unit: { i: step, j: part, nj: parts in step, act, wait, until, on, before, deps: [{ u, full }] }
   A dep with full=false only needs that unit's hands-on part done (it can overlap its waiting time).
   Steps may set act / wait / on (VESSELS key or "none") / overlap / after / parts; missing values are estimated. */
function modelSteps(r) {
  let last = null;
  const fallback = vesselFromEquip(r.equip);
  const units = [], first = [], lastU = [];
  (r.steps || []).forEach((s, i) => {
    const text = `${s.t}. ${s.x}`;
    let v = vesselFromText(text);
    if (!v && HEAT_RE.test(text)) v = last || fallback;
    if (s.on !== undefined) v = s.on === "none" ? null : s.on;
    if (v) last = v;
    const before = BEFORE_RE.test(text);
    const parts = Array.isArray(s.parts) && s.parts.length ? s.parts : [{ x: s.x, act: s.act, wait: s.wait }];
    first[i] = units.length;
    parts.forEach((pt, j) => {
      let { act, wait } = pt;
      if (act == null || wait == null) {
        const est = estimate(`${s.t}. ${pt.x}`, pt.x, v, before);
        if (act == null) act = est.act;
        if (wait == null) wait = est.wait;
      }
      const deps = [];
      if (j > 0) deps.push({ u: units.length - 1, full: true });
      else {
        if (i > 0) deps.push(s.overlap ? { u: first[i - 1], full: false } : { u: lastU[i - 1], full: true });
        for (const a of s.after || []) if (lastU[a] != null) deps.push({ u: lastU[a], full: true });
      }
      units.push({ i, j, nj: parts.length, t: s.t, act: round(act), wait: round(wait), until: pt.until || null, on: v, before, deps });
    });
    lastU[i] = units.length - 1;
  });
  // A run of back-to-back hot steps can't stop halfway, so it only starts once everything it needs is ready:
  // move any outside dependency of a later unit in the run to the unit that starts the run.
  for (let u = 1; u < units.length; u++) {
    if (!hotLink(units, u)) continue;
    let m = u; while (hotLink(units, m)) m--;
    for (const dep of units[u].deps) if (dep.u < m && !units[m].deps.some(x => x.u === dep.u && x.full === dep.full)) units[m].deps.push(dep);
  }
  return units;
}
function estimate(text, x, v, before) {
  const total = minutesIn(x).reduce((a, b) => a + b.mins, 0);
  if (before) return { act: 2, wait: 0 };
  if (WAIT_RE.test(text)) {
    let wait = total || (PASTA_RE.test(text) ? 10 : 8);
    if (PASTA_RE.test(text)) wait += 6;                        // water coming to the boil
    if (/pressure cook/i.test(text) && v === "ip") wait += 10; // coming up to pressure
    return { act: 2, wait };
  }
  return { act: Math.max(1.5, total + 1), wait: 0 };
}
const round = n => Math.round(n * 2) / 2;
const firstUnitOf = (units, i) => units.findIndex(u => u.i === i);
/* Unit m carries straight on from m-1 in the same hot pan: no waiting in between, so nothing may cut in. */
const hotLink = (units, m) => m > 0 && !!units[m - 1].on && units[m - 1].wait === 0 && units[m].on === units[m - 1].on &&
  units[m].deps.some(d => d.u === m - 1 && d.full);

/* ---------- prep work (chopping etc.) pulled out of ingredient names ---------- */
const PREP_RE = /\b(chop|chopped|dice|diced|mince|minced|slice|sliced|grate|grated|cube|cubed|cut|slit|trim|trimmed|zest|zested|juiced|crush|crushed|julienne|shred|shredded|halve|halved|quartered|peel|peeled|deseed|deseeded|florets|strips|wedges|torn|broken)\b/i;
const NO_PREP_RE = /\bcans?\b|\btin\b|frozen|store-bought|powder|\bpaste\b|flakes|cooked rice|leftover|grated coconut|desiccated/i;
function prepMinutes(it) {
  const n = it.n.toLowerCase();
  if (/chicken|mutton|beef|pork|fish|salmon|prawn|tofu|paneer|meat/.test(n)) return 4;
  if (/onion|shallot|potato|carrot|beans|cabbage|capsicum|pepper|broccoli|cauliflower|tomato|cucumber|eggplant|brinjal|okra/.test(n)) {
    const count = !it.u && it.q ? it.q : it.u === "g" && it.q ? it.q / 120 : 1;
    return Math.min(6, 1.5 + count);
  }
  return 1.5;
}
/* One chop-and-measure task per hot run: everything has to be ready before the pan goes on.
   uses(step) lists "g.i" (or "g.i@qty") keys; items marked skip are left out. Returns [{ feeds: unit, items, act }]. */
function prepTasks(r, uses, units) {
  units = units || modelSteps(r);
  const blockAt = m => { while (hotLink(units, m)) m--; return m; };
  const firstUse = {};
  (r.steps || []).forEach((s, si) => (uses(si) || []).forEach(k => { k = String(k).split("@")[0]; if (firstUse[k] == null) firstUse[k] = si; }));
  const byUnit = {};
  (r.groups || []).forEach((g, gi) => g.items.forEach((it, ii) => {
    if (it.skip || !PREP_RE.test(it.n) || NO_PREP_RE.test(it.n)) return;
    const key = gi + "." + ii, u = blockAt(Math.max(0, firstUnitOf(units, firstUse[key] ?? 0)));
    (byUnit[u] = byUnit[u] || []).push({ key, mins: prepMinutes(it), step: firstUse[key] ?? 0 });
  }));
  return Object.entries(byUnit).map(([u, items]) => ({
    feeds: +u, items: items.map(x => x.key), steps: [...new Set(items.map(x => x.step))].sort((a, b) => a - b),
    act: round(Math.min(15, items.reduce((a, b) => a + b.mins, 0))),
  })).sort((a, b) => a.feeds - b.feeds);
}

/* ---------- the plan ---------- */
/* dishes: [{ steps: modelSteps(), prep: prepTasks() }]
   state:  { now, dishes: [{ done: [unit], waitEnd: { unit: minute } }], prepDone: Set("p<dish>.<unit>"), busy: [{ key, until }] }
   opts:   { hands, kitchen, release: [minute per dish] }
   Times are minutes. Keys: "s<dish>.<unit>" for steps, "p<dish>.<unit>" for the prep that unit needs first.
   Units with no hands-on time (a natural release) start by themselves and take no hands.
   Returns { tasks: [{ key, dish, kind, start, end, waitEnd }], finish, finishes, stuck }. */
function simulate(dishes, state, opts) {
  const hands = opts.hands || 1, K = { ...KITCHEN, ...(opts.kitchen || {}) }, release = opts.release || [];
  const pool = { ip: K.ip, af: K.af, big: K.big, small: K.small };
  const takeUnit = res => {
    if (res === "burner") { if (pool.small > 0) { pool.small--; return "small"; } if (pool.big > 0) { pool.big--; return "big"; } return null; }
    if (pool[res] > 0) { pool[res]--; return res; }
    return null;
  };
  const canTake = res => res === "burner" ? pool.small + pool.big > 0 : pool[res] > 0;
  let t = state.now;
  const D = dishes.map((d, di) => {
    const st = state.dishes[di] || {};
    const U = d.steps;
    const span = {};
    U.forEach((s, u) => { if (!s.on) return; const x = span[s.on] = span[s.on] || { first: u, last: u }; x.last = u; });
    const tail = U.map((_, u) => U.slice(u).reduce((a, s) => a + s.act + s.wait, 0));
    const blockAt = m => { while (hotLink(U, m)) m--; return m; };
    return { ...d, di, U, done: new Set(st.done || []), waitEnd: { ...(st.waitEnd || {}) }, span, tail, held: {},
             prepLeft: d.prep.filter(p => !state.prepDone.has(`p${di}.${p.feeds}`)).map(p => ({ ...p, block: blockAt(p.feeds) })) };
  });
  const waitOver = (d, u) => !((d.waitEnd[u] || 0) > t + 1e-9);
  const depOk = (d, dep) => d.done.has(dep.u) && (!dep.full || waitOver(d, dep.u));
  const inRun = (d, u) => running.some(r => r.dish === d.di && r.kind === "s" && r.n === u);
  const stillUsing = (d, v) => { const sp = d.span[v];
    for (let u = sp.first; u <= sp.last; u++) if (d.U[u].on === v && (!d.done.has(u) || !waitOver(d, u))) return true;
    return false; };
  const started = (d, v) => { const sp = d.span[v]; for (let u = sp.first; u <= sp.last; u++) if (d.U[u].on === v && (d.done.has(u) || inRun(d, u))) return true; return false; };
  const running = [], out = [];
  const startUsing = (d, u) => { const v = d.U[u].on; if (v && !d.held[v]) d.held[v] = takeUnit(VESSELS[v].res) || "over"; };
  for (const b of state.busy || []) {
    const [kind, di, n] = parseKey(b.key), end = Math.max(b.until, t + 0.5);
    running.push({ key: b.key, dish: di, kind, end, n });
    out.push({ key: b.key, dish: di, kind, start: t, end, waitEnd: null, busy: true });
  }
  for (const d of D) for (const v of Object.keys(d.span)) if (started(d, v) && stillUsing(d, v)) d.held[v] = takeUnit(VESSELS[v].res) || "over";
  for (const r of running) if (r.kind === "s") startUsing(D[r.dish], r.n);
  const record = (d, u, kind, start, end) => { const key = `${kind}${d.di}.${u}`; running.push({ key, dish: d.di, kind, end, n: u }); out.push({ key, dish: d.di, kind, start, end, waitEnd: null }); };
  for (let guard = 0; guard < 5000; guard++) {
    for (let k = running.length - 1; k >= 0; k--) {
      const r = running[k]; if (r.end > t + 1e-9) continue;
      running.splice(k, 1);
      const d = D[r.dish];
      if (r.kind === "s") {
        d.done.add(r.n);
        const w = d.U[r.n].wait;
        if (w > 0) { d.waitEnd[r.n] = t + w; const o = out.find(x => x.key === r.key); if (o) o.waitEnd = t + w; }
      } else d.prepLeft = d.prepLeft.filter(p => `p${r.dish}.${p.feeds}` !== r.key);
    }
    for (const d of D) for (const v of Object.keys(d.held)) if (!stillUsing(d, v)) { const unit = d.held[v]; delete d.held[v]; if (unit && unit !== "over") pool[unit]++; }
    const allDone = D.every(d => d.done.size >= d.U.length && !d.prepLeft.length && Object.values(d.waitEnd).every(w => w <= t + 1e-9));
    if (allDone && !running.length) break;
    const ready = (d, u) => !d.done.has(u) && !inRun(d, u) && d.U[u].deps.every(dep => depOk(d, dep)) &&
      t + 1e-9 >= (release[d.di] || 0) && !d.prepLeft.some(p => p.block <= u) &&
      (!d.U[u].on || d.held[d.U[u].on] || canTake(VESSELS[d.U[u].on].res));
    // no-hands units (a natural release) just start
    let moved = false;
    for (const d of D) d.U.forEach((s, u) => { if (s.act <= 0 && ready(d, u)) { startUsing(d, u); record(d, u, "s", t, t); moved = true; } });
    if (moved) continue;
    let free = hands - running.filter(r => r.end > t + 1e-9).length;
    while (free > 0) {
      const cands = [];
      for (const d of D) {
        d.U.forEach((s, u) => {
          if (!(s.act > 0 && ready(d, u))) return;
          // what's due right now comes first: carrying on in a hot pan, then whatever follows a timer
          // that just ended on the heat (shake the basket, drain the pasta) before it overcooks
          const prev = d.U[u - 1], afterHeat = prev && prev.on && prev.wait > 0 && d.done.has(u - 1) && s.deps.some(x => x.u === u - 1 && x.full);
          const pri = hotLink(d.U, u) && d.done.has(u - 1) ? 1e6 : afterHeat ? 5e5 + (t - (d.waitEnd[u - 1] || t)) : 1000 + d.tail[u];
          cands.push({ kind: "s", d, n: u, act: s.act, pri: pri - u * 1e-3 });
        });
        const nextU = d.U.findIndex((_, u) => !d.done.has(u));
        for (const p of d.prepLeft) {
          if (running.some(r => r.key === `p${d.di}.${p.feeds}`)) continue;
          // prep holding a dish up ranks with that dish; the rest fills spare time, soonest-needed first
          const blocking = nextU >= 0 && p.block <= nextU;
          cands.push({ kind: "p", d, n: p.feeds, act: p.act, pri: blocking ? 1000.5 + (d.tail[nextU] || 0) : 500 - (p.feeds - Math.max(0, nextU)) * 10 + (d.tail[p.feeds] || 0) / 100 });
        }
      }
      if (!cands.length) break;
      cands.sort((a, b) => b.pri - a.pri);
      const c = cands[0];
      if (c.kind === "s") startUsing(c.d, c.n);
      record(c.d, c.n, c.kind, t, t + c.act);
      free--;
    }
    const nexts = [...running.map(r => r.end).filter(e => e > t + 1e-9), ...D.flatMap(d => Object.values(d.waitEnd)).filter(w => w > t + 1e-9), ...release.filter(x => x > t + 1e-9)];
    if (!nexts.length) break;
    t = Math.min(...nexts);
  }
  const finishes = D.map(d => Math.max(state.now, ...Object.values(d.waitEnd), ...out.filter(o => o.dish === d.di).map(o => Math.max(o.end, o.waitEnd || 0))));
  const stuck = D.some(d => d.done.size < d.U.length || d.prepLeft.length);
  return { tasks: out, finish: Math.max(state.now, ...finishes), finishes, stuck };
}
const parseKey = key => { const m = /^([sp])(\d+)\.(\d+)$/.exec(key); return [m[1], +m[2], +m[3]]; };

/* "Serve together": hold back shorter dishes so they all land close to the slowest one. */
function plan(dishes, state, opts) {
  const fastest = simulate(dishes, state, opts);
  if (opts.mode !== "together") return fastest;
  const started = state.dishes.map(s => (s?.done || []).length > 0);
  let release = dishes.map(() => 0), best = fastest;
  for (let k = 0; k < 4; k++) {
    const target = best.finish;
    const next = release.map((r, di) => started[di] ? 0 : Math.max(state.now, r + (target - best.finishes[di]) - 2));
    const sim = simulate(dishes, state, { ...opts, release: next });
    if (sim.finish > fastest.finish + 5) break;      // don't trade more than 5 min of total time for alignment
    release = next; best = sim;
  }
  return best;
}

root.CookPlan = { VESSELS, KITCHEN, modelSteps, prepTasks, simulate, plan, parseKey, minutesIn, hotLink };
})(typeof window !== "undefined" ? window : globalThis);
