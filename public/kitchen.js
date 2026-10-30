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
  chopper:     { name: "Chopper (pull-string or electric)", cat: "prep" },
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
  chopper: s => /finely chopped|minced|\bdiced/i.test(s) && !/paste|powder|frozen/i.test(s),
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
  /* steps on the ladder a wish-list item jumps over (going straight to Japanese from stamped steel is fine) */
  const skipped = it => {
    const L = ROLES[it.role]?.ladder, t = tierOf(it); if (!L || t < 0 || !roles[it.role]) return [];
    const have = Math.max(-1, ...roles[it.role].owned.map(tierOf));
    return have >= 0 ? L.slice(have + 1, t) : [];
  };
  const unsure = role => items.some(i => i.status === "check" && i.role === role);
  for (const [role, x] of Object.entries(roles)) {
    if (!x.recipes.length || x.owned.length || unsure(role)) continue;   // "not sure" items are asked about first
    buy.push({ role, name: ROLES[role].name, n: x.recipes.length, recipes: x.recipes, wanted: items.find(i => i.status === "want" && i.role === role) || null });
  }
  for (const it of items.filter(i => i.status === "want" && !(i.role && roles[i.role] && !roles[i.role].owned.length && roles[i.role].recipes.length)))
    buy.push({ role: it.role || null, name: it.name, n: uses(it) || 0, recipes: it.role ? roles[it.role]?.recipes || [] : [], wanted: it, upgradeOf: it.role ? roles[it.role]?.owned.filter(o => tierOf(o) >= 0 && tierOf(o) < tierOf(it)).map(o => o.name) : [], skips: skipped(it) });
  for (const [role, x] of Object.entries(roles)) {
    const def = ROLES[role]; if (!def.ladder || !x.owned.length) continue;
    const best = x.owned.reduce((a, b) => tierOf(b) > tierOf(a) ? b : a);
    const t = tierOf(best);
    if (t >= 0 && t < def.enough && x.recipes.length >= 4 && !items.some(i => i.status === "want" && i.role === role && tierOf(i) > t))
      upgrade.push({ item: best, from: def.ladder[t], to: def.ladder[t + 1], skipTo: def.ladder.slice(t + 2), n: x.recipes.length });
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
  const hard = items.some(i => i.role === "knife" && i.status !== "check" && /japanese|carbon/i.test(i.material || ""));
  if (hard && items.some(i => i.role === "sharpener" && (i.status || "owned") === "owned" && /pull/i.test(i.material || i.name)))
    insights.push("Keep the pull-through sharpener away from Japanese or carbon steel knives: it chips hard edges. Use the whetstone for those.");
  const check = items.filter(i => i.status === "check").map(i => ({ item: i, n: uses(i) || 0 })).sort((a, b) => b.n - a.n || a.item.name.localeCompare(b.item.name));
  return { roles, buy, upgrade, cut, replace, insights, uses, check };
}

/* ---------- suggestions: gear you don't have that your cooking points to ---------- */
/* What a recipe involves, read from its words and step data. */
const VEG = /onion|shallot|tomato|carrot|capsicum|pepper|beans|cabbage|broccoli|cauliflower|potato|brinjal|eggplant|pumpkin|cucumber|okra|spinach|leek|celery|zucchini|mushroom|lettuce|kale|drumstick/;
const SMALL = /garlic|ginger|shallot|chilli|chillies|scallion|spring onion/;
const CUT = /chopped|sliced|diced|minced|julienne|cubes?|cubed|pieces|rounds|halved|quartered|slit|shredded|wedges|strips|florets/;
const CHOP = /chopped|diced|minced/;
const SLICE = /sliced|julienne|rounds|strips|wedges|half-moons|shredded|batons|matchstick|ribbons/;
/* Choppers you own (a pull-string chopper, or a hand blender's chopper bowl) take over chopping and mincing,
   but not slicing: they can't do thin onion slices, julienne or even rounds. */
const ownChoppers = items => items.filter(i => (i.status || "owned") === "owned" && (i.role === "chopper" || /chopper/i.test(`${i.name} ${i.notes || ""}`) && i.cat !== "knives"));
function features(r) {
  const steps = r.steps || [];
  const text = steps.map(s => `${s.t}. ${s.x}`).join(" ").toLowerCase();
  const ings = (r.groups || []).flatMap(g => g.items.map(i => i.n.toLowerCase()));
  const stove = new Set(["pan", "deep", "wok", "pot", "sauce", "tawa"]);
  const waitOf = s => Array.isArray(s.parts) ? s.parts.reduce((a, p) => a + (p.wait || 0), 0) : (s.wait || 0);
  return {
    text, ings, tags: r.tags || [],
    on: new Set(steps.map(s => s.on).filter(v => v && v !== "none")),
    vegCuts: ings.filter(n => VEG.test(n) && CUT.test(n) && !/can\b|canned|frozen|paste|powder/.test(n)).length,
    vegChop: ings.filter(n => VEG.test(n) && CHOP.test(n) && !SLICE.test(n) && !/can\b|canned|frozen|paste|powder/.test(n)).length,
    vegSlice: ings.filter(n => VEG.test(n) && SLICE.test(n) && !/can\b|canned|frozen|paste|powder/.test(n)).length,
    smallCuts: ings.filter(n => SMALL.test(n) && CUT.test(n)).length + (text.match(/\bslit\b|\btrim/g) || []).length,
    thinSlice: ings.filter(n => /thinly sliced|finely sliced|half-moons|julienne/.test(n)).length,
    garlicMince: ings.filter(n => /garlic/.test(n) && /minced|crushed|grated/.test(n)).length,
    herbs: ings.filter(n => /coriander leaves|fresh coriander|parsley|mint|basil, fresh|lettuce|spinach|curry leaves/.test(n) && !/powder|seeds|dried/.test(n)).length,
    tadka: /mustard seeds|tadka|temper/.test(text),
    splatter: (text.match(/let them pop|pop\b|tadka|temper|sear|smash|render|fry .*until golden|shallow fry|deep fry/g) || []).length,
    panSimmer: steps.some(s => ["pan", "deep"].includes(s.on) && (waitOf(s) >= 4 || /cover|simmer|reduce|toss .*pasta|add .*(pasta|spaghetti|orecchiette)/i.test(s.x))),
    longSimmer: steps.some(s => stove.has(s.on) && waitOf(s) >= 20),
    flip: /salmon|fish|egg|patt|smash|flip|turn (them|the)/.test(text) && steps.some(s => ["pan", "tawa"].includes(s.on)),
    drainLift: /spaghetti|pasta|orecchiette|noodles|tortellini|blanch|deep fry|dumpling/.test(text),
    rice: ings.some(n => /\brice\b/.test(n)) || /over (hot )?rice|with rice|serve with .*rice/.test(text),
    ip: steps.some(s => s.on === "ip"),
    af: steps.some(s => s.on === "af"),
    spices: ings.filter(n => /powder|seeds|garam masala|turmeric/.test(n)).length,
    boneIn: /bone-in|off the bones|whole chicken|joint/.test(text + " " + ings.join(" ")),
    // raw chicken parts you could cut from a whole bird (not mince, cooked, stock or luncheon meat)
    chickenParts: ings.filter(n => /chicken/.test(n) && /breast|thigh|leg|drumstick|wing/.test(n) && !/mince|minced|ground|cooked|stock|broth|\bcube\b|knorr|luncheon/.test(n)).length,
    // work a smaller blade does on meat: taking bones out, skin off, trimming fat
    debone: ings.filter(n => /chicken|mutton|lamb/.test(n) && /boneless/.test(n) && /thigh|leg/.test(n)).length + ((text + " " + ings.join(" ")).match(/off the bones?|debone/g) || []).length,
    skinTrim: ings.filter(n => /skin removed|skinless|skin (and .*)?trimmed|fat trimmed|trim(med)? .*fat|remove the skin/.test(n)).length + (text.match(/remove the skin|trim (off )?(the )?fat/g) || []).length,
    // pieces with the bone still in, as in a curry-cut chicken or mutton curry
    boneChop: /curry[- ]cut|bone-in .*(pieces|chunks)|(chicken|mutton|lamb) .*pieces, bone-in|chop .*through the bone/.test(text + " " + ings.join(" ")),
  };
}
/* The catalog. `match` = already in your list (any status) under a name like this; `signal` = how strongly a
   recipe points to it (0-1); `strong`/`some` = weighted totals for "Worth getting" / "Maybe later". */
const CATALOG = [
  { id: "nakiri", name: "Nakiri (veg knife)", cat: "knives", match: /nakiri|usuba/i,
    signal: (f, items) => Math.min(1, (f.vegSlice + f.vegChop * (ownChoppers(items).length ? 0.25 : 1)) / 3), strong: 0.45, some: 0.25,
    why: (n, items) => ownChoppers(items).length ? `${n} recipes cut vegetables your choppers can't: thin slices, rounds, julienne` : `${n} recipes chop a lot of vegetables`,
    note: "Flat edge for push-cutting onions, beans and greens. Ideal as the dedicated veg knife." },
  { id: "petty", name: "Petty / utility knife (120–150mm)", cat: "knives", match: /petty|utility knife/i,
    signal: f => Math.min(1, (f.smallCuts + f.skinTrim) / 3), strong: 0.35, some: 0.2,
    why: n => `${n} recipes slice garlic, ginger or shallots, or slit chillies`, note: "Small precise work where a chef's knife is clumsy." },
  { id: "honing-rod", name: "Ceramic honing rod", cat: "knives", match: /honing|sharpening steel/i,
    signal: (f, items) => items.some(i => (i.status || "owned") === "owned" && i.role === "knife" && i.material === "stamped soft steel") ? 1 : 0, strong: 0.3, some: 0.15,
    why: () => `Your chef's knife is soft steel, and every recipe uses it`, noFreq: true, note: "A few strokes before cooking straightens a soft edge, so you need the whetstone far less often. Ceramic rather than grooved steel: it's also safe on a Japanese knife later." },
  { id: "boning", name: "Honesuki or boning knife (150mm)", cat: "knives", match: /boning|honesuki/i,
    signal: f => f.chickenParts || f.debone || f.boneIn ? Math.min(1, (f.chickenParts + f.debone + f.skinTrim) / 2) : 0, strong: 0.3, some: 0.15,
    why: n => `${n} recipes use chicken breasts, thighs or legs you could cut from a whole chicken, or debone and skin yourself`,
    note: "Buy whole chickens and break them down: breasts for one recipe, legs for another, and the carcass for stock instead of a Knorr cube. A honesuki (Japanese poultry knife) is built for this; a Western boning knife works too. Don't use your VG10 gyuto on bones." },
  { id: "poultry-shears", name: "Poultry shears", cat: "knives", match: /shears|scissors/i,
    signal: f => f.chickenParts || f.boneIn ? 1 : 0, strong: 0.35, some: 0.15,
    why: n => `${n} recipes use chicken parts or bone-in chicken`, note: "Cuts out the backbone and through joints and ribs in seconds. Pairs with a boning knife if you start buying whole chickens." },
  { id: "cleaver", name: "Bone cleaver (Chinese style)", cat: "knives", match: /cleaver/i,
    has: items => items.some(i => (i.status || "owned") !== "check" && i.cat === "knives" && /cleaver|chopper/i.test(i.name)),
    signal: f => f.boneChop ? 1 : 0, strong: 0.2, some: 0.08,
    why: n => `${n} recipes cook meat in bone-in pieces`, note: "A heavy cleaver chops through chicken and mutton bones for curry-cut pieces. Keeps your good knives off bones entirely." },
  { id: "dutch-oven", name: "Dutch oven (enamelled cast iron)", cat: "cookware", role: "pot", material: "enamelled cast iron", match: /dutch oven|casserole|enamel/i,
    signal: f => f.longSimmer && !f.ip ? 1 : 0, strong: 0.2, some: 0.07,
    why: n => `${n} recipes simmer on the stove for 20+ minutes`, note: "Heavy and even, so long simmers and batch bases don't catch. Works on gas without an oven." },
  { id: "spare-inner-pot", name: "Spare Instant Pot inner pot", cat: "specialty", match: /inner pot|spare pot|insert/i,
    signal: f => f.ip ? 1 : 0, strong: 0.25, some: 0.12,
    why: n => `${n} recipes use the Instant Pot`, note: "Cook one Instant Pot dish straight after another without washing up in between. Cheap." },
  { id: "rice-cooker", name: "Rice cooker", cat: "appliances", match: /rice cooker/i,
    signal: f => f.rice ? 1 : 0, strong: 0.3, some: 0.15,
    why: n => `${n} recipes are served with rice`, note: "Frees the Instant Pot and a burner when you cook several dishes at once." },
  { id: "masala-dabba", name: "Masala dabba (spice box)", cat: "storage", match: /dabba|spice box|spice tin/i,
    signal: f => f.spices >= 3 ? 1 : 0, strong: 0.3, some: 0.15,
    why: n => `${n} recipes use three or more spices`, note: "Your everyday spices in one tin next to the stove, so tadka and masala steps don't wait on jar lids." },
  { id: "tadka-pan", name: "Tadka pan", cat: "cookware", role: "sauce", match: /tadka|tempering|seasoning pan|small deep/i,
    signal: f => f.tadka ? 1 : 0, strong: 0.15, some: 0.07,
    why: n => `${n} recipes finish with a tempering`, note: "A small pan just for tempering; heats in seconds." },
  { id: "splatter-guard", name: "Splatter guard", cat: "utensils", match: /splatter/i,
    signal: f => Math.min(1, f.splatter / 2), strong: 0.3, some: 0.15,
    why: n => `${n} recipes pop mustard seeds, sear or fry`, note: "Mesh screen that sits over the pan." },
  { id: "fish-spatula", name: "Fish spatula", cat: "utensils", match: /fish spatula|turner/i,
    signal: f => f.flip ? 1 : 0, strong: 0.15, some: 0.07,
    why: n => `${n} recipes flip fish, eggs or patties in a pan`, note: "Thin and flexible, slides under without breaking things." },
  { id: "spider", name: "Spider strainer", cat: "utensils", match: /spider|slotted spoon/i,
    signal: f => f.drainLift ? 1 : 0, strong: 0.2, some: 0.1,
    why: n => `${n} recipes lift pasta or noodles out of water`, note: "Moves pasta straight into the sauce pan with some of its water." },
  { id: "salad-spinner", name: "Salad spinner", cat: "prep", match: /spinner/i,
    signal: f => Math.min(1, f.herbs / 2), strong: 0.5, some: 0.25,
    why: n => `${n} recipes use fresh herbs or leaves`, note: "Dries washed coriander and greens fast, so they keep longer and don't water down a dish." },
  { id: "mandoline", name: "Mandoline", cat: "prep", match: /mandolin/i,
    signal: f => f.thinSlice ? 1 : 0, strong: 0.3, some: 0.15,
    why: n => `${n} recipes need thinly sliced onions or veg`, note: "Even, thin slices in seconds. Use the guard." },
  { id: "garlic-press", name: "Garlic press", cat: "prep", match: /garlic press|garlic crusher/i,
    signal: (f, items) => f.garlicMince ? (ownChoppers(items).length ? 0.4 : 1) : 0, damp: rs => rs.some(r => /ginger-garlic paste|garlic paste/i.test(r.title)) ? 0.4 : 1, strong: 0.4, some: 0.12,
    why: n => `${n} recipes use minced garlic`, note: "Skip it if the ginger-garlic paste cubes cover most of your garlic." },
  { id: "bench-scraper", name: "Bench scraper", cat: "prep", match: /scraper/i,
    signal: (f, items) => Math.min(1, (f.vegSlice + f.vegChop * (ownChoppers(items).length ? 0.4 : 1)) / 4), strong: 0.7, some: 0.3,
    why: n => `${n} recipes involve a lot of chopping`, note: "Scoops chopped veg off the board in one go." },
  { id: "af-liners", name: "Air fryer liners", cat: "storage", match: /liner/i,
    signal: f => f.af ? 1 : 0, strong: 0.15, some: 0.08,
    why: n => `${n} recipes use the air fryer`, note: "Saves scrubbing the basket after marinated or cheesy things." },
  { id: "saute-pan", name: "Sauté pan (deep, with lid)", cat: "cookware", role: "deep", material: "stainless", match: /sauté|saute/i,
    signal: f => f.panSimmer ? 1 : 0, strong: 0.2, some: 0.1,
    why: n => `${n} recipes simmer or toss pasta in a skillet`, note: "Deeper than a skillet with a lid: room to toss pasta and to simmer sauces without spills." },
];
const REGULAR = ["Weeknight", "Sunday block", "Lunch batch", "Dosa night", "Breakfast"];
/* How much a recipe counts: more if you cook it often (made log on this phone) or it's in your weekly rotation. */
function weightOf(r, freq) {
  const made = (freq[r.id] || []).filter(t => t > Date.now() - 90 * 864e5).length;
  return 1 + Math.min(made, 6) * 0.5 + ((r.tags || []).some(t => REGULAR.includes(t)) ? 0.5 : 0);
}
function suggest(items, recipes, freq = {}, dismissed = []) {
  const recent = r => (freq[r.id] || []).filter(t => t > Date.now() - 90 * 864e5).length;
  const F = recipes.map(r => ({ r, f: features(r), w: weightOf(r, freq), made: recent(r), regular: (r.tags || []).some(t => REGULAR.includes(t)) }));
  const W = F.reduce((a, x) => a + x.w, 0) || 1;
  const out = [];
  for (const c of CATALOG) {
    if (dismissed.includes(c.id) || items.some(i => i.suggest === c.id || c.match.test(i.name)) || c.has?.(items)) continue;
    let score = 0, n = 0, made = 0, regular = 0;
    for (const x of F) { const sg = c.signal(x.f, items); if (sg > 0) { score += sg * x.w; n++; if (x.made) made++; if (x.regular) regular++; } }
    if (!n) continue;
    score *= c.damp ? c.damp(recipes) : 1;
    const share = score / W;                       // how much of your (weighted) cooking points to it
    const level = share >= c.strong ? "strong" : share >= c.some ? "some" : null;
    if (!level) continue;
    let why = c.why(n, items);
    why = why[0].toUpperCase() + why.slice(1) + ".";
    if (!c.noFreq) why += made ? ` You've made ${made === 1 ? "one of them" : `${made} of them`} in the last 3 months.` : regular ? ` ${regular === n ? (n === 1 ? "It's" : "All are") : `${regular} are`} in your weekly rotation.` : "";
    out.push({ id: c.id, name: c.name, cat: c.cat, role: c.role, material: c.material, share, level, note: c.note, why });
  }
  return out.sort((a, b) => b.share - a.share);
}

root.Kitchen = { CATS, ROLES, MATERIALS, LINKED, recipeNeeds, analyse, tierOf, suggest, features, CATALOG };
})(typeof window !== "undefined" ? window : globalThis);
