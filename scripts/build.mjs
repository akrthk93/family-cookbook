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
    return r;
  })
  .filter(Boolean)
  .sort((a, b) => (b.no || "").localeCompare(a.no || "") || a.title.localeCompare(b.title));

if (errors.length) { console.error("Recipe problems:\n  " + errors.join("\n  ")); process.exit(1); }

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "public"), dist, { recursive: true });

const data = JSON.stringify(recipes);
writeFileSync(join(dist, "recipes.json"), data);

const version = createHash("sha256").update(data + readFileSync(join(root, "public/index.html"))).digest("hex").slice(0, 10);
for (const f of ["index.html", "sw.js"]) {
  const p = join(dist, f);
  writeFileSync(p, readFileSync(p, "utf8").replaceAll("__REPO__", repo).replaceAll("__VERSION__", version));
}
console.log(`Built ${recipes.length} recipes for ${repo} (version ${version})`);
