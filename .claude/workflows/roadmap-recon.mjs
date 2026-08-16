export const meta = {
  name: 'roadmap-recon',
  description: 'Read-only fan-out that turns one NEON STRIKE roadmap item spec into an implementation brief with file:line anchors',
  whenToUse:
    'Run from the main session AFTER fetching the item spec from Notion and claiming it wip, BEFORE editing index.html. Pass the spec via args. Returns a brief; the main session does the actual edit.',
  phases: [
    { title: 'Recon', detail: 'five read-only agents, one question each (2 on sonnet)' },
    { title: 'Brief', detail: 'merge findings into one implementation brief' },
  ],
}

// ---------------------------------------------------------------------------
// args (real JSON, not a stringified blob):
//   { number, name, goal, hookPoints, sketch, doneWhen }
// All fields are strings except `number`. Everything comes from the Notion row —
// this script NEVER calls Notion itself. Notion is a claude.ai-connected server
// and may be absent inside subagents/headless runs, so the main session owns
// every Notion read and write. See .claude/skills/roadmap-item/SKILL.md.
// ---------------------------------------------------------------------------
const item = args ?? {}
const header = [
  `NEON STRIKE roadmap item ${item.number ?? '?'} — ${item.name ?? '(unnamed)'}`,
  `Goal: ${item.goal ?? '(none given)'}`,
  `Hook points: ${item.hookPoints ?? '(none given)'}`,
  `Sketch: ${item.sketch ?? '(none given)'}`,
  `Done when: ${item.doneWhen ?? '(none given)'}`,
].join('\n')

const RULES = `
You are doing READ-ONLY reconnaissance. Do not edit, write, or create any file.
The whole game is one file: index.html (~190KB, CSS -> HUD markup -> one <script type="module">).
Read CLAUDE.md for project rules. Anchors are FUNCTION NAMES, not line numbers.
Every claim you return must carry a concrete \`index.html:<line>\` anchor that you actually read.
If you cannot find something, say so explicitly rather than guessing.
Your final message IS the return value: no preamble, no sign-off.
`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['anchor', 'what', 'soWhat'],
        properties: {
          anchor: { type: 'string', description: 'index.html:<line> or <file>:<line>' },
          what: { type: 'string', description: 'what the code there actually does' },
          soWhat: { type: 'string', description: 'what the implementer must do about it' },
        },
      },
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
      description: 'anything the spec asks about that you could NOT locate',
    },
  },
}

// Five lenses. Each is a question no other agent is asked, so contexts stay clean
// and nothing is read twice. Keep this list at 5-6: the session workflow-size
// guideline is 15 agents total and the Brief phase spends one more.
//
// `cheap: true` downgrades a lens to Sonnet at low effort. Only the two pure
// LOCATE-AND-REPORT lenses get it — they grep index.html and transcribe what is
// there, which is not a judgement task. The three that require judgement
// (which pattern to copy, what would leak, what would make a correct-looking diff
// wrong) inherit the session model, as does the Brief that reconciles them.
const LENSES = [
  {
    key: 'anchors',
    cheap: true,
    q: `Locate every function named in this item's "Hook points", plus update(dt), startWave and resetGame.
For each: its exact line, its signature, what it currently does, and the precise place new code for this
item should slot in (before/after which statement, and why).`,
  },
  {
    key: 'precedent',
    q: `Find the closest EXISTING feature in index.html to what this item describes, and report the pattern to copy.
Prefer a feature with the same lifecycle shape (spawned/armed per wave, active for a while, torn down).
Report how it: creates its meshes, hides vs destroys them, tracks its own state, and — critically — whether it
uses a PointLight and why that was allowed. CLAUDE.md and the Notion HQ page treat point lights as a hard budget:
bounded singletons (boss, nova) may have one; anything that scales with wave/entity count may not.`,
  },
  {
    key: 'lifecycle',
    q: `Inventory the teardown path. Read resetGame and disposeEnemy in full and list EVERY category of state they
currently clear (scene objects, pools, timers, per-run flags on \`state\`, fields in baseMods()).
Then state exactly what a new feature of this item's shape would have to add to each of them to avoid a
state leak on restart. Restart leaks are this project's most common bug class — be exhaustive.`,
  },
  {
    key: 'io',
    cheap: true,
    q: `Report the input and presentation surfaces this item would touch: the keydown/keyup handler and how keys are
registered; the #touch block (markup + the JS that wires those buttons) and what a new control must add there;
the \`ui\` object and the flashCombo / flashTip helpers; the settings panel and how a toggle is persisted;
the sfx object's beep()/noiseBurst() signatures with real call-site examples; and the minimap draw loop if the
item would need to appear on it.`,
  },
  {
    key: 'landmines',
    q: `Report the convention traps that would make this item's diff wrong even if it works. Specifically:
every pooling helper (particlePool, tracerPool) with its acquire/release API; anything allocating per-frame
inside update(dt); the neon palette constants and where colors/emissives are defined; the state.running /
paused / choosing gates and which one must suppress this feature; how state.stats is fed for the death screen;
and whether _headers' CSP constrains anything this item might want to add.`,
  },
]

phase('Recon')
const recon = await parallel(
  LENSES.map((lens) => () =>
    agent(`${RULES}\n\n${header}\n\nYOUR SINGLE QUESTION (${lens.key}):\n${lens.q}`, {
      label: `recon:${lens.key}`,
      phase: 'Recon',
      schema: FINDINGS,
      ...(lens.cheap ? { model: 'sonnet', effort: 'low' } : {}),
    }).then((r) => ({ key: lens.key, ...r })),
  ),
)

// Barrier is correct here: the brief must reconcile ALL five lenses at once
// (e.g. the precedent's light usage against the landmine census).
const gathered = recon.filter(Boolean)
if (gathered.length < LENSES.length) {
  log(`recon: ${LENSES.length - gathered.length} of ${LENSES.length} lenses returned nothing — brief will be thinner`)
}

phase('Brief')
const brief = await agent(
  `${RULES}

${header}

Below are five independent recon reports on index.html. Merge them into ONE implementation brief for a single
agent who will edit index.html and must not read the whole file first.

${JSON.stringify(gathered, null, 2)}

The brief must be directly actionable and must reconcile conflicts between reports (say which one you verified
and how). Re-read index.html yourself to resolve any disagreement — do not average two claims.
Do NOT write code beyond short illustrative snippets, and do not edit anything.`,
  {
    label: 'brief',
    phase: 'Brief',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['editPlan', 'resetChecklist', 'risks'],
      properties: {
        editPlan: {
          type: 'array',
          description: 'ordered edits, each anchored to a function name and line',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['anchor', 'change'],
            properties: {
              anchor: { type: 'string' },
              change: { type: 'string' },
              pattern: { type: 'string', description: 'existing code to imitate, if any' },
            },
          },
        },
        resetChecklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'every line resetGame/disposeEnemy must gain, phrased as a check',
        },
        touchPlan: { type: 'string', description: 'the touch-control counterpart, or why this item needs none' },
        risks: {
          type: 'array',
          items: { type: 'string' },
          description: 'convention landmines and perf traps specific to this item',
        },
        openQuestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'spec ambiguities the main session must decide before editing',
        },
      },
    },
  },
)

return { item: { number: item.number, name: item.name }, brief, recon: gathered }
