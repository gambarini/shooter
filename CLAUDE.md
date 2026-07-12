# NEON STRIKE — project guide

Single-file 3D arena wave shooter. All code lives in `index.html` (CSS → HUD markup → one
`<script type="module">` using three.js from the unpkg CDN). No build step, no dependencies,
no tests — verification is playtesting in a browser.

## Run / verify

- `open index.html` works, but pointer lock is more reliable over http:
  `python3 -m http.server 8000` → http://localhost:8000
- Minimum verification after any change: start a run, play 3+ waves, die or restart once,
  play 1 more wave. Watch the FPS counter (Settings → SHOW FPS) during shotgun spam.
- Test both a fresh run AND a restart — most state-leak bugs only show on the second run.

## Roadmap workflow (the progressive loop)

**The roadmap/plan is managed in NOTION, not in this repo.** The Notion page
"NEON STRIKE — Roadmap HQ" is the single source of truth for feature work; `PLAN.md` is
only a stub pointing there. Read AND update the plan via the Notion MCP tools
(`mcp__notion__*`). If the Notion MCP server is not connected, stop and ask the user to
connect it (`/mcp`) — do not fall back to editing PLAN.md.

- HQ page (workflow, conventions, reminders): https://app.notion.com/p/39b2711a768d819cbb8de2a85019926b
- Roadmap database (one row per item, spec in the row's page):
  https://app.notion.com/p/368c46f62b7d45918ce31e9042a9e4c0
  — data source `collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4`
- Session Log database (one entry per session):
  https://app.notion.com/p/112e601ffa444653a30a0b178a3e7315
  — data source `collection://8d944ded-d820-4bde-9cdd-e9b83c5349b6`

Each session does exactly ONE item:

1. **Pick**: query the Roadmap database and take the first `todo` item in phase order
   (`#` order), unless the user names one. Respect dependencies noted on the HQ page
   (item 6 before 7–11).
2. **Claim**: set the item's Status to `wip` in the Roadmap database.
3. **Read first**: the "Codebase conventions" section of the HQ page, the item's row page
   (spec), and the functions named in its "Hook points" before writing any code.
4. **Implement**: stay within the item's scope. If you discover a bug or an improvement
   outside scope, note it in the Session Log entry instead of fixing it now.
5. **Verify**: run the game, exercise every "Done when" criterion of the item, plus the
   minimum verification above.
6. **Close out**:
   - Commit the code: `PLAN item N: <short description>`.
   - Set the item's Status to `done` and fill its Commit property with the short hash.
   - Create a Session Log entry in Notion (format on the HQ page): what landed, tuning
     values chosen, anything the next session should know.

One item = one commit. Don't batch items; the point is each change is playable and
revertable on its own.

## Code rules (summary — full version in the Notion HQ page conventions)

- Pool anything spawned per-hit/per-frame (see `particlePool` / `tracerPool` patterns).
- Everything added to the scene must be cleaned up in `resetGame` and disposed properly
  (see `disposeEnemy`); new per-run state lives on `state` or `mods` and resets there too.
- Audio is synthesized via the `sfx` object (`beep`/`noiseBurst`) — never audio files.
- Keep the neon aesthetic: cyan `#00f0ff`, hot pink `#ff2e88`, emissive glow everywhere.
- New abilities/keys need a touch-control counterpart (see the `#touch` block) or an
  explicit keyboard-only note in the Session Log.
