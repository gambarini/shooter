---
name: roadmap-item
description: Run one NEON STRIKE roadmap item end to end, solo by default — pass "fanout" to bracket the edit with read-only recon and review agent fan-outs. Use when asked to "do the next roadmap item", "work the roadmap", "do item N", or to chain items with /loop.
---

# Work one roadmap item

**The loop itself lives in `CLAUDE.md`** — "Roadmap workflow (the progressive loop)" has the
six steps, the Notion addresses, the close-out order and the two queues; "Run / verify" has
the verification recipe; "Code conventions" has the rules the edit must respect. Read those
sections; this file does not restate them. What follows is only what is specific to running
the loop *as this skill*: the modes, the agent topology, and the two workflow invocations.

One invocation = one item = one commit.

## Modes

The loop is the same in every mode. Only steps 2 and 4 differ.

| Invocation | What runs |
| --- | --- |
| `/roadmap-item` | **Solo (default).** Next `todo` item, single session, no subagents. Exactly the loop `CLAUDE.md` describes. |
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
  port; two of them racing gives you contention, not coverage.

## The steps

Steps 1, 3, 5 and 6 are `CLAUDE.md`'s, unchanged, in both modes:

1. **Pick and claim** — `CLAUDE.md` → Roadmap workflow, steps 1–3. Fetch the item's row page
   for the full spec (Hook points / Sketch / Done when) before any code.
2. **Understand the code** — see below; this is where the modes diverge.
3. **Edit** — `CLAUDE.md` → Roadmap workflow step 4, and its "Code conventions". You, alone,
   in every mode: the single-writer rule above is not negotiable.
4. **Review the diff** — see below; this is where the modes diverge.
5. **Verify** — `CLAUDE.md` → "Run / verify": `make playtest`, then the human half. Cover
   whatever step 4 could not settle statically, and every "Done when" criterion.
6. **Close out** — `CLAUDE.md` → Roadmap workflow step 6: commit, tag, `done` + `Commit hash`,
   Session Log entry, then drain both queues. Say which mode the item was done in, so the log
   stays comparable across sessions. If you stop mid-item, leave Status `wip` and say in the
   Session Log exactly what remains and where the work stopped.

### Step 2 — understand the code

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

### Step 4 — review the diff

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
