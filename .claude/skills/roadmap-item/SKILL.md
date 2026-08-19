---
name: roadmap-item
description: Run one NEON STRIKE roadmap item end to end — pick and claim it in Notion, implement it in index.html, verify with `make playtest` plus a human play, then commit, tag and close out in Notion. Runs solo by default; pass "fanout" to add read-only recon and review agent fan-outs. Use when asked to "do the next roadmap item", "work the roadmap", "do item N", or to chain items with /loop.
---

# Work one roadmap item

One invocation = one item = one commit. Never batch items: the whole point of the loop is
that each change is independently playable and revertable.

## Modes

The steps below are the same in every mode. Only steps 2 and 4 differ.

| Invocation | What runs |
| --- | --- |
| `/roadmap-item` | **Solo (default).** Next `todo` item, single session, no subagents. Exactly the loop CLAUDE.md describes. |
| `/roadmap-item 19` | Solo, on the named item instead of the next `todo`. |
| `/roadmap-item fanout` | Adds the recon fan-out (step 2) and the review fan-out (step 4). |
| `/roadmap-item 19 fanout` | Both of the above. |
| `/roadmap-item review` | Step 4 only — review fan-out over the current uncommitted diff. Use mid-item from a solo run. |
| `/roadmap-item recon` | Step 2 only — recon fan-out for an item you are about to start. |

**Solo is the default on purpose.** Spawning agents is the user's call, not a side effect of
starting a roadmap item — so `fanout` must be asked for. Prefer it for items that touch
unfamiliar parts of `index.html`, have four or more "Done when" bullets, or add a new entity
type (the state-leak class). Solo is fine and faster for tuning, copy, config and small
follow-ups.

Nothing in the fan-outs is load-bearing: they only produce a brief and a findings list. A solo
run reaches the same close-out and the same quality bar — it just does the reading and the
self-review in one context instead of several clean ones.

## The shape, and why

`index.html` is a single ~190KB file and every item edits it. So there is exactly **one
writer** — you, the main session. In `fanout` mode agents run on both sides of that edit, and
they are strictly read-only:

```
  main session          [fanout] recon — 5 agents, read-only
  picks + claims   ->   roadmap-recon.mjs      ->  anchored brief
       |
  MAIN SESSION EDITS index.html          <- single writer, never delegated
       |
       ->               [fanout] review — up to 9 agents, read-only
                        roadmap-review.mjs     ->  adjudicated findings
       |
  main session fixes -> playtests -> commits -> tags -> closes out in Notion
```

Three rules that fall out of this and must not be relaxed, in any mode:

- **Never run implementer agents in parallel**, and never use `isolation: 'worktree'` for this
  work. Two agents editing one file means hand-merging every item.
- **Only the main session talks to Notion.** Notion is a claude.ai-connected MCP server and
  may be missing inside subagents or headless runs. You fetch the spec and pass it into the
  workflows via `args`; you own every `wip` / `done` / Commit-hash / Session-Log write. This
  also removes any risk of two agents racing on an item's Status.
- **Only the main session runs `make playtest`.** The harness owns a dedicated Chrome and a
  port; two of them racing gives you contention, not coverage — and stray Chrome processes
  from an earlier run are enough to fake a frame-time regression (see step 5).

## Steps

### 1. Pick and claim — every mode

Query the Roadmap data source `collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4`:

```sql
SELECT * FROM "collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4"
WHERE Status = 'todo' ORDER BY "#" ASC LIMIT 5
```

Take the first `todo` in `#` order unless the user named an item. Respect the dependency notes
on the HQ page (item 6 before 7–11; 21 before 22–31). First check nothing is already `wip` —
if something is, resume that instead of starting a new one.

Then `notion-fetch` the item's row page for the full spec (Hook points / Sketch / Done when),
and set its Status to `wip` via `notion-update-page`.

Also read, in this order, before any code: the HQ page's **Codebase conventions**, the item's
spec, and the functions named in its Hook points.

### 2. Understand the code

**Solo:** read the functions named in Hook points, plus `update(dt)`, `startWave` and
`resetGame`, and find the closest existing feature with the same lifecycle shape to copy.
Then write yourself the same four things the fan-out would have produced — an edit plan
anchored to function names, a `resetGame` checklist, the touch-control plan, and any spec
ambiguity you had to decide. Deciding them explicitly is what keeps solo mode honest.

**Fanout:**

```
Workflow({ scriptPath: ".claude/workflows/roadmap-recon.mjs",
           args: { number, name, goal, hookPoints, sketch, doneWhen } })
```

`args` must be a real JSON object, not a stringified one. Every field comes from the Notion
row you just fetched. `scriptPath` is relative to the repo root — if you are working inside a
worktree, use that worktree's own copy under `.claude/worktrees/<name>/.claude/workflows/`.
The workflow returns an `editPlan` anchored to `index.html:<line>`, a `resetChecklist`, a
`touchPlan`, and `openQuestions`.

Either way: resolve the open questions before editing — from the spec if it answers them,
otherwise pick the reading a careful colleague would and record the assumption for the
Session Log.

### 3. Edit — you, alone, in every mode

Apply the plan with Edit against `index.html`. Stay inside the item's scope: a bug or
improvement you spot outside it does not go in this diff — write it down and file it as its
own `todo` Roadmap row at close-out (step 6). Session Log prose alone is not enough; that
queue is write-only and nothing reads it back.

Non-negotiables while editing (full list in the HQ conventions):

- Pool anything spawned per hit/kill/frame; no allocation inside `update(dt)`.
- No `PointLight` on anything that scales with wave or entity count. Bounded singletons only.
- Everything added to the scene is cleared in `resetGame` and disposed properly.
- New per-run state on `state` or `mods` (`baseMods()`), reset there too.
- SFX via `sfx.beep()` / `sfx.noiseBurst()` — never audio files.
- Any new key or ability gets a `#touch` counterpart, or an explicit keyboard-only note.

Verification is step 5, and it starts with `make playtest` — not a hand-driven browser.

### 4. Review the diff

**Solo:** self-review the diff against the four standing failure modes, in this order — state
leaks across a restart (read `resetGame` against every identifier you added), the point-light
and per-frame-allocation budget, touch parity, then conventions and CSP. Then re-read each
"Done when" bullet and name the line that enforces it. Note anything you could not settle
statically; that list feeds step 5.

**Fanout:** split the item's "Done when" sentence into separate criteria (≤ 4; the workflow
logs any it had to drop) and run:

```
Workflow({ scriptPath: ".claude/workflows/roadmap-review.mjs",
           args: { number, name, goal, doneWhen: ["...", "..."] } })
```

Fix every `blocker` and `should-fix` in `confirmed`. Judge the nits. Keep `playtestFocus` —
it is the list step 5 must cover.

### 5. Verify

Two halves. Run the first, then do the second — neither substitutes for the other.

#### The automated half — `make playtest`

```
make playtest
```

That is the command. Since item 58 the rig is checked in at `tools/playtest/`: it starts
its own static server and its own dedicated Chrome, injects its own autoplay bot, cycles
all three weapons, plays several waves, dies, restarts, plays another, and fails the run
on leaked per-run state (**reported by field name**), leaked GPU resources, a dropped
pooled object, point lights over budget, a console error, or a frame-time regression
against the machine-local baseline. `tools/playtest/README.md` is the reference.

Everything the old prose recipe in this step used to ask you to do by hand — serving over
http, keeping a Chrome window unoccluded, injecting a bot, cycling weapons, watching the
HUD FPS counter during shotgun spam, reading the console for errors, checking
`window.__neonReady` — is inside that command now. Do not redo any of it by hand.

**If the harness cannot check something your item needs, add a scenario — never a
throwaway script.** A file in `scenarios/` exporting `async (ctx) => {}` plus a line in
`SCENARIOS` in `run.mjs`; or, for a new invariant, a field in `SNAPSHOT` in `probes.mjs`.
Item 41's `scenarios/medals.mjs` is the worked example, including the two moves a
persistence check needs: seeding save state through `__probe`, and `ctx.reload()`.
This is the single most-repeated mistake in this repo's history — items 49, 50 and 51 each
built a rig in a temp dir and threw it away, item 58 existed to end that, and item 41 still
started down the same path. A hand-rolled script is also how you get a *false* perf
regression: `launch()` in `chrome.mjs` returns `close()`, not `kill()`, so a wrong cleanup
call silently leaves ~8 Chrome processes alive per run and the GPU contention halves the
next FPS sample. Check `pgrep -f 'playtest/.chrome-profile' | wc -l` before believing any
FPS number.

Run `make test` too if the item touched `lib/` or `functions/` — it is the deploy gate.

#### The human half — still required

`make playtest` passing is not "verified". It runs with the pause handlers disabled
(`probe.driven`) and it cannot judge anything aesthetic.

- **Play it**: start a run → 3+ waves → die or restart → 1+ more wave. Fresh run **and**
  restart; most state-leak bugs only appear on the second run.
- **Feel is not automatable.** Recoil weight, audio pitch, bloom intensity, readability,
  whether a warning gives fair reaction time — automation confirms presence, never
  intensity. These always get a user playtest as the final word.
- **Pause paths are automation-blind**: Esc mid-fight, alt-tab, click-to-relock, firing
  that needs a real pointer lock.
- **Verify visuals with screenshots**, several compass directions for world-scale changes.
- Exercise every "Done when" criterion, plus whatever step 4 could not settle statically.

Write everything you could not check into the Session Log entry's **`Spot-checks owed`**
property — not only the prose body — so the user knows exactly what to try in two minutes
and a later session can find it.

### 6. Close out — every mode

In this order:

1. `git commit` — message `PLAN item N: <short description>`.
2. `git tag -a v0.x.0 -m "..."` — shipped feature bumps MINOR, bugfix bumps PATCH, stay in
   `v0.x`. Then `git push --tags`. This is the version the live badge self-reports.
3. Set the item's Status to `done` and write the short hash into **`Commit hash`**. The
   `Commit` column is a read-only formula that renders the link — never write to it.
4. Create a Session Log entry in data source `collection://8d944ded-d820-4bde-9cdd-e9b83c5349b6`.
   Properties: `Entry` (title, `Item N: <name>`), `Date`, `Item #`, `Outcome`
   (`done` | `partial` | `abandoned`), `Spot-checks owed`. Body: **What landed** /
   **Tuning chosen** / **Notes for next sessions** — including what automation could not
   verify. Say which mode the item was done in, so the log stays comparable across sessions.
5. **Drain both queues.** Close-out is not finished until they are empty:
   - Each out-of-scope finding from §3 (Edit) becomes a new `todo` row in the Roadmap data
     source `collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4`, now, in this session.
     Title, `Goal` and a one-line spec is enough — the point is that the row exists, not
     that it is fully specced. Small related fixes may share one "bug sweep" row rather
     than one row each. Declining to file is allowed; declining *silently* is not — the
     Session Log entry says "declined, because …".
   - Each owed spot-check goes in the `Spot-checks owed` property, not only in prose. A
     later session that makes the check writes the verdict there or clears it; if the list
     needs deliberate setup, file it as its own Roadmap row instead (item 62 is the
     worked example).

If you stop mid-item, leave Status `wip` and say in the Session Log exactly what remains and
where the work stopped.

## Chaining items

`/loop /roadmap-item` chains solo runs; `/loop /roadmap-item fanout` chains fan-out runs.
Two real limits, so say them out loud rather than letting an unattended run imply more than it
delivered:

- Feel-verification needs a human, so a chained run produces items that are code-complete but
  not feel-verified. Every Session Log entry must carry its list in `Spot-checks owed`, so the
  debt is queryable after the chain ends rather than buried in prose.
- Commits are signed through 1Password. When the vault locks, `git commit` fails with
  "failed to fill whole buffer" and the chain stops there — ask the user to unlock and commit
  with `! git commit ...`. That caps how many items chain unattended.
