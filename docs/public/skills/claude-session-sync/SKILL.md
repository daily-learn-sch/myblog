---
name: claude-desktop-profile-switch
description: Use on Windows when Claude Desktop's Code sessions vanished from the sidebar after switching between a third-party provider (company gateway, Bedrock, Vertex, custom API) and a claude.ai login — in either direction — or when a session fails with "Git isn't working: this session's branch is checked out somewhere else in this repository". Inspects read-only first, backs up, never deletes transcripts or branches.
---

# Claude Desktop: sessions missing / worktree conflict after switching login

Two unrelated problems that often show up together. Decide which one you are facing first:

| Symptom | Problem | Section |
|---|---|---|
| Sessions missing from the sidebar after switching login | Two profiles | Problem 1 |
| Opening a session: "Git isn't working … branch is checked out somewhere else" | Three worktree records disagree | Problem 2 |

## Ground rules (in this order)

1. **Claude Desktop must be fully quit before you write to its profile** — quit from the tray icon, closing the window is not enough. It caches the session list in memory and keeps rewriting its own profile while running; files written then are overwritten on exit ("I changed it but nothing happened").
   **You may be running inside Claude Desktop yourself.** Then you cannot quit it without ending yourself. Do every read-only step, then hand the write steps to the user as a PowerShell script to run after they quit Desktop — or ask them to run you from a terminal with the Claude Code CLI.
2. **Back up before every write.** Session records are a few hundred KB; a worktree is around a hundred KB. Copy whole folders (`cp -r <dir>/. <backup>/`), not `*.json` — that misses `archived-sessions.idx`. Put backups under `~/.claude/backups/`, never on the Desktop (users clean it up).
3. **Look before deleting.** Never delete `.jsonl` transcripts, `claude/*` branches, or anything in a profile folder. Worktrees only after the checklist in Problem 2 passes.
4. Tell the user what you found before each step that writes. Never overwrite an existing file in the target profile.
5. **Field names change between Desktop versions.** Before running any command that reads a session record, print one record's keys and adapt.

## Problem 1: sessions missing from the sidebar

### Facts

Desktop picks its Electron userData directory by sign-in type:

| Sign-in | userData directory |
|---|---|
| Third-party / custom provider (gateway, Bedrock, Vertex, …) | `%LOCALAPPDATA%\Claude-3p` |
| First-party (claude.ai) | `%APPDATA%\Claude` |

`CLAUDE_USER_DATA_DIR`, if set, overrides both.

**Microsoft Store installs are virtualized (MSIX).** Desktop's writes to `%APPDATA%` are redirected by Windows to `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude`. Inside the app the path still reads `%APPDATA%\Claude`, but File Explorer and an ordinary terminal see nothing there. Check which install it is first: `Get-AppxPackage *Claude*` (Store) vs `%LOCALAPPDATA%\AnthropicClaude\` (installer from the website, no redirection). On the Store build the third-party profile was seen at the real `%LOCALAPPDATA%\Claude-3p`.

**If you are running inside the Store build of Claude Desktop, your own shell sees the redirected view** — `%APPDATA%\Claude` works for you, and files you write under `%APPDATA%` land in the package folder, invisible to the user. Any script you hand to the user to run in their own terminal must use the real `Packages\…\LocalCache\Roaming\…` path, and verification must be done from the user's side, not by reading the files back yourself.

The sidebar is each profile's own `claude-code-sessions` folder:

```
<userData>\claude-code-sessions\<accountId>\<orgId>\
    local_<sessionId>.json    one per session: title, cwd, branch, model, permission mode, cliSessionId
    archived-sessions.idx     list of archived sessions
    deleted_<sessionId>       deletion tombstone; content is a millisecond timestamp
```

The `<accountId>\<orgId>` pair differs between the two modes. Third-party mode uses the fixed org id `00000000-0000-4000-8000-000000000001`; first-party uses the real account and org ids. That is why each mode cannot see the other's sessions.

Transcripts are not in either profile: `%USERPROFILE%\.claude\projects\<encoded project path>\<cliSessionId>.jsonl`, shared by both. Nothing is lost — only the sidebar index lives in the other profile.

**The fix works in both directions.** Source = the profile that has the session, target = the profile the user is signed into now. Gateway → claude.ai and claude.ai → gateway are the same procedure with source and target swapped.

### Step 0 — confirm it is this problem

Confirm before anything else: the `.jsonl` transcripts exist; both profile folders exist; the source has many `local_*.json` and the target few, with timestamps that match the moment of the switch. If that does not hold, this is a different problem — stop.

The fix is to sync the sidebar records (`local_*.json`) from the source profile into the target profile, as below.

### Step 1 — inventory (read-only)

List every `claude-code-sessions\<accountId>\<orgId>` folder in both profiles with its count of `local_*.json`, e.g.:

```bash
python -c "import os,glob;[print(p,len(glob.glob(os.path.join(p,'local_*.json')))) for b in [os.environ['LOCALAPPDATA']+r'\Claude-3p',os.environ['APPDATA']+r'\Claude'] for p in glob.glob(b+r'\claude-code-sessions\*\*')]"
```

Compute the set difference by file name. For each candidate in the source, print `title`, `cwd`, last activity, and `cliSessionId` so the user can confirm these are the ones they want.

### Step 2 — pick the target folder

In the target profile, the target is the `<accountId>\<orgId>` folder holding the most recently modified `local_*.json` (the account signed in now). If it does not exist yet (no Code session opened under this login), ask the user to open one throwaway Code session first. If several look current, ask; do not guess.

### Step 3 — vet each candidate

Copy a candidate only if all of these hold:

| Check | Why |
|---|---|
| A transcript `%USERPROFILE%\.claude\projects\*\<cliSessionId>.jsonl` exists | Otherwise it opens empty |
| Its `cwd` is not inside a profile folder (e.g. `%APPDATA%\Claude\scratch-workspaces\…`) | Scratch workspaces belong to the other profile; copying them is pointless — skip |
| The target folder has no `deleted_<sessionId>` tombstone | The user deleted it there; ask before resurrecting (the copy may not take effect while the tombstone exists) |
| The record does not contain the source's account id or org id | Then it can be copied verbatim. Check it, e.g. `python -c "import sys;d=open(sys.argv[1],encoding='utf-8').read();[print(t,t in d) for t in sys.argv[2:]]" <file> <acct-prefix> <org-prefix> scratch-workspaces` |

**Forked sessions:** if the same `local_<sessionId>.json` exists in both profiles and they differ (both were used independently — different turn counts or `cwd`), do **not** overwrite either. Report both to the user and let them decide.

### Step 4 — back up, then copy (Desktop quit)

Back up the target `claude-code-sessions` folder (e.g. to `~/.claude/backups/sessions-<timestamp>`) and confirm the file count. Confirm no `Claude.exe` is running. Copy each vetted file without overwriting:

```bash
cp -n "<source>/claude-code-sessions/<acct>/<org>/local_<id>.json" "<target>/claude-code-sessions/<acct>/<org>/"
```

Do not copy `deleted_*`. Copy `archived-sessions.idx` **only if the target has none**; if it exists, never overwrite it — merge the two lists by hand only if the user asks. It is state, not data: in the original case the claude.ai side listed 2 archived sessions and the gateway side 15, so overwriting would have silently archived 13 sessions.

### Step 5 — verify

Check md5 matches the source and the JSON parses:

```bash
md5sum "<source>/local_<id>.json" "<target>/local_<id>.json"
python -c "import json,sys;j=json.load(open(sys.argv[1],encoding='utf-8'));print(j['title'],j['cwd'])" "<target>/local_<id>.json"
```

Then start Desktop and check the sidebar; count the records. Archived sessions appear under Archived, not in the main list. Hot-reload while running is unverified — assume a restart is required. If a restored session reports the "checked out somewhere else" error, go to Problem 2.

**Rollback:** quit Desktop, restore the backed-up `claude-code-sessions`.

**Tell the user: this is a one-time snapshot, not a sync.** After copying, both profiles move on independently. Using the same session in both profiles forks it (in the original case: 47 turns on one side, 31 on the other, different worktrees) and the forks cannot be merged. Don't alternate between profiles on the same session.

## Problem 2: "this session's branch is checked out somewhere else in this repository"

### Facts

Each Code session gets a worktree at `<repo>/.claude/worktrees/<name>` with branch `claude/<name>`. Git forbids one branch checked out in two worktrees. Which session uses which folder and branch is recorded in **three independent places**:

| Record | Location | Holds |
|---|---|---|
| git | `<repo>/.git/worktrees/` | which folder has which branch checked out |
| Desktop's worktree registry | `<userData>\git-worktrees.json` | worktrees Desktop believes exist and which session leases them |
| Session record | `local_<sessionId>.json` | the folder and branch this session expects |

**The error happens when the folder in the session record does not exist and the branch it wants is checked out by another folder.** Desktop then tries to recreate the worktree and git refuses. If the folder exists, Desktop just uses it and there is no conflict. A typical cause: someone renamed or deleted a worktree folder by hand, so the session record still points at the old name.

`<userData>\logs\main.log` shows the same pair repeating every few tens of seconds:

```
[error] the session's branch is checked out in a folder that exists; not recreating its worktree
[error] [CCD] Failed to warm session local_<sessionId>: Git is installed but isn't working: ...
```

### Step 1 — diagnose all three (read-only)

```bash
git worktree list --porcelain
python -c "import json,os;j=json.load(open(os.environ['APPDATA']+r'\Claude\git-worktrees.json',encoding='utf-8'));[print(n,'exists=',os.path.isdir(w['path']),w.get('branch')) for n,w in j.get('worktrees',{}).items()]"
python -c "import json,sys;print(sorted(json.load(open(sys.argv[1],encoding='utf-8')).keys()))" "<local_*.json>"
```

(Use `%LOCALAPPDATA%\Claude-3p` for third-party mode.) Known field names in session records:

| Desktop version | Worktree folder | Branch |
|---|---|---|
| 2.2553.1 (2026-09) | `worktreePath` + `worktreeName` | `branch` |
| 2.37337.1 (2026-10) | `cwd` (`originCwd` = main repo) | `branch` + `writtenBranches` |

Line the three up and find the contradiction. Show it to the user.

### Step 2 — safety checklist before removing a worktree

Usually the fix is to remove the worktree that holds the branch. Run all five; every result must be empty / zero:

```bash
WT=".claude/worktrees/<name>"
git -C "$WT" status --porcelain=v1 --ignored   # tracked changes, untracked, ignored
git -C "$WT" stash list                        # stashes
git rev-list --count main.."<branch>"          # commits not on main
git -C "$WT" reflog -5                         # local commits
git worktree list --porcelain                  # locked?
```

Ignored build artifacts (`__pycache__/`, `settings.local.json`) do not block removal, but back them up with the rest. If there are real changes, stashes, unique commits you cannot account for, or a lock — stop and ask the user.

If `git -C "$WT" status` lists only paths starting with `../../`, the worktree's `.git` link is broken and git fell back to the main repo: those are the main folder's files, not changes in the worktree.

### Step 3 — remove

```bash
cd <repo>
cp -r .claude/worktrees/<name>/. ~/.claude/backups/worktree-<name>-$(date +%Y%m%d-%H%M%S)/
git worktree remove .claude/worktrees/<name>
git worktree prune -v
```

| Error | Cause | Action |
|---|---|---|
| `is not a working tree` | `prune` already dropped the registration | Skip; delete the folder directly |
| `Device or resource busy` | A process holds the folder (Desktop, an IDE, leftover node / java) | Have it closed, retry |

`git worktree remove` and `prune` do **not** delete the `claude/*` branch or its commits.

### Step 4 — verify and resume

```bash
git worktree list
ls -la .claude/worktrees/
git branch --format='%(refname:short) [%(worktreepath)]' --list 'claude/*'
```

The last command is the real check: empty brackets mean no worktree holds that branch any more.

Tell the user to open the session in Desktop and send a message (e.g. "continue"); Desktop recreates the worktree at the expected path. **Desktop does not retry on its own** — it only acts when the session is opened or receives a message, so a quiet log after the fix does not mean it failed.

## Report back

Summarize for the user: direction (source → target), sessions copied / skipped and why, forked sessions left for them, backup locations, worktrees removed, and any record that still disagrees across the three sources (that is a future conflict waiting to happen — e.g. two sessions whose `cwd` is the same folder but name different branches).
