/* Kitchen: what you own, what your recipes need, and what to buy, upgrade or cut.
   Pure functions, no DOM, so it runs in the app and in tests (node). */
(function (root) {
"use strict";

const CATS = [
  ["cookware", "Stovetop cookware"], ["appliances", "Appliances"], ["knives", "Knives and boards"],
  ["prep", "Prep tools"], ["utensils", "Cooking utensils"], ["measuring", "Measuring"],
  ["storage", "Storage and meal prep"], ["specialty", "Specialty"],
];

/* Kinds of gear. `ladder` is the material progression, lowest first; `enough` is the step on it worth
   getting to (past that is optional); `keepAll` means owning several tiers makes sense (a nonstick pan
   for eggs next to a stainless one), so lower tiers aren't flagged as replaced. `every` = every recipe. */
const ROLES = {
  pan:         { name: "Skillet or frying pan", cat: "cookware", ladder: ["nonstick", "stainless", "carbon steel"], enough: 1, keepAll: true },
  deep:        { name: "Sauté pan (deep, with lid)", cat: "cookware", ladder: ["nonstick", "stainless"], enough: 1 },
  wok:         { name: "Wok", cat: "cookware", ladder: ["nonstick", "carbon steel"], enough: 1 },
  pot:         { name: "Stockpot or pasta pot", cat: "cookware", ladder: ["aluminium", "stainless", "stainless tri-ply"], enough: 1 },
  sauce:       { name: "Saucepan or small pan", cat: "cookware", ladder: ["aluminium", "nonstick", "stainless", "stainless tri-ply"], enough: 1, keepAll: true },
  tawa:        { name: "Tawa or griddle", cat: "cookware", ladder: ["nonstick", "cast iron"], enough: 0 },
  pc:          { name: "Stovetop pressure cooker", cat: "cookware", ladder: ["aluminium", "stainless"], enough: 1 },
  steam:       { name: "Steamer", cat: "specialty" },
  ip:          { name: "Instant Pot", cat: "appliances" },
  af:          { name: "Air fryer", cat: "appliances" },
  blender:     { name: "Hand blender", cat: "appliances" },
  mixie:       { name: "Mixie (mixer-grinder)", cat: "appliances" },
  trivet:      { name: "Trivet and steel bowl (pot-in-pot)", cat: "specialty" },
  knife:       { name: "Chef's knife", cat: "knives", ladder: ["stamped soft steel", "Victorinox / forged German", "Japanese (VG10)", "carbon steel"], enough: 1, keepAll: true, every: true },
  board:       { name: "Cutting board", cat: "knives", ladder: ["plastic", "wood", "end-grain"], enough: 0, keepAll: true, every: true },
  sharpener:   { name: "Sharpener", cat: "knives", ladder: ["pull-through", "whetstone"], enough: 1 },
  mortar:      { name: "Mortar and pestle", cat: "prep" },
  sieve:       { name: "Fine-mesh sieve", cat: "prep" },
  colander:    { name: "Colander", cat: "prep" },
  grater:      { name: "Microplane or fine grater", cat: "prep" },
  scale:       { name: "Digital scale", cat: "measuring", every: true },
  thermometer: { name: "Instant-read thermometer", cat: "measuring" },
};
const MATERIALS = [...new Set(Object.values(ROLES).flatMap(r => r.ladder || []).concat(["cast iron", "enamelled cast iron", "hard-anodised", "copper", "plastic", "silicone", "glass", "wood"]))];

/* What a recipe needs: pans from the step data (`on`), tools from the words in it. */
const TOOL_RE = {
  blender: s => /\bblend/i.test(s) && !/mixie|mixer|grinder|jar/i.test(s),
  mixie: s => /mixie|mixer-grinder|\bgrind/i.test(s),
  mortar: s => /mortar|pestle/i.test(s),
  sieve: s => /\bstrain|sieve/i.test(s),
  colander: s => /\bdrain\b|draining|colander/i.test(s),
  grater: s => /\bzest|\bgrate|grated|microplane/i.test(s),
  trivet: s => /trivet|steel bowl/i.test(s),
  thermometer: s => [...s.matchAll(/(\d+)\s*°C/g)].some(m => +m[1] < 100),   // food temperatures, not an air fryer setting
};
function recipeNeeds(r) {
  const need = new Set();
  for (const s of r.steps || []) if (s.on && s.on !== "none" && ROLES[s.on]) need.add(s.on);
  const texts = [r.equip || "", ...(r.steps || []).map(s => `${s.t}. ${s.x}`), ...(r.groups || []).flatMap(g => g.items.map(i => i.n)), ...(r.notes || [])];
  for (const [role, test] of Object.entries(TOOL_RE)) if (texts.some(test)) need.add(role);
  return need;
}
/* kinds of gear the recipes can tell us about (a sharpener never shows up in a recipe) */
const LINKED = new Set(["pan", "deep", "wok", "pot", "sauce", "tawa", "pc", "steam", "ip", "af", ...Object.keys(TOOL_RE), ...Object.keys(ROLES).filter(r => ROLES[r].every)]);
const tierOf = it => { const L = ROLES[it.role]?.ladder; if (!L || !it.material) return -1; return L.findIndex(m => m.toLowerCase() === String(it.material).toLowerCase()); };

/* items: [{ id, name, cat, role, material, status: owned|check|want, condition: good|worn|replace }]
   recipes: the recipe list. Returns everything the Kitchen screen shows. */
function analyse(items, recipes) {
  const owned = items.filter(i => (i.status || "owned") === "owned");
  const roles = {};
  for (const role of Object.keys(ROLES)) roles[role] = { recipes: [], owned: owned.filter(i => i.role === role) };
  for (const r of recipes) {
    for (const role of recipeNeeds(r)) roles[role].recipes.push(r.id);
    for (const [role, def] of Object.entries(ROLES)) if (def.every && !roles[role].recipes.includes(r.id)) roles[role].recipes.push(r.id);
  }
  const uses = it => it.role && roles[it.role] ? roles[it.role].recipes.length : null;
  const buy = [], upgrade = [], cut = [], replace = [];
  const unsure = role => items.some(i => i.status === "check" && i.role === role);
  for (const [role, x] of Object.entries(roles)) {
    if (!x.recipes.length || x.owned.length || unsure(role)) continue;   // "not sure" items are asked about first
    buy.push({ role, name: ROLES[role].name, n: x.recipes.length, recipes: x.recipes, wanted: items.find(i => i.status === "want" && i.role === role) || null });
  }
  for (const it of items.filter(i => i.status === "want" && !(i.role && roles[i.role] && !roles[i.role].owned.length && roles[i.role].recipes.length)))
    buy.push({ role: it.role || null, name: it.name, n: uses(it) || 0, recipes: it.role ? roles[it.role]?.recipes || [] : [], wanted: it, upgradeOf: it.role ? roles[it.role]?.owned.filter(o => tierOf(o) >= 0 && tierOf(o) < tierOf(it)).map(o => o.name) : [] });
  for (const [role, x] of Object.entries(roles)) {
    const def = ROLES[role]; if (!def.ladder || !x.owned.length) continue;
    const best = x.owned.reduce((a, b) => tierOf(b) > tierOf(a) ? b : a);
    const t = tierOf(best);
    if (t >= 0 && t < def.enough && x.recipes.length >= 4 && !items.some(i => i.status === "want" && i.role === role && tierOf(i) > t))
      upgrade.push({ item: best, from: def.ladder[t], to: def.ladder[t + 1], n: x.recipes.length });
    if (!def.keepAll) for (const o of x.owned) if (o !== best && !o.keep && tierOf(o) >= 0 && tierOf(o) < t) cut.push({ item: o, why: `Replaced by your ${best.name.toLowerCase()}` });
  }
  for (const it of owned) {
    if (!it.keep && it.role && LINKED.has(it.role) && !roles[it.role].recipes.length && !cut.some(c => c.item === it))
      cut.push({ item: it, why: "No recipe in the cookbook uses it yet. Add the recipes you use it for, or let it go." });
    if (it.condition === "replace") replace.push({ item: it, why: "Marked as needing replacing" });
  }
  buy.sort((a, b) => (b.n - a.n) || a.name.localeCompare(b.name));
  upgrade.sort((a, b) => b.n - a.n);
  // a few facts that only show up across many recipes
  const insights = [];
  const vessel = ["pan", "deep", "wok", "pot", "sauce", "tawa", "pc", "ip", "af"].map(role => ({ role, n: roles[role].recipes.length })).filter(x => x.n).sort((a, b) => b.n - a.n);
  if (vessel.length) insights.push(`Most used: ${vessel.slice(0, 3).map(v => `${ROLES[v.role].name.split(" or ")[0].toLowerCase()} (${v.n})`).join(", ")}.`);
  const twoAtOnce = recipes.filter(r => new Set((r.steps || []).map(s => s.on).filter(v => ["pan", "deep", "wok", "pot", "sauce", "tawa"].includes(v))).size >= 2).length;
  if (twoAtOnce) insights.push(`${twoAtOnce} recipe${twoAtOnce > 1 ? "s" : ""} need two pans on the stove at once.`);
  if (roles.ip.recipes.length >= 3 && roles.pc.owned.length) insights.push(`${roles.ip.recipes.length} recipes use the Instant Pot, which takes one dish at a time when you cook several. Your pressure cooker is the second one.`);
  const check = items.filter(i => i.status === "check").map(i => ({ item: i, n: uses(i) || 0 })).sort((a, b) => b.n - a.n || a.item.name.localeCompare(b.item.name));
  return { roles, buy, upgrade, cut, replace, insights, uses, check };
}

root.Kitchen = { CATS, ROLES, MATERIALS, LINKED, recipeNeeds, analyse, tierOf };
})(typeof window !== "undefined" ? window : globalThis);
