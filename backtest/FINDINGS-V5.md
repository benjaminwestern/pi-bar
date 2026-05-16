# pi-bar TLDR backtest — v5 close-out (post-0.3.30)

Re-ran all 5 baseline sessions through 0.3.30 (commit c5ed795). Vendored
copy cross-checked. After renaming `Tldr*` → `Progress*` in vendor +
fixing run.ts imports, replay clean.

## Final score card

| Issue | pre-v1 | v1 (0.3.27) | v2 (0.3.28) | v3 (0.3.29) | v4 (0.3.30) |
|---|---|---|---|---|---|
| "with success" suffix | 84 | 0 | 0 | 0 | 0 |
| File-path leak | 56 | 0 | 0 | 0 | 0 |
| Backticks | 12 | 0 | 0 | 0 | 0 |
| Premature `tool_call` fire | 6 | 0 | 0 | 0 | 0 |
| Final past-tense correct | 0/15 | 0/15 | 15/15 | 20/20 | **60/60** |
| Banned-verb first-word | 78 | 9 | 11 | 0 | 0 |
| Trailing dangling prep | 4 | 4 | 0 | 0 | 0 |
| Orphan mid-sentence prep | — | — | ~2 | 0 | 0 |
| Adjective-after-version dangle | — | — | — | 4 | **0** |
| Aborted-final fabrication | yes | no | no | no | no |
| User-msg checkpoint carryover | yes | no | no | no | no |
| "Continuing with task progression" | n/a | n/a | 1 | 0 | 0 |

Scope: 60 final-priority TLDRs across 5 sessions, all past-tense. Spot
checks confirm R6 fix lands cleanly — `Released package with backtest
fixes`, `Updated footer extension for backwards compatibility`,
`Released V3 backtest fixes with two-layer defense` all read naturally.

## Single new cosmetic edge case

`Updating layout with and file details` — model produced
`Updating layout with 0.3.X and file details`; version strip leaves
`with  and`. The R6 release-fragment chain only triggers on
Released/Bumped/Published/Updated + (new/latest/version) sequence. This
case has the bare `with` from a non-release context.

1 hit across 5 sessions. Edge: probably not worth a regex chase. If
desired: extend chain pattern to catch `\bwith\s+and\b` → `and` (risky:
might mangle legitimate "with and without …" English).

## Verdict

Backtest-driven hardening on this corpus is complete. Every structural
regression I found has been fixed. The remaining 1-hit edge case is below
the noise floor.

Next signal source should be real-deployment user reports, not synthetic
replays of the same 5 sessions.

## Harness state

- `backtest/run.ts` — replay scheduler, imports renamed for
  `Progress*` API. Works on 0.3.30 vendored copy.
- `backtest/tldr-logic.ts` — kept filename (no `progress-logic.ts`
  rename) to avoid churning import paths. Internals renamed to match
  source.
- Cross-check command before any future run:
  ```
  diff <(sed -n '/^function checkpointSystemPrompt/,/^}$/p' extensions/status-footer.ts) \
       <(sed -n '/^export function checkpointSystemPrompt/,/^}$/p' backtest/tldr-logic.ts) | wc -l
  ```
  Should be ≤30 lines (signature/comment noise only).
- All five `FINDINGS-V*.md` documents preserved for future reference.
