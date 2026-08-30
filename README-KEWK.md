# HSPlanner — local enhancements

This is the cumulative record of the work added to this local HSPlanner tree.
It deliberately documents **only our changes**, across every implementation
session so far. The general project overview remains in [`README.md`](README.md).

> **Scope snapshot:** KewkLW feature work rebased onto upstream `main` at
> `53d8fe3` (HSPlanner `1.0.5`), reviewed on 2026-08-30. These changes remain
> separate from the upstream project.

## At a glance

| Area | What we added or fixed |
|---|---|
| Allocation loadouts | Eight independent numbered slots each for Spec, Incarnation, and Ether, with durable save/share support |
| Incarnation limits | Explicit Hero Level with one-point-per-level caps across clicks, paths, suggestions, saves, and all eight loadouts |
| Gear optimizer | Native selected-spell loadout search, rarity rules, optional stat minimums, progress, comparison, and explicit apply |
| Upgrade advisor | Repaired skill targeting so **Scan for upgrades** works from any allocated damaging active skill |
| Season 10 skills | Complete prerequisite graph for all 24 classes and 48 class-specific trees, including multi-parent gates |
| Skill interaction | Left-click allocation on the icon itself, keyboard behavior, accurate locked states, and reliable hover names |
| Skill layouts | Current Bard, Prophet, and screenshot-backed Jötunn tree placement corrections |
| Build import/update | Authenticated development-only JSON importer plus revision-checked in-place profile patches |
| Frost Orb build | Screenshot-transcribed gear, Incarnation/Ether presets, and Magister skill allocation |
| Data correctness | Five affix stat-key repairs, effective resistance display, and targeted equipment regression coverage |

## Spec, Incarnation, and Ether loadouts

The Spec, Incarnation, and Ether tabs now each have an independent eight-slot
loadout bar matching the in-game numbered-selector pattern. Slot 1 exists by
default. Clicking any visible `+` creates that exact numbered slot, turns the
button into its number, activates a blank allocation, and preserves the slot
being left. Clicking a number swaps back to the saved allocation in that domain
without changing either of the other two domains.

Each bank stores the game-facing allocation state for its domain:

- **Spec:** allocated attributes, main-skill ranks, subskill ranks, bound active
  skills, and the selected aura.
- **Incarnation:** allocated nodes and socketed Incarnation content.
- **Ether:** allocated Ether nodes.

These are intentionally separate from Saved Build **Profiles**. A Profile is a
complete planner build; every Profile can now contain its own three loadout banks,
and a Spec, Incarnation, and Ether slot can be combined independently.

The banks persist through autosave, manual saves, Profile switching, imports, and
share codes. Share schema v2 carries an optional compact bank payload while still
keeping the active allocation in the original top-level fields, so older readers
can load the active combination. Existing codes without banks open as slot 1.

Reset controls affect only the active slot. Changing class collapses the
class-bound Spec bank and clears Incarnation socket contents in every occupied
Incarnation slot. Changing season clears the allocations in every occupied
Incarnation and Ether slot. Loadout selection is treated as navigation, so undo
history is cleared at a switch instead of allowing Ctrl+Z to alter a different
loadout. Incarnation switches also revalidate node-gated offhand legality, just
like editing or resetting the active Incarnation allocation.

The primary build navigation now follows the game-facing order **Character →
Spec → Incarnation → Ether**. The former user-facing **Tree** name is now
**Incarnation** in navigation, statistics, tutorials, source labels, node
previews, the suggestion dialog, and season-reset guidance. Internal `skills`
and `tree` IDs plus legacy `Tree:` source parsing are unchanged for
compatibility.

## Incarnation Hero-Level cap and visual identity

Hero Level is now explicit build state instead of being inferred from however
many nodes happen to be allocated. The live Season 10 screenshots establish the
current player-facing rule: one allocatable Incarnation node/point per Hero
Level. At Hero Level 53, a 33-node loadout has 20 points left and a 53-node
loadout has zero. An older installed tutorial sentence says two Incarnation
points per Hero Level, but it does not match the current in-game point display
and is not used for planner limits.

The cap applies atomically to direct node clicks, automatically completed paths,
and suggested-node application. The suggestion budget cannot exceed the points
left and its action disables at zero. The authenticated local patch route and
share decoder reject over-cap allocations as well. Removing nodes always remains legal.
Hero Level can be edited on the Incarnation view or under Config → Character,
but cannot be lowered below the largest occupied allocation in any of the eight
saved Incarnation slots.

Hero Level persists through autosave, Saved Build Profiles, imports, resets, and
share-code round trips. Legacy profiles and share codes that predate the field
infer the smallest legal Hero Level from the largest occupied Incarnation slot;
the two existing 53-node Frost Orb slots therefore migrate to Hero Level 53
without losing allocations.

Incarnation and Ether now also have distinct game-matching surfaces. Incarnation
uses an exported dark red/black brick field matching the supplied screenshots, while
Ether alone uses the purple cosmic background. The data routes were already
separate; this corrects the misleading shared background and makes the two
views immediately distinguishable.

## Spell-damage gear optimizer

The Gear tab now has a native optimizer for the ten regular equipment slots. It
scores each proposed loadout against one allocated active spell with a supported
damage model.

### How spell targeting works

- If a configured active damage skill is still allocated and supported, it is
  selected by default.
- Otherwise, the first allocated damaging active skill is used.
- Every score is pinned to that one spell. Damage from multiple selected skills
  is never combined accidentally.
- The spell selector can switch between any other allocated damaging skills.
- With no eligible spell allocated, the action stays disabled and tells the user
  to allocate one in the Spec tab.

### Search and results

The Rust engine builds several complete-set seeds, performs repeated slot sweeps,
and refines promising results with paired swaps. The UI reports live progress and
then shows:

- selected-spell DPS before and after optimization;
- percentage gain;
- number of mathematical evaluations and search passes;
- whether all requested minimums were met;
- the value and pass/fail state of every minimum;
- every regular slot that would change; and
- an explicit **Apply loadout** action.

The result is intentionally described as **best found**, not as an exhaustive
proof of the global optimum.

### Rarity rules

Regular item bases can be searched with any of these rules:

- any rarity;
- exactly one rarity;
- at least one rarity tier; or
- at most one rarity tier.

Supported tiers are Common, Uncommon, Rare, Mythic, Satanic, Heroic, Angelic,
and Unholy. Satanic rules include Satanic Set bases.

### Optional minimums

The `+` controls beside supported rows in the left stats panel add minimum values
that every valid optimizer result must reach. An active control changes to `≥`
and can be edited or removed.

Supported attributes:

- Strength, Dexterity, Intelligence, Energy, Vitality, and Armor.

Supported stats:

- Enhanced Damage, Attack Damage, Attack Speed, Faster Cast Rate, Critical
  Chance, Critical Damage, Life Steal, Mana Steal, Life, Mana, Life Replenish,
  Mana Replenish, Block Chance, Physical Damage Reduction, and Magic Damage
  Reduction.
- Fire, Cold, Lightning, Poison, and Arcane Resistance.

If no searched loadout satisfies every minimum, the closest result is displayed
for diagnosis but cannot be applied. Minimums and the rarity rule persist through
autosave, saved profiles, imported builds, snapshots, and share-code round trips.

### Apply behavior and limits

Applying a result replaces regular equipment with clean item bases. Existing
relics, charms, and potions stay equipped, and offhand legality is revalidated.

Version 1 deliberately does **not** search:

- affixes;
- forging;
- sockets, gems, or runes;
- runewords;
- stars;
- augments;
- random-skill selections;
- manually entered implicit roll overrides;
- display-only unique effects; or
- alternate relics, charms, or potions.

Because regular slots are replaced with clean bases, applying a result clears
those customizations, runewords, random-skill choices, and roll overrides from
the affected regular items. The disabled Relics, Charms, and Potions controls in
the UI are placeholders for later expansion.

## Upgrade advisor repair

**Scan for upgrades** now uses the same exact-spell selection rules as the
optimizer. It no longer depends on a separately selected main skill and remains
disabled only when the build has no allocated damaging active skill.

The advisor's existing base-item comparison, empty-slot ordering, top-five list,
and 2% cutoff are unchanged. Our change is the repaired spell targeting and
accurate disabled-state guidance; affixes and other item customization remain a
separate decision.

## Complete Season 10 skill prerequisites

Season 10 now has a dedicated prerequisite dataset covering:

- 24 classes;
- 48 class-specific skill trees;
- 264 skills with at least one prerequisite;
- 277 direct prerequisite links; and
- 13 skills that require two parents.

Every listed parent uses **AND** semantics: each parent must have at least one
allocated rank before the child can receive a point. Removing a parent
recursively removes allocated descendants that are no longer legal.

One shared rule now drives all prerequisite behavior:

- allocation and removal;
- locked and unlocked icon states;
- connector lines;
- requirement names in skill details and hover text; and
- rank-progression previews.

The graph includes the client-confirmed White Mage chain
**Flash Heal → Holy Shield → Healing Zone**. The horizontal Butcher's Hook →
Chain Swing line is visual-only in the game and is deliberately not treated as
an allocation gate. Older single-parent `requiresSkill` data remains supported.

The prerequisite dataset is Season 10-specific; other seasons keep their own
existing behavior.

## Skill-tree interaction and display fixes

### Direct icon allocation

- A normal left click on the main skill icon selects the skill and spends one
  point when allocation is legal.
- The compact `+` control remains available as an allocation-only target.
- Keyboard activation works on the primary icon.
- Modifier-key allocation behavior is preserved.
- Locked, maximum-rank, and no-points states can still be inspected without
  illegally adding a rank.
- Rank badges no longer intercept the icon click.

### Hover names and requirements

Every primary skill icon now exposes its name through a native hover title,
whether it has zero ranks or is already allocated. Locked icons append their
human-readable prerequisite names. This fixes the misleading behavior where an
allocated icon appeared to lose its hover name.

### Current Season 10 layouts

Tree positions and level tiers were corrected for Bard's Pit Fighter tree and
Prophet's Forest Mystic and Skinwalker trees.

Jötunn's **Son of Ymir** tree was reconciled against the supplied in-game
screenshot. Its final grid is:

| Row | Left | Middle | Right |
|---:|---|---|---|
| 0 | Frozen Boulder | — | Breath of Ice |
| 1 | Icicles | Frozen Hide | — |
| 2 | — | Orb of Frost | Power of the Ancients |
| 3 | Portal of Ice | — | Avatar of Frost |
| 4 | — | Blizzard | — |

The six actual gates remain:

- Frozen Boulder → Icicles;
- Breath of Ice → Frozen Hide;
- Icicles → Orb of Frost;
- Icicles → Portal of Ice;
- Power of the Ancients → Avatar of Frost; and
- Orb of Frost → Blizzard.

All nine positions and all six connections have regression coverage.

## Development build importer

A development-only importer can add an uncompressed share-payload JSON file to
the saved-build library while the Tauri development app is running:

```bash
npm run import-build -- imports/example.json "My build name"
```

This is not UI automation and does not write directly to browser LevelDB. The
request goes through the application's normal decoding, validation, library, and
local-storage path.

The importer:

- listens only on the loopback development server;
- requires a per-run bearer token created by the Vite development server and
  exposed to the registered debug WebView through Tauri;
- checks origin and content type;
- caps payload size, pending requests, and acknowledgment time;
- preserves a validated source share code;
- accepts an optional build name;
- deduplicates identical builds and can rename an existing match; and
- is unavailable in production builds.

The development app currently expects Vite on port `5173`. Start it with
`npm run tauri:dev` before running the import command.

### In-place profile patches

An existing profile can be extended without creating a second build:

```bash
npm run patch-build -- imports/example.patch.json
```

The request targets exact build and profile IDs and accepts only Incarnation
slots, Ether slots, and mercenary class/skill ranks. Inventory and every other
field are outside the allow-list. The command dry-runs first, checks the profile
revision before applying, merges from the live planner snapshot when that
profile is open, commits through the normal saved-profile path, and immediately
synchronizes the active Zustand state. This prevents the 800 ms autosave from
restoring stale data over a storage-only edit.

After applying, the command waits past that autosave window and verifies the
exact requested node sets and mercenary ranks, the full applied inventory, the
same build/profile IDs, and an unchanged saved-build count. Inventory is not a
patchable field; if an active Incarnation change makes the equipped offhand
illegal, the command names that automatic removal and uses the applied
inventory as the post-autosave verification baseline.

## Included Frost Orb build inputs

[`imports/kewk-s10-frost-orb-gear.json`](imports/kewk-s10-frost-orb-gear.json)
is the gear-only payload transcribed from 22 supplied screenshots. It contains:

- ten regular equipment pieces;
- ten charms;
- fourteen Pristine Sapphires;
- six Um runes in Tombstone;
- a five-star Lunar Prophet's Band; and
- Dragon's Heart with its rainbow socket.

No relic or potion screenshot was supplied, and the payload contains no skill
allocation. To use its gear actions for the Frost Orb setup, allocate
**Frozen Boulder → Icicles → Orb of Frost** first.

[`imports/kewk-s10-frost-orb-spec.patch.json`](imports/kewk-s10-frost-orb-spec.patch.json)
is the screenshot-mapped in-place extension for the existing Frost Orb profile.
It contains:

- Incarnation slot 1: 53 nodes, combining the earlier 33-node screenshot with
  the later 20-point completion;
- Incarnation slot 2: 53 nodes;
- Ether slot 1: 22 nodes;
- Ether slot 3: 20 nodes; and
- the Magister mercenary with all 100 shown skill points, including rank 8
  Elemental Intellect and four rank-20 skills.

The original gear JSON remains an immutable transcription/provenance input.
The patch file deliberately changes only the photographed allocation domains,
so the current Frost Orb player skill ranks, gear, notes, and unshown loadout
slots are preserved.

Some screenshot details exceed the current planner data model, so this payload
is intentionally honest rather than falsely exact:

- generated charm names and rarities are approximations;
- Dragon's Heart's exact `+2 Dragon's Wrath` roll cannot be represented;
- several Tombstone block stats are absent; and
- some base-item metadata in the planner is stale.

## Smaller data and calculation fixes

Five affixes now write to the stat their text actually describes:

| Affix | Corrected stat |
|---|---|
| Bullseye | Percentage Attack Rating |
| Jaguarheart's | Increased Life |
| Lionheart's | Increased Life |
| Projectileguard | Defense versus Missiles |
| Manabloom | Mana Replenishment Percentage |

Resistance rows in the left panel now show their combined/effective calculated
values consistently. This also keeps resistance minimums aligned with the value
the optimizer evaluates.

A regression test confirms that Jötunn can legally use Book of Cold Death with
Glacier Talons as a one-handed weapon/offhand pair. The runtime dual-wield rule
already allowed this combination; the added work is protection against a future
regression.

## Persistence and validation hardening

- Optimizer minimums and rarity rules are included in autosave, profiles,
  snapshots, imported builds, and share codes.
- Spec, Incarnation, and Ether banks are included in autosave, profiles,
  snapshots, imported builds, and backward-compatible schema-v2 share codes.
- Imported codes are decoded and normalized through the existing build schema.
- Existing-profile patches reject unknown fields and node IDs, invalid loadout
  indices, disconnected node paths, cross-season targets, cross-class
  mercenary skills, and ranks outside 0–20.
- Active-profile patches merge from the latest live snapshot and synchronize
  top-level allocations with the selected Incarnation/Ether bank slots before
  autosave can run. Retained Incarnation sockets are preserved, active offhand
  legality is rechecked, and a concurrent revision or season change returns a
  retryable conflict rather than committing stale data.
- Unsupported, non-finite, and out-of-range optimizer values are discarded
  rather than becoming invisible state. Share payloads with more than the 26
  supported threshold entries are rejected.
- Applied optimizer results preserve special inventory categories and validate
  weapon/offhand compatibility.
- Import names are trimmed and bounded, and valid source codes can be preserved
  instead of being needlessly regenerated.

## Verification

Latest complete local verification:

| Check | Result |
|---|---|
| `npm test -- --maxWorkers=4` | Passed — 128 test files, 1,103 tests |
| `node --test scripts/patch-build-lib.test.mjs` | Passed — 2 tests |
| `npm run lint` | Passed |
| `npm run build` | Passed — TypeScript and Vite production build |
| `cargo check --manifest-path engine\Cargo.toml` | Passed |

Coverage added with this work includes allocation-bank UI/store/autosave/share/
season-migration behavior, optimizer UI/store/bridge/share behavior,
Season 10 graph integrity and cascade removal, multi-parent rank progression,
skill icon interaction and hover labels, complete Jötunn placement and gates,
upgrade targeting, and the Frost Orb-compatible equipment combination.

The Rust optimizer has focused unit coverage plus an ignored full-catalog smoke
test. A full `cargo test` run is not claimed here; the recorded Rust-wide check is
`cargo check`.

## Scope boundary

This file does not claim:

- features already present in upstream HSPlanner;
- HS Tracker changes or research;
- gameplay, market, XP, or socket recommendations that did not change this app;
- superseded intermediate layout attempts; or
- package-lock and line-ending noise as product work.
