---
name: roadmap-item
description: Run one NEON STRIKE roadmap item end to end — pick and claim it in Notion, implement it in index.html, verify in the browser, then commit, tag and close out in Notion. Runs solo by default; pass "fanout" to add read-only recon and review agent fan-outs. Use when asked to "do the next roadmap item", "work the roadmap", "do item N", or to chain items with /loop.
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
- **Only the main session drives the browser.** One Chrome, one port, and the HQ recipe needs
  a visible unoccluded window for `requestAnimationFrame` to run at real speed.

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
improvement you spot outside it goes in the Session Log's "Notes for next sessions", not in
this diff.

Non-negotiables while editing (full list in the HQ conventions):

- Pool anything spawned per hit/kill/frame; no allocation inside `update(dt)`.
- No `PointLight` on anything that scales with wave or entity count. Bounded singletons only.
- Everything added to the scene is cleared in `resetGame` and disposed properly.
- New per-run state on `state` or `mods` (`baseMods()`), reset there too.
- SFX via `sfx.beep()` / `sfx.noiseBurst()` — never audio files.
- Any new key or ability gets a `#touch` counterpart, or an explicit keyboard-only note.

If the item touches `lib/` or `functions/`, run `make test` — it is the deploy gate.

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

### 5. Playtest — you, in the browser, in every mode

Follow the HQ page's **Verification recipe**; the parts most often skipped:

- Serve over http (`make serve`, or `make dev` when the change touches `functions/` or `lib/`)
  — not `file://`.
- Keep the automation Chrome window **visible and unoccluded** for the whole play phase.
  Chrome throttles `rAF` on occluded windows, which silently invalidates every FPS number.
  If the game seems frozen, check `document.visibilityState` before blaming the code.
- Drive with an injected in-page autoplay bot — synthetic mouse events never get pointer lock.
  Make the bot **cycle all three weapons**, and watch the FPS counter (Settings → SHOW FPS)
  during shotgun spam specifically.
- Minimum loop, always: start a run → 3+ waves → die or restart → 1+ more wave. Fresh run
  **and** restart; most state-leak bugs only appear on the second run.
- `read_console_messages` for errors at boot and after the run; confirm `window.__neonReady === true`.
- Exercise every "Done when" criterion, plus whatever step 4 could not settle statically.

**Feel is not automatable.** Recoil weight, audio pitch, bloom intensity, whether a warning
gives fair reaction time — automation confirms presence, never intensity. Write the spot-check
list into the Session Log so the user knows exactly what to try in two minutes.

### 6. Close out — every mode

In this order:

1. `git commit` — message `PLAN item N: <short description>`.
2. `git tag -a v0.x.0 -m "..."` — shipped feature bumps MINOR, bugfix bumps PATCH, stay in
   `v0.x`. Then `git push --tags`. This is the version the live badge self-reports.
3. Set the item's Status to `done` and write the short hash into **`Commit hash`**. The
   `Commit` column is a read-only formula that renders the link — never write to it.
4. Create a Session Log entry in data source `collection://8d944ded-d820-4bde-9cdd-e9b83c5349b6`.
   Properties: `Entry` (title, `Item N: <name>`), `Date`, `Item #`, `Outcome`
   (`done` | `partial` | `abandoned`). Body: **What landed** / **Tuning chosen** /
   **Notes for next sessions** — including what automation could not verify. Say which mode
   the item was done in, so the log stays comparable across sessions.

If you stop mid-item, leave Status `wip` and say in the Session Log exactly what remains and
where the work stopped.

## Chaining items

`/loop /roadmap-item` chains solo runs; `/loop /roadmap-item fanout` chains fan-out runs.
Two real limits, so say them out loud rather than letting an unattended run imply more than it
delivered:

- Feel-verification needs a human, so a chained run produces items that are code-complete but
  not feel-verified. Every Session Log entry must carry its spot-check list.
- Commits are signed through 1Password. When the vault locks, `git commit` fails with
  "failed to fill whole buffer" and the chain stops there — ask the user to unlock and commit
  with `! git commit ...`. That caps how many items chain unattended.
