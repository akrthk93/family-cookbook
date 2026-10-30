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
- `uses` lists the ingredients that go in at that step as `group.item` positions (`"1.3"` = 2nd group, 4th item). Cook mode shows them under "Goes in now". List each ingredient once, at the step where it's added. If `uses` is missing, the app guesses from the step text.
- Step timing for Cook together (optional; the app estimates them from the step text when missing):
  - `act`: hands-on minutes. `wait`: hands-free minutes after that (pressure cooking, simmering, marinating). Include the Instant Pot's time to come up to pressure and any natural release in `wait`.
  - `on`: what the step ties up: `ip` (Instant Pot), `af` (air fryer), `pan`, `deep`, `wok`, `pot`, `tawa`, `steam`, `pc` (stovetop pressure cooker) need a big burner; `sauce` (saucepan, small pan) takes any burner; `none` for the counter.
  - `overlap: true`: the step can start while the previous step is still in its hands-free time (e.g. make the sauce while the pasta boils).
  - `after: [n]`: the step also waits for step n to finish completely (e.g. combine pasta and sauce after the pasta step).
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

The planner lives in `public/plan.js` (pure functions, testable in node).

## Compare prices

The Compare tab works out price per kg (per litre for liquids, per piece for counts) for options in the store, marks the cheapest, and shows how much more the others cost. Use Packs for multi-packs (2 × 500g is size 500, packs 2). The comparison is kept on the phone until you tap Start over.

## Send to Reminders (once per phone)

Create a Shortcut named exactly **Add to Family List**: Split Text (Shortcut Input, by New Lines) → Repeat with Each → Add New Reminder (Repeat Item, list = family shopping list). The app's **Send to Reminders** button runs it.

## Local build

```sh
node scripts/build.mjs   # writes dist/
npx serve dist           # or any static server
```
