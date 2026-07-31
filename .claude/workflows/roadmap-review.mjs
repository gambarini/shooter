export const meta = {
  name: 'roadmap-review',
  description: 'Read-only fan-out that reviews the uncommitted diff for one NEON STRIKE roadmap item, one agent per Done-when bullet plus four standing lenses',
  whenToUse:
    'Run from the main session AFTER the index.html edit is written and BEFORE the browser playtest and commit. Pass the spec + Done-when bullets via args. Returns adjudicated findings; the main session applies the fixes.',
  phases: [
    { title: 'Lenses', detail: 'standing conventions checks + one agent per Done-when bullet' },
    { title: 'Adjudicate', detail: 'confirm or kill each finding against the real diff' },
  ],
}

// ---------------------------------------------------------------------------
// args: { number, name, goal, doneWhen: string[] }
// `doneWhen` is the item's "Done when" sentence split into separate criteria —
// each becomes its own agent, so no bullet gets skimmed. No Notion calls here;
// the main session owns those. See .claude/skills/roadmap-item/SKILL.md.
// ---------------------------------------------------------------------------
const item = args ?? {}
const doneWhen = Array.isArray(item.doneWhen) ? item.doneWhen : []

// Agent budget: 4 standing lenses + N criteria + 1 adjudicator, held under the
// session's 15-agent guideline. Criteria beyond the cap are reported, not dropped
// silently — split a fat "Done when" into <= 4 bullets upstream if you hit this.
const CRITERIA_CAP = 4
const criteria = doneWhen.slice(0, CRITERIA_CAP)
if (doneWhen.length > CRITERIA_CAP) {
  log(`NOT REVIEWED by a dedicated agent (${doneWhen.length - CRITERIA_CAP} over cap): ${doneWhen.slice(CRITERIA_CAP).join(' | ')}`)
}

const RULES = `
You are reviewing an UNCOMMITTED diff. You are READ-ONLY: do not edit or write any file, and do not commit.
Get the diff with \`git diff\` and \`git diff --stat\` (and \`git status\` for new files); read the surrounding
code in index.html for context — a diff hunk alone is not enough to judge this codebase.
The whole game is one file: index.html. Project rules are in CLAUDE.md.
Report only defects you can anchor to a real line. An empty findings list is a valid and welcome answer;
do not invent issues to look thorough.
Your final message IS the return value: no preamble, no sign-off.
`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail', 'unclear'] },
    evidence: { type: 'string', description: 'what you read to reach the verdict' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['anchor', 'problem', 'failureScenario', 'severity'],
        properties: {
          anchor: { type: 'string', description: 'index.html:<line>' },
          problem: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete player actions -> wrong behaviour' },
          severity: { type: 'string', enum: ['blocker', 'should-fix', 'nit'] },
          fix: { type: 'string' },
        },
      },
    },
  },
}

// Standing lenses — the four failure modes this project actually ships.
// Sourced from CLAUDE.md and the Notion HQ "Codebase conventions" + "Cross-cutting reminders".
//
// Deliberately NO `model` override anywhere in this file: every agent inherits the
// session model. This workflow is the quality gate for a game with no tests, where
// the cost of a missed finding is a broken restart shipped to the live site and a
// wasted playtest. roadmap-recon.mjs downgrades its two retrieval-only lenses to
// sonnet; that trade does not apply here, where every lens is a judgement call.
const LENSES = [
  {
    key: 'state-leak',
    q: `State leaks across runs. Every scene object, timer, pool entry, \`state\` flag and \`mods\` field this diff
adds must be cleared by resetGame (and disposed via the disposeEnemy pattern where relevant). Read resetGame in
full and diff it against everything the change introduces. Then walk the second-run path explicitly: after a
death and restart, what is still alive, still ticking, or still holding a stale value? This is the project's
most common bug class — assume there IS one until you have checked every added identifier.`,
  },
  {
    key: 'perf',
    q: `Performance and the point-light budget. Two hard rules: (1) nothing that scales with wave or entity count
may own a PointLight — per-entity lights once dropped wave 13+ to ~6 FPS, and bounded singletons (boss, nova) are
the only sanctioned exception; (2) no per-frame allocation inside update(dt) — anything spawned per hit/kill/frame
must use the particlePool / tracerPool pattern. Audit the diff for new lights, new geometry/material/Vector3
construction on the hot path, and any loop that grows with enemy count.`,
  },
  {
    key: 'input-parity',
    q: `Input and touch parity. If this change adds a key, ability or toggle, it needs a counterpart in the #touch
block (markup AND the JS that wires it) — or an explicit keyboard-only decision. Check that new keys do not
collide with existing bindings, that they respect the state.running / paused / choosing gates, and that nothing
new stays live while the upgrade screen or pause menu is up. Report which touch buttons exist versus which the
change would need.`,
  },
  {
    key: 'conventions',
    q: `Conventions and finish. Check: sfx added via the sfx object's beep()/noiseBurst() rather than any audio
file or new synthesis path; neon palette respected (cyan #00f0ff, hot pink #ff2e88, emissive glow); HUD text
routed through the \`ui\` object and flashCombo/flashTip; new per-run modifiers added to baseMods(); nothing
that would violate the CSP in _headers; and — if lib/ or functions/ were touched at all — that \`make test\`
still passes (run it; it is the deploy gate). Also flag dead code, debug logging, and commented-out blocks.`,
  },
]

phase('Lenses')
const lensRuns = LENSES.map((lens) => () =>
  agent(`${RULES}\n\nItem ${item.number ?? '?'} — ${item.name ?? ''}\nGoal: ${item.goal ?? '(none)'}\n\nYOUR REVIEW LENS (${lens.key}):\n${lens.q}`, {
    label: `lens:${lens.key}`,
    phase: 'Lenses',
    schema: FINDINGS,
  }).then((r) => ({ source: lens.key, ...r })),
)

// One agent per acceptance criterion: each is told to prove its own bullet false.
const criteriaRuns = criteria.map((c, i) => () =>
  agent(`${RULES}

Item ${item.number ?? '?'} — ${item.name ?? ''}
Goal: ${item.goal ?? '(none)'}

YOUR SINGLE ACCEPTANCE CRITERION:
"${c}"

Decide whether the diff actually satisfies it. Try to prove it does NOT: trace the code path that would violate
it and describe the exact player actions that get there. Only return verdict "pass" if you traced the code that
enforces it and can cite the line. Judge nothing outside this one criterion.`, {
    label: `done-when:${i + 1}`,
    phase: 'Lenses',
    schema: FINDINGS,
  }).then((r) => ({ source: `done-when:${i + 1}`, criterion: c, ...r })),
)

// Barrier is correct: the adjudicator needs every report at once to dedupe
// findings that several lenses hit from different angles.
const reports = (await parallel([...lensRuns, ...criteriaRuns])).filter(Boolean)
const raw = reports.flatMap((r) => (r.findings ?? []).map((f) => ({ ...f, source: r.source })))
log(`${reports.length}/${LENSES.length + criteria.length} reports returned; ${raw.length} raw findings`)

if (raw.length === 0) {
  return { item: { number: item.number, name: item.name }, reports, confirmed: [], note: 'no findings raised' }
}

phase('Adjudicate')
// One bounded adjudicator rather than N adversarial verifiers per finding — that
// keeps the run inside the 15-agent guideline. If the guideline is raised, the
// upgrade is a parallel() of 3 refuters per finding, majority-kill.
const adjudicated = await agent(
  `${RULES}

Item ${item.number ?? '?'} — ${item.name ?? ''}

${raw.length} findings were raised by independent reviewers who each saw only their own lens. Adjudicate them.
For EACH finding: re-read the cited line and its surroundings yourself, then either CONFIRM it (the defect is
real and reachable) or KILL it (misread, already handled elsewhere, out of this item's scope, or purely stylistic).
Default to KILL when you cannot reproduce the reviewer's reasoning in the actual code. Merge duplicates that
describe the same defect from different lenses. Rank survivors blockers-first.

${JSON.stringify(raw, null, 2)}`,
  {
    label: 'adjudicate',
    phase: 'Adjudicate',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['confirmed', 'killed'],
      properties: {
        confirmed: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['anchor', 'problem', 'failureScenario', 'severity', 'fix'],
            properties: {
              anchor: { type: 'string' },
              problem: { type: 'string' },
              failureScenario: { type: 'string' },
              severity: { type: 'string', enum: ['blocker', 'should-fix', 'nit'] },
              fix: { type: 'string' },
              sources: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        killed: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['problem', 'why'],
            properties: { problem: { type: 'string' }, why: { type: 'string' } },
          },
        },
        playtestFocus: {
          type: 'array',
          items: { type: 'string' },
          description: 'what static review could NOT settle — the human/browser playtest must cover these',
        },
      },
    },
  },
)

return {
  item: { number: item.number, name: item.name },
  criteriaVerdicts: reports.filter((r) => r.criterion).map((r) => ({ criterion: r.criterion, verdict: r.verdict })),
  confirmed: adjudicated?.confirmed ?? [],
  killed: adjudicated?.killed ?? [],
  playtestFocus: adjudicated?.playtestFocus ?? [],
}
