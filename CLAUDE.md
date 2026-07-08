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

`PLAN.md` is the single source of truth for feature work. Each session does exactly ONE item:

1. **Pick**: take the first `[ ]` item in phase order, unless the user names one.
   Respect dependencies noted in PLAN.md (item 6 before 7–11).
2. **Claim**: mark it `[~]` in PLAN.md.
3. **Read first**: the "Codebase conventions" section of PLAN.md, the item's spec, and the
   functions named in its "Hook points" before writing any code.
4. **Implement**: stay within the item's scope. If you discover a bug or an improvement
   outside scope, add a note to the Session Log in PLAN.md instead of fixing it now.
5. **Verify**: run the game, exercise every "Done when" criterion of the item, plus the
   minimum verification above.
6. **Close out**:
   - Mark the item `[x]`.
   - Append a Session Log entry in PLAN.md (see format there): what landed, tuning values
     chosen, anything the next session should know.
   - Commit code + PLAN.md together: `PLAN item N: <short description>`.

One item = one commit. Don't batch items; the point is each change is playable and
revertable on its own.

## Code rules (summary — full version in PLAN.md conventions)

- Pool anything spawned per-hit/per-frame (see `particlePool` / `tracerPool` patterns).
- Everything added to the scene must be cleaned up in `resetGame` and disposed properly
  (see `disposeEnemy`); new per-run state lives on `state` or `mods` and resets there too.
- Audio is synthesized via the `sfx` object (`beep`/`noiseBurst`) — never audio files.
- Keep the neon aesthetic: cyan `#00f0ff`, hot pink `#ff2e88`, emissive glow everywhere.
- New abilities/keys need a touch-control counterpart (see the `#touch` block) or an
  explicit keyboard-only note in the Session Log.
