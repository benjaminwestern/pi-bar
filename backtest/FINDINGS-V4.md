# pi-bar TLDR backtest — v4 (post-0.3.29)

Vendored sync cross-check: 29/7/2 line diffs against `extensions/status-footer.ts`
(all signature/comment noise). Re-ran all 3 baseline sessions live against
0.3.29 logic.

## R1 — Banned first-word verbs: ✅ fully eliminated

Counted across all session traces (TLDR lines only, not Prior TLDR context):

| Banned verb | Hits |
|---|---|
| Verifying | 0 |
| Validating | 0 |
| Checking | 0 |
| Confirming | 0 |
| Searching | 0 |
| Running | 0 |
| Reading | 0 |
| Editing | 0 |
| Publishing | 0 |
| Counting | 0 |
| Capturing | 0 |
| Grep / Listing / Displaying / Finding | 0 |

78 → 9 (v1) → 11 (v2) → **0 (v3)**. Allow-list HARD CONSTRAINTS block +
sanitizer first-word rewrite locked it down. Observable rewrites in traces:
`Running … → Working on …`, `Publishing → Released/Releasing`, `Editing → Updating`.

## R5 — "Continuing with task progression": ✅ fixed

Zero verbatim emissions of the old filler. The replacement template
`Resuming refactor work` is correctly scoped — emitted as a *fresh* TLDR
only on truly opaque user messages:

| Session | Opaque user msg → TLDR |
|---|---|
| 2026-05-14 | `yes` → Resuming refactor work |
| 2026-05-14 | `yes` → Resuming refactor work |
| 2026-05-15T02-57 | `do it` → Resuming refactor work |
| 2026-05-15T02-57 | `let's do it` → Resuming refactor work |

4/4 are genuine "continue" messages. (Earlier grep -c counts were inflated
by Prior-TLDR context echoes in subsequent same-turn prompts.) Template
does not overreach.

## R2 / R3: ✅ stable

- Final past-tense: **20/20 correct** across 3 sessions (was 15/15 in v2).
- Trailing dangling preposition: 0 hits.
- Orphan mid-sentence preposition (`Reviewing for X`): 0 hits.

## Residual

### R6 — Mid-sentence adjective dangling after version strip
After `stripIdentifierLeaks` removes a version token, an adjective like
`new`/`latest`/`version` can remain stranded with no noun:

| Sanitized TLDR | Original (inferred) |
|---|---|
| `Released latest of package` | `Released latest 0.3.X of package` |
| `Released new with global status visibility persistence` | `Released new 0.3.X with …` |
| `Updated footer behavior and published new` | `… published new 0.3.X` |
| `Reverted changes and published new` | `Reverted … published new 0.3.X` |

4 hits across 3 sessions. Cosmetic but noticeable.

**Fix candidate:** in the trailing-prep fix-point loop, additionally drop
trailing/stranded adjectival fragments after release verbs:
```ts
const TRAILING_RELEASE_FRAGMENT =
  /\s+(?:new|latest|version|update)\s*(?:of|with|to|and|in|on)?\s*[.!?,;:]?\s*$/i;
```
plus an inside-sentence variant where `(new|latest)` followed by `(of|with|
to)` and a noun-phrase is collapsed to just the noun-phrase. Conservative:
trim only when these tokens *immediately precede* a known structural prep
or end of string.

### Known/deferred
- **R4** burst-repeat generation-side dedupe — still deferred.
- Truncated function-name leak: one instance `Implementing stripS function
  for text sanitization` (sed left `s/old/new/` so `stripS` is a real string
  in the session, not a model fabrication). Hard to prevent without parsing.
- Slight phrasing tweaks from first-word rewrites (`Running quick test for X`
  → `Working on quick test on X`). Acceptable.

## Score card (cumulative)

| Issue | pre-v1 | v1 (0.3.27) | v2 (0.3.28) | v3 (0.3.29) |
|---|---|---|---|---|
| "with success" suffix | 84 | 0 | 0 | 0 |
| File-path leak | 56 | 0 | 0 | 0 |
| Backticks | 12 | 0 | 0 | 0 |
| Premature tool_call fire | 6 | 0 | 0 | 0 |
| Final past-tense correct | 0/15 | 0/15 | 15/15 | 20/20 |
| Banned-verb first-word | 78 | 9 | 11 | **0** |
| Trailing dangling prep | 4 | 4 | 0 | 0 |
| Orphan mid-sentence prep | — | — | ~2 | 0 |
| Adjective-after-version dangle | — | — | — | 4 |
| Aborted/error final fabrication | yes | no | no | no |
| User-msg checkpoint carryover | yes | no | no | no |
| "Continuing with task progression" | n/a | n/a | 1 | 0 |

## Verdict

pi-bar TLDR quality has reached the point where backtest-driven regressions
are minor cosmetics. The 0.3.29 cycle closed the dominant production
issues. R6 (adjective dangling) is the only structural regression with a
clean fix; everything else is "model phrasing taste" territory which
prompt + sanitizer can chase indefinitely.

Recommendation: ship R6, then declare this round of backtest-driven
hardening complete and switch to user-reported regressions from real
deployments.
