// Bundles recipes/*.json into dist/recipes.json, validates them, and copies the site.
// No dependencies. Run: node scripts/build.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const repo = process.env.GITHUB_REPOSITORY || "OWNER/family-cookbook";

const errors = [];
const recipes = readdirSync(join(root, "recipes"))
  .filter(f => f.endsWith(".json"))
  .map(f => {
    const file = join("recipes", f);
    let r;
    try { r = JSON.parse(readFileSync(join(root, file), "utf8")); }
    catch (e) { errors.push(`${file}: not valid JSON (${e.message})`); return null; }
    const id = basename(f, ".json");
    if (r.id && r.id !== id) errors.push(`${file}: "id" is "${r.id}" but the file name says "${id}"`);
    r.id = id;
    if (!r.title) errors.push(`${file}: missing "title"`);
    if (!Array.isArray(r.groups) || !r.groups.length) errors.push(`${file}: missing "groups" (ingredients)`);
    if (!Array.isArray(r.steps) || !r.steps.length) errors.push(`${file}: missing "steps"`);
    (r.groups || []).forEach((g, gi) => (g.items || []).forEach((it, ii) => {
      if (typeof it.n !== "string") errors.push(`${file}: ingredient ${gi}.${ii} has no "n" (name)`);
      if (it.q != null && typeof it.q !== "number") errors.push(`${file}: ingredient "${it.n}" has a non-numeric "q"`);
    }));
    (r.steps || []).forEach((s, si) => {
      if (s.uses != null && !Array.isArray(s.uses)) errors.push(`${file}: step ${si + 1} "uses" must be a list`);
      const ON = ["ip", "af", "pc", "wok", "pan", "deep", "pot", "tawa", "steam", "sauce", "none"];
      if (s.on != null && !ON.includes(s.on)) errors.push(`${file}: step ${si + 1} "on" must be one of ${ON.join(", ")}`);
      for (const f of ["act", "wait"]) if (s[f] != null && !(typeof s[f] === "number" && s[f] >= 0)) errors.push(`${file}: step ${si + 1} "${f}" must be minutes (a number)`);
      if (s.after != null && !(Array.isArray(s.after) && s.after.every(j => Number.isInteger(j) && j >= 0 && j < si))) errors.push(`${file}: step ${si + 1} "after" must list earlier step numbers (0-based)`);
      if (s.overlap && si === 0) errors.push(`${file}: the first step can't overlap`);
      if (s.parts != null) {
        if (!Array.isArray(s.parts) || !s.parts.length) errors.push(`${file}: step ${si + 1} "parts" must be a non-empty list`);
        else s.parts.forEach((pt, pi) => {
          if (typeof pt.x !== "string" || !pt.x) errors.push(`${file}: step ${si + 1} part ${pi + 1} needs its text in "x"`);
          for (const f of ["act", "wait"]) if (!(typeof pt[f] === "number" && pt[f] >= 0)) errors.push(`${file}: step ${si + 1} part ${pi + 1} "${f}" must be minutes`);
          if (pt.until != null && typeof pt.until !== "string") errors.push(`${file}: step ${si + 1} part ${pi + 1} "until" must be text like "it beeps"`);
        });
      }
      (s.uses || []).forEach(k => {
        const [key, portion] = String(k).split("@");
        if (portion != null && !(parseFloat(portion) > 0)) errors.push(`${file}: step ${si + 1} uses "${k}", but the part after @ isn't an amount`);
        const [gi, ii] = key.split(".").map(Number);
        if (!r.groups?.[gi]?.items?.[ii]) errors.push(`${file}: step ${si + 1} uses "${k}", but there's no ingredient ${k}`);
      });
    });
    return r;
  })
  .filter(Boolean)
  .sort((a, b) => (b.no || "").localeCompare(a.no || "") || a.title.localeCompare(b.title));

// kitchen equipment list
try {
  const k = JSON.parse(readFileSync(join(root, "public/kitchen.json"), "utf8"));
  const ids = new Set();
  if (!Array.isArray(k.items)) errors.push(`public/kitchen.json: needs an "items" list`);
  else k.items.forEach((it, i) => {
    const at = `public/kitchen.json item ${i + 1}${it.name ? ` (${it.name})` : ""}`;
    if (!it.id || ids.has(it.id)) errors.push(`${at}: needs a unique "id"`); ids.add(it.id);
    if (!it.name) errors.push(`${at}: needs a "name"`);
    if (!["cookware", "appliances", "knives", "prep", "utensils", "measuring", "storage", "specialty"].includes(it.cat)) errors.push(`${at}: "cat" isn't a known category`);
    if (it.status && !["owned", "check", "want"].includes(it.status)) errors.push(`${at}: "status" must be owned, check or want`);
  });
} catch (e) { errors.push(`public/kitchen.json: not valid JSON (${e.message})`); }

if (errors.length) { console.error("Recipe problems:\n  " + errors.join("\n  ")); process.exit(1); }

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "public"), dist, { recursive: true });

const data = JSON.stringify(recipes);
writeFileSync(join(dist, "recipes.json"), data);

const version = createHash("sha256").update(data + readFileSync(join(root, "public/index.html")) + readFileSync(join(root, "public/plan.js")) + readFileSync(join(root, "public/kitchen.js"))).digest("hex").slice(0, 10);
for (const f of ["index.html", "sw.js"]) {
  const p = join(dist, f);
  writeFileSync(p, readFileSync(p, "utf8").replaceAll("__REPO__", repo).replaceAll("__VERSION__", version));
}
console.log(`Built ${recipes.length} recipes for ${repo} (version ${version})`);
