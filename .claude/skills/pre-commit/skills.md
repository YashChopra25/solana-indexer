---
name: pre-commit
description: The checks that run before every commit in this repo — secret leaks, comment and doc quality, code standard, production readiness, dead code, and whether the tree is in sync with itself. Use whenever the user says to run the pre-commit tasks or checks, or asks for a review before committing or pushing.
---

# Pre-commit tasks

Seven checks, all six of the review ones scoped to **the whole codebase**, not
just the diff. The repository is public and the binary reads exchange API keys,
so the cost of shipping something wrong is not a follow-up commit.

Run the mechanical gate first — a failure there makes the rest moot — then the
six review checks. Report per check, and say plainly which found nothing.

## 0. The mechanical gate

`.githooks/pre-commit` is the committed version of this and runs on real
commits. Reproduce it:

- `bun run check` — typecheck, tests, install test, guard. **Needs node >= 22**;
  the repo's default shell may be on 18, in which case use
  `export PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH` or `nvm use`. On 18,
  `tsc` fails as a stack trace from node's ESM loader that names neither cause
  nor fix.
- `.githooks/scan-staged` reads the **staged** content. With nothing staged it
  exits 0 having checked nothing, so stage into a throwaway index rather than
  the real one:

  ```bash
  IDX=$(mktemp); GIT_INDEX_FILE=$IDX git read-tree HEAD
  GIT_INDEX_FILE=$IDX git add -A
  GIT_INDEX_FILE=$IDX bash .githooks/scan-staged
  ```

## 1. No critical or confidential data, anywhere

Wider than `scan-staged`'s patterns, and over the whole tree rather than the
diff — it is run locally against real accounts and pushed to a public GitHub.
Look for keys and tokens, real wallet addresses, real balances or positions in
fixtures and pasted output, absolute paths naming the developer's machine,
personal email addresses, and internal URLs. A published vendor test vector or a
public contract address is legitimate — allowlist it in
`.githooks/allowed-secrets` rather than deleting it.

## 2. Comments and docs: concise, correct, no beating around the bush

Every comment and every `.md`. Cut anything the code already says. Keep what a
reader cannot derive: a constraint from outside, a rejected alternative, a trap.
A comment describing what the code *used to* do is worse than none — this is
where staleness hides after a fix changes approach. Same standard for
`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `ROADMAP.md`,
`SECURITY.md` and `tasks/`.

## 3. Code of a top standard

All files. Judge against ordinary best practice for the language and the
framework, and against what this repo already does — a file that reads unlike
its neighbours is a defect even when it works.

## 4. Production ready

Error paths as well as happy paths. No debug logging, no commented-out code, no
placeholder or stub left reachable, no `TODO`/`FIXME` standing in for work this
commit claims to have done.

## 5. No dead code

Everything written is reached from somewhere. Modules nobody imports, exports
nobody uses, branches nothing can enter, parameters nobody passes, dependencies
nothing needs. Check the whole tree, not the new files.

## 6. The tree is in sync with itself

Files agree, and agree with the code. A new module is in the AGENTS.md layout
(`guard.sh` enforces that much). Behaviour changes are reflected in `README.md`
and `CHANGELOG.md` — and the CHANGELOG is consumer-facing, so plumbing and
refactors stay out of it. Versions, `.nvmrc`, `package.json` engines and the
workflows say the same thing. `tasks/` status lines match reality; the site
renders them, so a stale one is published.

## Reporting

Do not commit unless asked. Say what each check found, fix what is clearly
wrong, and raise anything that is a judgement call rather than deciding it
alone. Never create a branch for this — work on the branch already checked out.