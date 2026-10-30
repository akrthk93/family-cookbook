# Family Cookbook

Our recipes as a phone app: cook mode with big text and timers, serving scaling, ingredient substitutes, and a shopping list that hands off to the family list in Apple Reminders.

It's a static site on GitHub Pages. Recipes are JSON files in `recipes/`. Every push to `main` rebuilds and deploys in about a minute.

## Install on a phone

Open the site in Safari → Share → **Add to Home Screen**. It then opens full-screen, keeps the screen on while cooking, and works offline after the first visit.

## Adding a recipe

Pick whichever is easiest:

- **In the app:** tap **New**, paste a recipe, tap **Save**. The app commits it to this repo and every phone has it about a minute later. Editing and deleting work the same way.
- **Ask Claude** to add it. Claude commits the new file.

Saving from the app needs a one-time setup per phone (Settings → Saving recipes): a fine-grained GitHub token with access to this repository only and **Contents: Read and write**. It's stored only on that phone. Without it, recipes saved in the app stay on that phone until saving is turned on.
- **By hand:** add `recipes/<id>.json` in the format below.

## Recipe format

```json
{
  "id": "butter-chicken",
  "no": "13.02.18",
  "title": "Butter Chicken Curry",
  "tags": ["Instant Pot", "Indian", "Curry"],
  "prep": "15 min", "cook": "20 min", "total": "50 min",
  "serves": 3,
  "servesNote": "optional, e.g. 2 adults + 1 child",
  "equip": "Instant Pot",
  "source": "https://… or a plain-text credit, or null",
  "groups": [
    { "g": "Marinade", "items": [
      { "q": 340, "u": "g", "n": "chicken breast, 2cm pieces", "sub": "Boneless thigh; add 2 min" },
      { "q": null, "u": "", "n": "Salt, to taste" }
    ]}
  ],
  "steps": [
    { "t": "Marinate", "x": "Mix chicken with yogurt… Rest at least 15 min.", "uses": ["0.0", "0.1"] }
  ],
  "notes": ["Keeps 3–4 days."]
}
```

- `q` is a number so it can scale; use `null` for "to taste". `u` is one of `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `oz`, or `""` for counts (2 onions).
- `g` is a group heading, or `null` for none. `sub` is an optional substitute.
- Timers come from the step text: every time written in `x` ("15 min", "8–10 minutes", "30 sec") becomes a tap-to-start timer, starting at the low end of a range. Phrases like "1 min less than packet time" are ignored.
- `uses` lists the ingredients that go in at that step as `group.item` positions. Add `@amount` when only part of it goes in at that step (`"0.1@1.5"` = 1.5 of ingredient 0.1's unit), e.g. a divided salt or one of two cans (`"1.3"` = 2nd group, 4th item). Cook mode shows them under "Goes in now". List each ingredient once, at the step where it's added. If `uses` is missing, the app guesses from the step text.
- Step timing for Cook together (optional; the app estimates them from the step text when missing):
  - `act`: hands-on minutes. `wait`: hands-free minutes after that (pressure cooking, simmering, marinating). Include the Instant Pot's time to come up to pressure and any natural release in `wait`.
  - `on`: what the step ties up: `ip` (Instant Pot), `af` (air fryer), `pan`, `deep`, `wok`, `pot`, `tawa`, `steam`, `pc` (stovetop pressure cooker) need a big burner; `sauce` (saucepan, small pan) takes any burner; `none` for the counter.
  - `overlap: true`: the step can start while the previous step is still in its hands-free time (e.g. make the sauce while the pasta boils).
  - `after: [n]`: the step also waits for step n to finish completely (e.g. combine pasta and sauce after the pasta step).
  - `parts`: split a step whose timing comes in pieces, e.g. `[{"x": "Air fry 5 min.", "act": 1, "wait": 5}, {"x": "Shake, then air fry another 5 min.", "act": 0.5, "wait": 5}]`. Each part gets its own timer in Cook together; set the step's `x` to the parts' text joined with spaces. A part with `"until": "it beeps"` (or "it boils", "it's al dente") waits for you to confirm instead of a fixed time; `wait` is the estimate. A part with `act: 0` (a natural release) starts by itself.
- The file name must match `id`. The build fails with a clear message if a recipe is malformed, so a bad file never takes the site down.

## What to cook now

The top of the Recipes screen suggests recipes for the current part of the week. The plan per weekday is set in Settings → Weekly plan (default: Sunday block on Sunday, dosa nights Tue/Thu, component nights Mon/Wed, weekend cooks Fri/Sat). Before 10am it shows breakfast; after 9:30pm it shows tomorrow's plan with a reminder of what to take out of the freezer. The chips under the suggestions show any other plan.

A recipe joins a plan through its tags:

| Tag | Shows up on |
|---|---|
| `Sunday block` | Prep day (freezer cubes, sambar) |
| `Lunch batch` | Prep day, as "This week's lunch": the one made least recently |
| `Dosa night` | Dosa nights |
| `Weeknight` | Component nights |
| `Weekend` | Weekend cooks |
| `Breakfast`, `Drinks` | Mornings |

"Made it today" on a recipe (or finishing cook mode) records when it was last made. Suggestions list the least recently made first. This history is kept on each phone.

## Cook together

On the Recipes screen, tap **Cook several dishes together**, pick 2 to 4 dishes, set servings, and choose **Serve together** (shorter dishes start later so everything is hot at once) or **Done fastest** (batch prep), and one or two cooks. The app then guides you live:

- **Now** shows what to do, one card per cook. Chopping is pulled out of the ingredient list and slotted into waiting time, but always finished before a pan goes on, so nothing scorches while you chop. Once a pan is hot, its next step comes straight away.
- **Cooking on its own** shows the timers that start when you finish a hands-on step (+1m, Done early, an alarm when time's up).
- It never puts two dishes in the Instant Pot or air fryer at once and uses at most 2 big burners and 1 small one. It re-plans every time you tap Done, so running behind is fine.
- The session survives closing the app. **Finish** marks every dish as made today.
- Steps with parts (air fry, toss, air fry; pressure cook until it beeps, then natural release) get a timer per part. Each running timer shows its step and what comes next. Tap a dish's name to stop cooking it; **Skip** skips a task.

**Cook to what you have**: tap an ingredient, choose **I have…** and type the amount. Within ±20% of the recipe it suggests using all of it and keeping the rest as written; beyond that it suggests scaling the whole recipe to it (counts round to whole or half). Both buttons are always there. It applies to the recipe, cook mode, Cook together and the shopping list, and clears when you finish.

**Swap or leave out an ingredient**: tap it on a recipe or on a card while cooking. Pick the suggested swap, type your own, or leave it out. It applies to the steps, prep, cook mode and shopping list for that recipe on that phone until you set it back.

The planner lives in `public/plan.js` (pure functions, testable in node).

## Kitchen

The Kitchen tab tracks equipment by category (stovetop cookware, appliances, knives and boards, prep tools, utensils, measuring, storage, specialty). Each item has a status (have it, not sure, want it), material, size, brand, condition and notes, and a **kind** (skillet, sauté pan, wok, stockpot, saucepan, tawa, pressure cooker, Instant Pot, air fryer, hand blender, mixie, sieve, grater, thermometer, scale…) that links it to the recipes.

The app reads the recipes (each step's `on`, plus words like "strain", "zest", "74°C") and shows:
- **Buy**: kinds of gear recipes need that you don't own, plus your wish list, with how many recipes need each
- **Upgrade**: heavily used gear (4+ recipes) still below the "worth getting to" step of its material path, e.g. nonstick → stainless → carbon steel for frying pans, nonstick → carbon steel for woks, stamped steel → Victorinox → Japanese for knives
- **Cut or rethink**: gear no recipe uses, or replaced by something better you own (tap **Keep** to silence it)
- **Do you have these?**: items to confirm, the ones recipes need most first
- **Suggested for you**: gear you don't have that your recipes point to (nakiri, petty knife, honing rod, sauté pan, Dutch oven, spare Instant Pot pot, salad spinner, mandoline…), with the reason. Recipes you cook often count more: each "Made it" or finished cook is logged on that phone, and recipes in the weekly plan count extra. **Want** adds it to the wish list, **Have it** to your gear, **Not for me** hides it for good (saved as `dismissed` in `kitchen.json`).
  - Choppers you own (a pull-string chopper, or a hand blender with a chopper bowl) take over chopped, diced and minced veg and garlic, so those count much less towards a nakiri, a bench scraper or a garlic press. Thin slices, rounds and julienne still need a knife.

The list lives in `public/kitchen.json`. The app saves changes there the same way it saves recipes, so everyone sees the same list.

## Compare prices

The Compare tab works out price per kg (per litre for liquids, per piece for counts) for options in the store, marks the cheapest, and shows how much more the others cost. Use Packs for multi-packs (2 × 500g is size 500, packs 2). The comparison is kept on the phone until you tap Start over.

## Send to Reminders (once per phone)

Create a Shortcut named exactly **Add to Family List**: Split Text (Shortcut Input, by New Lines) → Repeat with Each → Add New Reminder (Repeat Item, list = family shopping list). The app's **Send to Reminders** button runs it.

## Local build

```sh
node scripts/build.mjs   # writes dist/
npx serve dist           # or any static server
```
