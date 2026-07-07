# Chess Gym — Design Notes (leo)

Presentational layer only. Engine, storage, and any id/class/hook the scripts rely on belong to
kai. This file is the design contract + a running log so each critique round builds on the last.

## Point of view

Chess Gym is not a chess *playing* site — it's a chess *mastery* hall. So it must not look like the
generic dark chess site (near-black + one acid accent), and it must not look like the AI-default
brief (warm-cream + serif display + terracotta). The world we borrow from is chess's real material
culture: the **tournament vinyl board** (pine green and buff, never black/white), the **club
scoresheet** (ruled columns, pencil, White/Black move pairs), and the **hall at night** — a big
quiet room where lamps come up over the boards.

That last image is the whole design. The Mastery Map is the darkened hall; earning % turns the
lamps up. A beginner sees where the dark rooms are; an accomplished player sees a hall full of
light. Progress is not a bar — it is **a place filling with light.**

Discipline rule: boldness is spent entirely on the map's light. Every other surface (board, play,
lesson text) is flat, quiet, and buff-on-pine. If a choice here is what I'd make for *any* chess
app, it's wrong and gets revised.

## Token system

Rooted in a real tournament board (pine + buff), lit by brass (clock/crest metal). Warm light is
reserved as the accent so "light coming up" reads as the single meaningful color event.

| token       | hex       | role |
|-------------|-----------|------|
| `--hall`    | `#14231d` | ground — the hall at night (a dark square, greener/bluer) |
| `--felt`    | `#1d3229` | raised surfaces: cards, panels (a lit dark square) |
| `--buff`    | `#ece3cf` | the light: primary text on dark, and mastered-station fill (board buff square) |
| `--brass`   | `#c9a24b` | THE accent — the light source. Clock, active square, mastery edge. Used sparingly. |
| `--chalk`   | `#8fa89a` | muted sage-gray — secondary text/labels (desaturated so brass stays the only warm) |
| `--ink`     | `#0d1712` | deepest shadow; text on buff surfaces |

Derived (no new hues — tints/shades of the six): `--lamp-cold` = `--chalk` @ ~14% over `--hall`
(an unlit station), fills warm toward `--buff` then edges `--brass` at 100%.

## Type roles (deliberate, Windows-grounded system stacks — no CDN)

This org runs on Windows 11, so I pair fonts that actually ship here and have real character,
not the Inter/Helvetica/serif default.

- **Display** — station names, wing crests, the big mastery numbers:
  `"Bahnschrift", "DIN Alternate", "Oswald", system-ui, sans-serif`.
  Bahnschrift is DIN-engineered tournament-signage; condensed authority, not neutral.
- **Body** — lesson text, descriptions, buttons:
  `"Segoe UI", system-ui, -apple-system, sans-serif`. Humanist, quiet, readable. Kept in the
  background on purpose.
- **Utility / data** — every number: mastery %, deltas, clock, board coordinates (a–h / 1–8),
  move list: `"Cascadia Code", "Consolas", ui-monospace, monospace`. Evokes the digital clock and
  the ruled scoresheet grid; makes the delta line feel like a readout, not prose.

Scale (fluid, clamp-based): display 2.25→3.5rem / 700 / -0.01em tracking; section 1.25rem / 600;
body 1rem / 400 / 1.55 line; data 0.95rem / 500 / tabular-nums.

## Layout concept

The app is a lamplit tournament hall seen from above. Top bar is a thin brass-ruled placard (title
left, view switch center, overall Chess Mastery % as a data readout right). The **Mastery Map** —
the centerpiece — is the hall: six wings as vertical bays (R · M · T · E · S · A), each a stack of
numbered station lamps. Unlit = cold slate; earning % warms the lamp buff; mastery kindles a brass
edge and stamps the wing crest. The Play screen is deliberately quiet: a pine/buff board, brass
only on the active square and the clock, the move list set as a two-column scoresheet.

## Signature element — the Mastery Map filling with light

ONE thing designed deeply; everything else stays quiet around it.

- Each **station** is a cell whose fill *is* its mastery %, expressed as light level, not a bar:
  cold slate at 0 → warming buff → a brass edge kindling at 100 (mastered). The light level literally
  encodes the number; nothing here is decorative.
- **The delta moment** (45% → 60%) is the payoff. On finishing an activity, the station's light
  *rises* from old% to new% (CSS transition of a `--pct` custom property driving the fill + glow),
  and the whole hall brightens one notch. Quietly triumphant — no confetti; a lamp warming up, a
  brass filament kindling if it crossed into mastery. `prefers-reduced-motion` collapses it to an
  instant state change (no travel, no glow pulse).
- **Honest numbers, shown as light**: a "refresher due" station cools one step (the shine fading) —
  an invitation to re-prove, and the dimming *is* the message. Never drops the number.
- **Wing crest** stamps brass when every station in the bay is lit — the capstone made visible.

Structure encodes truth: R1–R5 / T1–T8 numbering is real content order, not ornament; light level =
mastery %; a dim lamp = an honest gap to train.

### DOM hooks I need from kai (so I never touch logic)
So I can drive all of this from CSS with zero behavior changes, the map markup should carry:
- each station cell: `class="station"` + `style="--pct: <0..100>"` (or `data-pct`), and a
  `data-state` of `locked|unlit|lit|mastered|refresher` if the JS already knows it;
- each wing bay: `class="wing"` + `data-wing="R|M|T|E|S|A"`, crest node `class="crest"`;
- the delta moment: JS just updates `--pct` (and toggles `.is-mastered`) — the transition is mine.
Confirming these with kai before he hardcodes the map markup.

## Running log (tried / rejected)

- **Rejected** near-black + single acid accent — explicitly the "generic dark chess site" the
  operator warned against.
- **Rejected** cream + serif display + terracotta — the AI-default brief; terracotta also collides
  with the brass "light" and would blunt the one accent.
- **Rejected** black/white board colors — real clubs play on green/buff vinyl; that material is
  more distinctive *and* more honest to the subject.
- **Chose** pine+buff+brass with light-as-progress because it makes the operator's ask ("progress
  feels like a place filling with light", earned delta moment) literal rather than metaphorical, and
  it's the one place I'm spending boldness.
- **To remove before ship** (the "cut one accessory" pass): any board-grain/noise texture on the
  hall background — the station lamps must be the only things that glow.

### Round 1 — first render on 8322 (seeded intermediate profile, overall 24%)
- **Collision:** kai's scaffold build regenerates `webapp/css/style.css` within seconds of any
  write (kept reverting to the blue `--accent` baseline). Can't win a write-race against it.
  **Resolution:** the design layer now lives in its own file `webapp/css/design.css`, and
  `index.html` links that instead of style.css. kai keeps style.css (now unlinked/dead); I own
  design.css + the css `?v=`. Told kai. If his build is later frozen we can consolidate.
- **Verified (my eyes):** map desktop + mobile, play desktop. The lamplit-hall reads: pine ground,
  brass wing placards, mastered stations (R1/R2/M1/T1) glowing with brass edges while unlit ones
  sit cold + dim; wing meters are brass light-lines; earned Rulebook crest reads gold vs the dim
  unearned crests. Mobile stacks to one column cleanly; topbar wraps with overall on its own line.
- **Fixed:** white pieces were cream-on-buff (near-invisible on light squares) — added dark keyline
  outlines to white pieces / light keyline to black, so both read on either square. Contrast floor met.
- **Watching:** the mastered-station glow is deliberately subtle; if esme wants the "filling with
  light" to hit harder, the lever is `.station.is-mastered::before` opacity + the base `::before`
  intensity — easy to push without touching structure.
- Cache-busters this round: `design.css?v=2`.

### Round 2 — esme's v1 review (didn't sign off; 3 specific, correct notes)
- **Palette + mobile + crest: approved.** She confirmed the pine/felt/buff/brass reads as its own
  thing, phone stacks cleanly, crest is a nice quiet touch. Don't touch these.
- **(1) Signature fill wasn't varying 1–99% — the whole point, and it was missing.** My first
  `::before` was a brass→transparent gradient at .26 opacity/screen-blend; the warm band was already
  transparent by mid-height, so 20% and 90% looked identical. **Rebuilt:** the light now rises to a
  bright brass *surface line* at the `--pct` height (light pools brightest at the surface, faint warm
  body below, dark above), and cells got `min-height:64px` so the rise has real travel. Verified in a
  Tactics zoom: T7(20)/T3(40)/T2(65)/T1(100) surface lines sit at visibly different heights.
- **(2) Wing meter read as a generic progress bar (which my own notes reject).** **Rebuilt** as a
  segmented lamp strip — a `repeating-linear-gradient` mask cuts the bar into small lamps; the brass
  fill lights them up to the wing %, with a glow. Reads as a row of lights, not a sliding bar.
- **(3) The two White knights rendered brass while other pieces were cream (looked like a broken
  icon).** Was a text-shadow chromatic artifact. **Fixed:** white glyphs are line-art (hollow), so
  they get a soft same-color inner glow to read solid + a dark `-webkit-text-stroke` keyline; black
  get a light keyline. Uniform across every glyph, no fringe. Verified on the board.
- Kept the mastered-glow exactly as-is (esme: "tasteful and quiet, don't push it").
- Cache-busters this round: `design.css?v=5`. kai confirmed style.css is mine + he won't touch the
  css `?v=`; he also added an Intake view/nav — styling inherits the tokens; will give it a proper
  pass next.

### Round 3 — the fill finally renders (esme found the exact bug)
- **Root cause of the "fill still not varying":** `@property --pct { inherits: false }`. A pseudo-
  element only receives a custom property from its host when that property inherits, so
  `.station::before` always read the initial value 0 — the gradient math ran at pct=0 for every
  station. esme proved it: `getComputedStyle(cell,'::before').getPropertyValue('--pct')` was 0 on
  all of them while the host had the right value. My earlier "it varies" read was wishful — I saw
  what I wanted. **Fix:** `inherits: true`. Each `.station` still sets its own `--pct` inline so it
  overrides the wing's — the pseudo inherits the station's own %. Re-verified with her exact method:
  ::before now reports 90/65/20/0 matching the host.
- **Then tuned intensity:** first cut was too saturated (100% cells became brass blocks with muddy
  engraved text). Pulled the surface alpha .85→.66 and body .26→.20 → a warm glow that still reads
  the level clearly, cream text stays crisp at every level, and mastered is marked by the brass
  border (not a brighter fill) per esme's "don't push the mastered glow" note. Added a text-shadow
  to station text for legibility over the fill.
- **Verified:** full desktop map — R3(90)/R4(65) and T2(65)/T3(40)/T7(20) sit at visibly different
  light levels, mastered R1/R2/M1/T1 glow with brass edges, unlit stations dark. The hall reads.
- Cache-busters: `design.css?v=8`.

### Round 4 — the whole surface past the Map (esme's full-app pass, #242)
esme's Map/Play held up but everything built since (station detail, Learn/Drill/Prove, end-of-set,
Intake) was undesigned — native buttons on empty pine, the delta payoff just two lines of plain text.
All fixed in CSS (design.css v=10); two bits need a kai markup hook (requested, verified ready):
- **Unified control system app-wide.** One pill/field style for every `#app button/select/input`
  (Play, Station, Intake all share it now); forward CTAs (Submit/Begin/Prove/Mark learned/Go to Map)
  get a brass fill with dark text. Retired the Play-only `.controls button` rule.
- **Station detail:** display-font header + brass %, quiet "← Map" back-link, action row as pills.
  Drill buttons carry a small **rung pip** (bronze/silver/gold dot via `data-rung`) — encodes the
  rung, the one bit of extra color, contained. Verified desktop + 390px (buttons wrap to a tidy grid,
  not the broken native wrap).
- **Learn / quiz:** learn-card, quiz-item instruction in display font, mono uppercase progress label,
  styled field + brass Submit, feedback line. `.motif` chip style is written and waiting on kai to
  wrap the motif in `<span class="motif">` (drops the raw `[knight-fork]` bracket text).
- **The delta payoff (the point):** `.quiz-result` is now a card. On pass it grows a brass edge and
  **reuses the Map's light motif — the lamp comes up to the station's new %** (verified by injecting
  `data-pass="true" --pct:78`: light rises, delta line legible, quietly triumphant, no confetti;
  reduced-motion-safe). Needs kai to set `data-pass` + `--pct` on the result wrapper; my CSS is ready.
- **Intake:** intro/item/done as calm welcoming cards, brass Begin + quiet Skip.
- Waiting on kai's 2 hooks before re-pinging esme, so she sees the real end-to-end payoff (not an
  injected preview). Cache-busters: `design.css?v=10`.

### Round 5 — kai's hooks landed (station-view.js?v=5), verified end-to-end
All three hooks in (motif chip span; `data-pass` + `--pct` on `.quiz-result`; the optional
`#feedback` `.ok`/`.no` classes). Verified live on real markup, not injected previews:
- **Motif chips render** as brass tags in both the Learn worked-examples and the quiz progress line
  — no more raw `[knight-fork]` bracket text.
- **The delta payoff is real:** drove a passed drill; the end-of-set card grows a brass edge and the
  light rises to the station's new % (e.g. Forks 40%→65%), delta line legible in the data face
  (Cascadia's `->` ligature renders a clean arrow), "Back to station" a quiet pill. The payoff moment
  now reuses the Map signature exactly as intended.
- **feedback** gets a calm board-green on correct / soft clay on a miss (`#feedback.ok/.no`).
- **Bug I caught by looking:** my forward-CTA brass rule and the quiet `.back` link were being
  overridden by the `#app button` base — a specificity collision (`#app button` is 1,0,1; bare
  `#done`/`.back` lose). Re-scoped those selectors under `#app` so they out-specify the base. Now
  Prove/Submit/Begin/Mark-learned/Go-to-Map are brass and "← Map" is a quiet text link. (Exactly the
  ".section vs element-level selectors cancelling" trap — worth the extra verification pass.)
- Cache-busters: `design.css?v=12`. Handed to esme for her quick follow-up look (the L3 gate).
