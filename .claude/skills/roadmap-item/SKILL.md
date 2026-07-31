---
name: roadmap-item
description: Run one NEON STRIKE roadmap item end to end — pick and claim it in Notion, fan out read-only recon agents, make the single-writer edit to index.html, fan out review agents, playtest in the browser, then commit, tag and close out in Notion. Use when asked to "do the next roadmap item", "work the roadmap", "do item N", or to chain items with /loop.
---

# Work one roadmap item

One invocation = one item = one commit. Never batch items: the whole point of the loop is
that each change is independently playable and revertable.

## The shape, and why

`index.html` is a single ~190KB file and every item edits it. So there is exactly **one
writer** — you, the main session. Agents run on both sides of that edit, read-only:

```
  main session          recon fan-out (5 agents, read-only)
  picks + claims   ->   .claude/workflows/roadmap-recon.mjs     ->  brief
       |
  MAIN SESSION EDITS index.html          <- single writer, never delegated
       |
       ->               review fan-out (up to 9 agents, read-only)
                        .claude/workflows/roadmap-review.mjs    ->  findings
       |
  main session fixes -> playtests -> commits -> tags -> closes out in Notion
```

Three rules that fall out of this and must not be relaxed:

- **Never run implementer agents in parallel**, and never use `isolation: 'worktree'` for
  this work. Two agents editing one file means hand-merging every item.
- **Only the main session talks to Notion.** Notion is a claude.ai-connected MCP server and
  may be missing inside subagents or headless runs. You fetch the spec and pass it into the
  workflows via `args`; you own every `wip` / `done` / Commit-hash / Session-Log write. This
  also removes any risk of two agents racing on an item's Status.
- **Only the main session drives the browser.** One Chrome, one port, and the HQ recipe
  needs a visible unoccluded window for `requestAnimationFrame` to run at real speed.

## Steps

### 1. Pick and claim

Query the Roadmap data source `collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4`:

```sql
SELECT * FROM "collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4"
WHERE Status = 'todo' ORDER BY "#" ASC LIMIT 5
```

Take the first `todo` in `#` order unless the user named an item. Respect the dependency
notes on the HQ page (item 6 before 7–11; 21 before 22–31). First check nothing is already
`wip` — if something is, resume that instead of starting a new one.

Then `notion-fetch` the item's row page for the full spec (Hook points / Sketch / Done when),
and set its Status to `wip` via `notion-update-page`.

Also read, in this order, before any code: the HQ page's **Codebase conventions**, the item's
spec, and the functions named in its Hook points.

### 2. Recon fan-out

```
Workflow({ scriptPath: ".claude/workflows/roadmap-recon.mjs",
           args: { number, name, goal, hookPoints, sketch, doneWhen } })
```

`args` must be a real JSON object, not a stringified one. Every field comes from the Notion
row you just fetched. `scriptPath` is relative to the repo root — if you are working inside a
worktree, use that worktree's own copy under `.claude/worktrees/<name>/.claude/workflows/`. The workflow returns an `editPlan` anchored to `index.html:<line>`, a
`resetChecklist`, a `touchPlan`, and `openQuestions`.

Resolve `openQuestions` yourself before editing — from the spec if it answers them, otherwise
pick the reading a careful colleague would and record the assumption for the Session Log.

### 3. Edit — you, alone

Apply the brief with Edit against `index.html`. Stay inside the item's scope: a bug or
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

### 4. Review fan-out

Split the item's "Done when" sentence into separate criteria (≤ 4; the workflow logs any it
had to drop) and run:

```
Workflow({ scriptPath: ".claude/workflows/roadmap-review.mjs",
           args: { number, name, goal, doneWhen: ["...", "..."] } })
```

Fix every `blocker` and `should-fix` in `confirmed`. Judge the nits. Keep `playtestFocus` —
it is the list step 5 must cover, and what static review could not settle.

### 5. Playtest — you, in the browser

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
- Exercise every "Done when" criterion, plus everything in `playtestFocus`.

**Feel is not automatable.** Recoil weight, audio pitch, bloom intensity, whether a warning
gives fair reaction time — automation confirms presence, never intensity. Write the spot-check
list into the Session Log so the user knows exactly what to try in two minutes.

### 6. Close out

In this order:

1. `git commit` — message `PLAN item N: <short description>`.
2. `git tag -a v0.x.0 -m "..."` — shipped feature bumps MINOR, bugfix bumps PATCH, stay in
   `v0.x`. Then `git push --tags`. This is the version the live badge self-reports.
3. Set the item's Status to `done` and write the short hash into **`Commit hash`**. The
   `Commit` column is a read-only formula that renders the link — never write to it.
4. Create a Session Log entry in data source `collection://8d944ded-d820-4bde-9cdd-e9b83c5349b6`.
   Properties: `Entry` (title, `Item N: <name>`), `Date`, `Item #`, `Outcome`
   (`done` | `partial` | `abandoned`). Body: **What landed** / **Tuning chosen** /
   **Notes for next sessions** — including what automation could not verify.

If you stop mid-item, leave Status `wip` and say in the Session Log exactly what remains and
where the work stopped.

## Chaining items

`/loop /roadmap-item` runs items back to back. Two real limits, so say them out loud rather
than letting an unattended run imply more than it delivered:

- Feel-verification needs a human, so a chained run produces items that are code-complete but
  not feel-verified. Every Session Log entry must carry its spot-check list.
- Commits are signed through 1Password. When the vault locks, `git commit` fails with
  "failed to fill whole buffer" and the chain stops there — ask the user to unlock and commit
  with `! git commit ...`. That caps how many items chain unattended.
