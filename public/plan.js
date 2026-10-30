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

/* Hands-on minutes, hands-free minutes and vessel for every step.
   A step may override any of these with act / wait / on (on: a VESSELS key or "none"). */
function modelSteps(r) {
  let last = null;
  const fallback = vesselFromEquip(r.equip);
  return (r.steps || []).map((s, i) => {
    const text = `${s.t}. ${s.x}`;
    let v = vesselFromText(text);
    if (!v && HEAT_RE.test(text)) v = last || fallback;
    if (s.on !== undefined) v = s.on === "none" ? null : s.on;
    if (v) last = v;
    const before = BEFORE_RE.test(text);
    const d = minutesIn(s.x);
    const total = d.reduce((a, b) => a + b.mins, 0);
    let act, wait;
    if (before) { act = 2; wait = 0; }
    else if (WAIT_RE.test(text)) {
      act = 2;
      wait = total || (PASTA_RE.test(text) ? 10 : 8);
      if (PASTA_RE.test(text)) wait += 6;                        // water coming to the boil
      if (/pressure cook/i.test(text) && v === "ip") wait += 10; // coming up to pressure
    } else {
      act = Math.max(1.5, total + 1); wait = 0;
    }
    if (s.act != null) act = s.act;
    if (s.wait != null) wait = s.wait;
    // what this step waits for: the previous step (all of it, or only its hands-on part when it can overlap
    // the previous step's waiting time) plus anything listed in `after`
    const deps = [...(i > 0 && !s.overlap ? [i - 1] : []), ...(s.after || [])];
    return { i, t: s.t, act: round(act), wait: round(wait), on: v, before, deps };
  });
}
const round = n => Math.round(n * 2) / 2;

/* ---------- prep work (chopping etc.) pulled out of ingredient names ---------- */
const PREP_RE = /\b(chop|chopped|dice|diced|mince|minced|slice|sliced|grate|grated|cube|cubed|cut|slit|trim|trimmed|zest|zested|juiced|crush|crushed|julienne|shred|shredded|halve|halved|quartered|peel|peeled|deseed|deseeded|florets|strips|wedges|torn|broken)\b/i;
const NO_PREP_RE = /\bcans?\b|\btin\b|frozen|store-bought|powder|\bpaste\b|flakes|cooked rice|leftover/i;
function prepMinutes(it) {
  const n = it.n.toLowerCase();
  if (/chicken|mutton|beef|pork|fish|salmon|prawn|tofu|paneer|meat/.test(n)) return 4;
  if (/onion|shallot|potato|carrot|beans|cabbage|capsicum|pepper|broccoli|cauliflower|tomato|cucumber|eggplant|brinjal|okra/.test(n)) {
    const count = !it.u && it.q ? it.q : it.u === "g" && it.q ? it.q / 120 : 1;
    return Math.min(6, 1.5 + count);
  }
  return 1.5;
}
function prepTasks(r, uses, steps) {
  steps = steps || modelSteps(r);
  // prep must be ready before the run of back-to-back hot steps that leads into where it's used
  const blockAt = f => { let m = f; while (m > 0 && steps[m - 1].on && steps[m - 1].wait === 0 && !steps[m].overlap) m--; return m; };
  const firstUse = {};
  (r.steps || []).forEach((s, si) => (uses(si) || []).forEach(k => { if (firstUse[k] == null) firstUse[k] = si; }));
  const byStep = {};
  (r.groups || []).forEach((g, gi) => g.items.forEach((it, ii) => {
    if (!PREP_RE.test(it.n) || NO_PREP_RE.test(it.n)) return;
    const key = gi + "." + ii, si = blockAt(firstUse[key] ?? 0);
    (byStep[si] = byStep[si] || []).push({ key, mins: prepMinutes(it) });
  }));
  return Object.entries(byStep).map(([si, items]) => ({
    feeds: +si, items: items.map(x => x.key),
    act: round(Math.min(15, items.reduce((a, b) => a + b.mins, 0))),
  })).sort((a, b) => a.feeds - b.feeds);
}

/* ---------- the plan ---------- */
/* dishes: [{ steps: modelSteps(), prep: prepTasks() }]
   state:  { now, dishes: [{ next, waitEnd: { step: minute } }], prepDone: Set("p<dish>.<step>"), busy: [{ key, until }] }
   opts:   { hands, kitchen, release: [minute per dish] }
   Times are minutes. Task keys: "s<dish>.<step>" for steps, "p<dish>.<step>" for the prep feeding that step.
   Returns { tasks: [{ key, dish, kind, start, end, waitEnd }], finish, finishes }. */
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
    const span = {};
    d.steps.forEach((s, i) => { if (!s.on) return; const x = span[s.on] = span[s.on] || { first: i, last: i }; x.last = i; });
    const tail = d.steps.map((_, i) => d.steps.slice(i).reduce((a, s) => a + s.act + s.wait, 0));
    // Prep has to be ready before the run of back-to-back hot steps leading into the step it feeds,
    // so nothing scorches while you chop. Waiting time or a cold step breaks the run.
    const blockAt = f => { let m = f; while (m > 0 && d.steps[m - 1].on && d.steps[m - 1].wait === 0 && !d.steps[m].overlap) m--; return m; };
    return { ...d, di, next: st.next || 0, waitEnd: { ...(st.waitEnd || {}) }, span, tail, held: {},
             prepLeft: d.prep.filter(p => !state.prepDone.has(`p${di}.${p.feeds}`)).map(p => ({ ...p, block: blockAt(p.feeds) })) };
  });
  const doneAt = (d, j) => j < d.next && !((d.waitEnd[j] || 0) > t + 1e-9);
  const stillUsing = (d, v) => { const sp = d.span[v]; return sp.last >= d.next || (d.waitEnd[sp.last] || 0) > t + 1e-9; };
  const running = [], out = [];
  const startUsing = (d, n) => { const v = d.steps[n].on; if (v && !d.held[v]) d.held[v] = takeUnit(VESSELS[v].res) || "over"; };
  // what's already on the stove from earlier steps, and work already in someone's hands
  for (const d of D) for (const v of Object.keys(d.span)) if (d.span[v].first < d.next && stillUsing(d, v)) d.held[v] = takeUnit(VESSELS[v].res) || "over";
  for (const b of state.busy || []) {
    const [kind, di, n] = parseKey(b.key), end = Math.max(b.until, t + 0.5);
    if (kind === "s") startUsing(D[di], n);
    running.push({ key: b.key, dish: di, kind, end, n });
    out.push({ key: b.key, dish: di, kind, start: t, end, waitEnd: null, busy: true });
  }
  for (let guard = 0; guard < 3000; guard++) {
    for (let k = running.length - 1; k >= 0; k--) {
      const r = running[k]; if (r.end > t + 1e-9) continue;
      running.splice(k, 1);
      const d = D[r.dish];
      if (r.kind === "s") {
        d.next = r.n + 1;
        const w = d.steps[r.n].wait;
        if (w > 0) { d.waitEnd[r.n] = t + w; const o = out.find(x => x.key === r.key); if (o) o.waitEnd = t + w; }
      } else d.prepLeft = d.prepLeft.filter(p => `p${r.dish}.${p.feeds}` !== r.key);
    }
    for (const d of D) for (const v of Object.keys(d.held)) if (!stillUsing(d, v) && !running.some(r => r.dish === d.di && r.kind === "s" && d.steps[r.n].on === v)) {
      const u = d.held[v]; delete d.held[v]; if (u && u !== "over") pool[u]++;
    }
    const allDone = D.every(d => d.next >= d.steps.length && !d.prepLeft.length && Object.values(d.waitEnd).every(w => w <= t + 1e-9));
    if (allDone && !running.length) break;
    let free = hands - running.length;
    while (free > 0) {
      const cands = [];
      for (const d of D) {
        const n = d.next, s = d.steps[n];
        if (s && !running.some(r => r.dish === d.di && r.kind === "s") && s.deps.every(j => doneAt(d, j)) &&
            t + 1e-9 >= (release[d.di] || 0) && !d.prepLeft.some(p => p.block <= n) &&
            (!s.on || d.held[s.on] || canTake(VESSELS[s.on].res)))
          cands.push({ kind: "s", d, n, act: s.act, pri: hotRun(d, n) ? 1e6 : 1000 + d.tail[n] });
        for (const p of d.prepLeft) {
          if (running.some(r => r.key === `p${d.di}.${p.feeds}`)) continue;
          // prep holding a dish up ranks with that dish; the rest fills spare time, soonest-needed first
          const blocking = p.block <= n;
          cands.push({ kind: "p", d, n: p.feeds, act: p.act, pri: blocking ? 1000.5 + (d.tail[n] || 0) : 500 - (p.feeds - n) * 10 + d.tail[p.feeds] / 100 });
        }
      }
      if (!cands.length) break;
      cands.sort((a, b) => b.pri - a.pri);
      const c = cands[0], key = `${c.kind}${c.d.di}.${c.n}`;
      if (c.kind === "s") startUsing(c.d, c.n);
      running.push({ key, dish: c.d.di, kind: c.kind, end: t + c.act, n: c.n });
      out.push({ key, dish: c.d.di, kind: c.kind, start: t, end: t + c.act, waitEnd: null });
      free--;
    }
    const nexts = [...running.map(r => r.end), ...D.flatMap(d => Object.values(d.waitEnd)).filter(w => w > t + 1e-9), ...release.filter(x => x > t + 1e-9)];
    if (!nexts.length) break;
    t = Math.min(...nexts);
  }
  const finishes = D.map(d => Math.max(state.now, ...Object.values(d.waitEnd), ...out.filter(o => o.dish === d.di).map(o => Math.max(o.end, o.waitEnd || 0))));
  const stuck = D.some(d => d.next < d.steps.length || d.prepLeft.length);
  return { tasks: out, finish: Math.max(state.now, ...finishes), finishes, stuck };
}
/* Step n carries straight on in a pan that's already hot (previous step on the same vessel, no waiting). */
function hotRun(d, n) {
  const prev = d.steps[n - 1], s = d.steps[n];
  return !!(prev && prev.on && prev.wait === 0 && s.on === prev.on && !s.overlap && d.next === n);
}
const parseKey = key => { const m = /^([sp])(\d+)\.(\d+)$/.exec(key); return [m[1], +m[2], +m[3]]; };

/* "Serve together": hold back shorter dishes so they all land close to the slowest one. */
function plan(dishes, state, opts) {
  const fastest = simulate(dishes, state, opts);
  if (opts.mode !== "together") return fastest;
  const started = state.dishes.map(s => (s?.next || 0) > 0);
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

root.CookPlan = { VESSELS, KITCHEN, modelSteps, prepTasks, simulate, plan, parseKey, minutesIn };
})(typeof window !== "undefined" ? window : globalThis);
