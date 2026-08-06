# PROVISION.md — Wolffish Mobile Release Procedure

Instructions for an agent **provisioning the next build** of `wolffish-mobile`: check the work, write the app's own release notes, commit it, then hand off to `npm run provision` — which bumps the version and pushes.

**Nothing here publishes.** `provision` creates no tag, and `.github/workflows/release.yml` fires on `v*` tags only, so no user's phone sees any of this. Building, submitting and shipping stay manual and belong to the user.

Follow the steps **in order**. If anything looks wrong, **stop and report** (see [If issues are found](#if-issues-are-found--stop)).

---

## Non-negotiables (read before doing anything)

- **`npm run provision` is the last step and the only script you run.** It is safe because it publishes nothing — but it does bump the version, commit and push, so it runs once, at the end, after everything below is clean.
- **Never run `npm run ota`, `npm run release`, or `npm run rollback`.** Never run `eas` anything. Never create or push a tag. `ota` publishes to every installed device the moment it runs; `release` tags a build as shipped. Both are the user's to run.
- **Never edit the version by hand.** `APP_VERSION`, `CODE_VERSION` and `UPDATE_DATE` in `app.config.ts`, `version` in `package.json` / `package-lock.json`, and the **README version badge** are all written by `provision` itself. You write no version anywhere; you just run the script that does.
- **The changelog is the one thing you author**, and it is **this app's own** changelog — `src/changelog/<YYYY-MM>/en.md` and `ar.md`, bundled into the binary and read by the Changelog screen. It is not the paired desktop's notes, which the app fetches separately over the tunnel and which are none of this repo's business.
- **Nothing is committed until the changelog entries exist.** A user-facing batch that reaches `main` without them ships a version the app cannot describe, and the entry then has to be backfilled against a version that already went out.
- **Both changelog languages, always.** AR is a full translation, not a stub.
- **A new month needs a code change too.** `src/lib/changelog/index.ts` holds a `PAGES` registry of **static** imports — Metro cannot glob a folder, so a new `src/changelog/<YYYY-MM>/` directory that isn't registered there ships as a month the app cannot read.
- **Commit everything before you run it.** `provision` refuses a dirty working tree, and its own commit deliberately carries nothing but the bump — so your work has to already be a commit of its own.
- **Stay on `main`.** No branches.
- **When in doubt, stop.** A halted release costs nothing. Stopping before step 6 costs nothing at all.

---

## Procedure

### 1. Analyze all changes

- Run `git status` and `git diff` (and `git diff --staged`) to see everything pending.
- Review commits since the last tag if work was already committed: `git log $(git describe --tags --abbrev=0)..HEAD --stat`.
- Build a short list of **what actually changed from the user's point of view** — features, fixes, behavior changes. You need it for the changelog anyway.
- **Note whether the batch touches the native surface** — a dependency added or removed, an `app.config.ts` plugin added or reconfigured, an Expo SDK bump, anything under `plugins/` or `ios/`. It doesn't change what you do, but it decides whether the user can ship this over the air or needs a store build, so **put the answer in your final report**.
- If there is **nothing user-facing**, say so — commit and push the work, but add no changelog section.

### 2. Code checks

Run the same three gates step 6 will re-run, so a problem surfaces here rather than halfway through a version bump:

```bash
npx prettier --check "**/*.{js,jsx,ts,tsx}" --ignore-path .gitignore
npx tsc --noEmit
npx jest --silent
```

- **Formatting problems: fix them yourself — don't halt.** Run `npm run format` (or fix by hand), then re-run all three until clean; the fixes ride the release commit. Pre-existing formatting noise in files this batch never touched is left alone (just note it).
- **Code problems: STOP and await instructions.** A failing `tsc --noEmit`, a failing test, obvious breakage, half-finished work, a clear regression, committed secrets — never self-fixed. Go to [If issues are found](#if-issues-are-found--stop).
- There is **no ESLint in this repo.** Prettier plus `tsc` plus jest are the mechanical guards; don't add one as part of a release.
- Do **one** independent review pass over the diff (a reviewer subagent, or `/code-review` at low effort). Look only for: obvious breakage, something half-finished, a clear regression, secrets committed by accident. Smell test, not a full review — don't rabbit-hole.
- **A UI change needs a device check**, not just a green typecheck. Say in your report what you actually exercised.

### 3. The sync gate

The phone is a mirror of a desktop it reaches over an end-to-end encrypted tunnel, and **the connection is the product**. If the diff touches `src/lib/tunnel/`, `src/lib/sync/`, or `src/state/demoConfig.ts`, these checks run before anything else happens. A release that splits the protocol from the desktop is the one failure this app cannot recover from on its own: paired phones stop syncing, and the fix has to travel through the same broken channel.

1. **Wire files are shared with `wolffish-app`.** `protocol.ts` and `noise.ts` are **byte-identical** with `wolffish-app/src/main/tunnel/`; `pairing.ts` and `tunnel.ts` are identical **except for import specifiers** (`@/lib/tunnel/…` here, `./` there) plus two handler generics in `tunnel.ts`. Verify with:
   ```bash
   diff -r src/lib/tunnel ../wolffish-app/src/main/tunnel
   ```
   Anything beyond those known lines is a protocol split. **Stop and report it.**
2. **A new `Rpc` method or `Event` topic is a two-repo change.** The mobile half alone compiles fine and does nothing — the desktop must serve the method or emit the topic, and a `configSet` key must be on the desktop's whitelist. If the desktop half isn't in place, the batch is half-finished: stop.
3. **Both directions still work.** Confirm against a real paired desktop, not by typecheck: pair, background and foreground the app (the socket dies on suspend by design and must re-handshake), and check that an edit made on the phone lands on the desktop and an edit made on the desktop lands on the phone.
4. **Reconnect is idempotent.** `attachLiveUpdates` / `attachTurnStream` re-run on every connection and must replace handlers, not stack them. New push-only state also needs a seed on connect — see `seedOverlays`.

If any of these can't be confirmed, the release isn't ready. Report and stop.

### 4. Write the changelog entries (EN + AR)

Only reach this step if steps 2 and 3 came back clean and the batch has user-facing changes.

1. **Compute the next version:** a patch bump of `APP_VERSION` in `app.config.ts`. If it says `1.0.18`, the release is **`1.0.19`**. You are writing the notes *ahead* of a bump the user's script will make — that is why the version isn't in the file yet.
2. **Pick the changelog folder** by today's date: `src/changelog/<YYYY-MM>/`. New month → create `en.md` and `ar.md`, **and** add the static imports plus a `PAGES` entry in `src/lib/changelog/index.ts`.
3. **Read the last 2–3 existing entries in both files first** and match their house style exactly:
   - Version header — EN: `## v1.0.19 — <YYYY-MM-DD> \`Latest\`` · AR: `## الإصدار 1.0.19 — <YYYY-MM-DD> \`الأحدث\``
   - **Move the `` `Latest` `` / `` `الأحدث` `` marker off the previous top entry** — only the newest carries it.
   - One `### Headline` per notable change, followed by a paragraph of **flowing, benefit-first prose** (not a bullet list of commits), key phrases in **bold**. Written for a user, not a developer.
   - New entry at the **top** of each file.
   - AR is a genuine translation — same headlines, same content, natural Arabic.
4. Use today's real date, and keep EN and AR in lockstep.
5. **If an entry for this version already exists** (an earlier pass wrote one and more work has since landed), append `### Headline` sections to that same block and refresh its header date to today. Never open a second block for one version.

### 5. Commit and push the work

1. **One regular commit** with everything: source changes (including step-2 formatting fixes) + changelog EN/AR + any `PAGES` registration. Concise message summarizing the headline change (e.g. `add: turn rating, conversations sheet`).
2. **Do not touch `app.config.ts` / `package.json` / `package-lock.json` / the README badge.** Step 6 writes all four.
3. Confirm the tree is clean: `git status` shows nothing to commit — `provision` refuses a dirty tree.
4. Push:
   ```bash
   git push origin main
   ```
   Plain push, **no tags**. Nothing publishes.

### 6. Provision

```bash
npm run provision
```

It re-runs the same three gates on the exact tree it is about to bump, then raises `APP_VERSION` by a patch, `CODE_VERSION` by one, and stamps `UPDATE_DATE`; mirrors the version into `package.json` / `package-lock.json` and the README badge; commits that as `provision: vX.Y.Z (build N)`; and pushes it.

**No tag, so nothing publishes.** The release workflow only fires on a `v*` tag, and only `ota` and `release` create one.

Two things to watch:

- **A failing gate here is a hard stop**, not something to work around. It means step 2 was run against a different tree than the one being provisioned — re-read the diff rather than re-running the command.
- **`provision` bumps `CODE_VERSION`, the store build counter.** That is right for a batch heading to the App Store, and wrong for one the user intends to send out over the air — `npm run ota` does its own bump, so provisioning first burns a build number and a version. If step 1 found **no** native-surface change and the user has said they want this as an OTA, **stop before this step**, report that the work is committed and ready, and let them run `npm run ota` themselves.

To provision an explicit version rather than a patch bump: `npm run provision 1.1.0`.

### 7. Report

Tell the user, briefly:

- What's in the release, and the version `provision` created — `vX.Y.Z (build N)`, straight from its output.
- **Whether the batch touched the native surface** — the answer from step 1, because it decides how they ship it.
- Anything you fixed yourself (formatting), and anything you noted but left alone.
- What you actually verified on a device.

Then stop. **Do not build, submit, tag, or publish, and do not offer to.**

---

## What the user does next (reference only — not yours to run)

Provisioning leaves a version that exists in git and nowhere else. Getting it to a phone is theirs:

| | **OTA update** | **Store build** |
|---|---|---|
| Carries | JS, assets, locales | Everything, including native |
| Their command | `npm run ota` | EAS build → submit → `npm run release` once it's live |
| Reaches users | Minutes, no review | After store review |

A native change forks the fingerprint runtime version and can only reach users in a new binary; `npm run ota` checks this itself and refuses to publish an update no installed binary could receive. A bad update is reversible with `npm run rollback`.

`release` records an **empty** marker commit and tags it, so the tag points at exactly the tree that was built — which is why it changes no files and why only the provisioned build that actually shipped ever gets a tag.

All four scripts refuse a dirty working tree — which is why step 5 commits before step 6 runs.

---

## If issues are found — STOP

Applies to any blocker: a failing typecheck or test, a bad or breaking change spotted in step 2, a formatting error that can't be fixed without changing behavior, a protocol split against `wolffish-app`, an unclear diff — anything that means this should not be pushed as-is. (Plain formatting failures are NOT blockers — step 2 has you fix those yourself and continue.)

1. **Stop immediately.** Do not write the changelog, do not commit, do not push, and above all do not run `npm run provision` — a version bumped over a known problem is a version someone has to unpick.
2. **Report the issues minimally** — just *what* they are, briefly. One line each. No fixes applied, no long analysis.
3. **Hand the decision to the user.** Wait for them to decide how to address each issue.
4. Once addressed / approved, **start over from step 1**.

Do not partially release, do not work around a flagged issue, and do not decide on the user's behalf.

---

## Quick reference

| Thing | Where | Edit by hand? |
|---|---|---|
| App version | `app.config.ts` → `APP_VERSION` | **No** — the user's script bumps it |
| Store build counter | `app.config.ts` → `CODE_VERSION` | **No** — `npm run provision` only |
| Update date | `app.config.ts` → `UPDATE_DATE` | **No** — the scripts stamp it |
| npm version mirror | `package.json` → `"version"` | **No** — `provision` writes it |
| Version badge | `README.md` badge line | **No** — `provision` writes it |
| Changelog (English) | `src/changelog/<YYYY-MM>/en.md` | **Yes** — the one thing you author |
| Changelog (Arabic) | `src/changelog/<YYYY-MM>/ar.md` | **Yes** — full translation |
| Month registry | `src/lib/changelog/index.ts` → `PAGES` | **Yes** — only for a new month |

```bash
git status && git diff                                                   # 1. see all changes
npx prettier --check "**/*.{js,jsx,ts,tsx}" --ignore-path .gitignore     # 2. format: self-fix
npx tsc --noEmit && npx jest --silent                                    #    types/tests/code: STOP
diff -r src/lib/tunnel ../wolffish-app/src/main/tunnel                   # 3. sync gate, if relevant
# 4. write src/changelog/<YYYY-MM>/{en,ar}.md   (next = patch bump of APP_VERSION)
#    — required before anything is committed; no versions, no badge
git add -A && git commit -m "<summary>"   # 5. one regular commit, then …
git push origin main                      #    … plain push — no tags, nothing publishes
npm run provision                         # 6. bumps version + build + badge, commits, pushes
```

**One-line summary:** analyze → run the three checks (formatting: fix yourself; types, tests, code: stop) → run the sync gate if the diff touches the tunnel → write this app's own EN+AR changelog for the next version → commit and push the work → `npm run provision` to bump the version and push the bump → report the version it created and whether the batch needs a store build. `provision` publishes nothing; building, submitting, `ota`, `release` and `rollback` stay the user's.
