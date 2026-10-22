---
name: claude-desktop-profile-switch
description: Windows 上的 Claude Desktop 在第三方 provider（公司网关、Bedrock、Vertex、自定义 API）和 claude.ai 登录之间切换后（哪个方向都算），侧边栏的 Code 会话不见了，或者会话报「Git isn't working: this session's branch is checked out somewhere else in this repository」时使用。先只读排查，再备份，绝不删会话正文和分支。
---

# Claude Desktop：切换登录后会话不见了 / worktree 冲突

这是两个经常同时出现、但互不相干的问题，先判断是哪一个：

| 现象 | 问题 | 看哪一节 |
|---|---|---|
| 切换登录后侧边栏的会话不见了 | 两套 profile | 问题一 |
| 打开会话报「Git isn't working … branch is checked out somewhere else」 | 三处 worktree 记录对不上 | 问题二 |

## 规矩（按这个顺序）

1、**往 Desktop 的 profile 里写东西之前，Desktop 必须完全退出**：从托盘图标退出，只关窗口不算。它把会话列表缓存在内存里，运行时还会不断改写自己的 profile，这时写进去的文件，退出时会被盖掉（「改了没生效」）。
**你自己可能就跑在 Claude Desktop 里**。那样你没法退出它而不结束自己。先做完所有只读步骤，再把要写的步骤做成 PowerShell 脚本交给用户，等他退出 Desktop 后运行；或者请他改在终端里用 Claude Code CLI 来跑你。

2、**每次写之前都先备份**。会话记录几百 KB，一个 worktree 一百来 KB，备份很便宜，丢了很贵。整个文件夹拷（`cp -r <目录>/. <备份>/`），别只拷 `*.json`，那会漏掉 `archived-sessions.idx`。备份放 `~/.claude/backups/`，别放桌面（用户会当垃圾清掉）。

3、**删之前先看清楚**。绝不删 `.jsonl` 正文、`claude/*` 分支，也不删 profile 文件夹里的东西。worktree 只有在问题二的检查清单全部通过后才能删。

4、每一步要写文件之前，先把查到的情况告诉用户。绝不覆盖目标 profile 里已有的文件。

5、**会话记录的字段名会随 Desktop 版本变**。跑任何读会话记录的命令之前，先打出一条记录的字段名，按实际情况改命令。

## 问题一：侧边栏的会话不见了

### 事实

Desktop 按登录方式选 Electron 的 userData 目录：

| 登录方式 | userData 目录 |
|---|---|
| 第三方或自定义 provider（网关、Bedrock、Vertex……） | `%LOCALAPPDATA%\Claude-3p` |
| 官方账号（claude.ai） | `%APPDATA%\Claude` |

设了 `CLAUDE_USER_DATA_DIR` 的话，以它为准。

**微软商店装的版本有一层重定向（MSIX）**。Desktop 往 `%APPDATA%` 里写的东西，会被 Windows 重定向到 `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude`。在程序自己看来路径还是 `%APPDATA%\Claude`，用户在资源管理器或普通终端里打开却什么都没有。先确认是哪种安装：`Get-AppxPackage *Claude*` 有结果是商店版；`%LOCALAPPDATA%\AnthropicClaude\` 存在是官网安装包版，没有这层重定向。商店版下，第三方模式的目录在真实的 `%LOCALAPPDATA%\Claude-3p` 能看到。

**如果你自己就跑在商店版 Claude Desktop 里，你的 shell 看到的也是重定向后的视图**：`%APPDATA%\Claude` 对你是通的，你往 `%APPDATA%` 下写的文件会落进包目录，用户看不见。交给用户在他自己终端里跑的脚本，必须写真实的 `Packages\…\LocalCache\Roaming\…` 路径；核对也要在用户那边做，不能靠你自己读回来。

侧边栏就是各自 profile 里的 `claude-code-sessions` 文件夹：

```
<userData>\claude-code-sessions\<账号ID>\<组织ID>\
    local_<会话ID>.json      一个会话一个：标题、cwd、分支、模型、权限模式、cliSessionId
    archived-sessions.idx    已归档会话的清单
    deleted_<会话ID>         删除墓碑，内容是一个毫秒时间戳
```

两种模式的 `<账号ID>\<组织ID>` 不同。第三方模式的组织 ID 固定是 `00000000-0000-4000-8000-000000000001`，官方账号用真实的账号和组织 ID。这就是两边互相看不到的原因。

会话正文不在任何一套 profile 里，在 `%USERPROFILE%\.claude\projects\<编码后的项目路径>\<cliSessionId>.jsonl`，两边共用。什么都没丢，只是侧边栏的索引在另一套 profile 里。

**两个方向的做法完全一样**。来源 = 有这条会话的那套 profile，目标 = 用户现在登录的那套。网关 → 官方和官方 → 网关是同一套步骤，只是来源和目标对调。

### 第 0 步：先确认是这个问题

先确认三件事：`.jsonl` 正文都在；两套 profile 文件夹都在；来源那边 `local_*.json` 多、目标那边少，而且时间和切换登录的时刻对得上。对不上就是别的问题，停下来。

解决办法就是把侧边栏记录（`local_*.json`）从来源 profile 同步到目标 profile，步骤如下。

### 第 1 步：盘点（只读）

把两套 profile 里每个 `claude-code-sessions\<账号ID>\<组织ID>` 文件夹和其中 `local_*.json` 的数量列出来，例如：

```bash
python -c "import os,glob;[print(p,len(glob.glob(os.path.join(p,'local_*.json')))) for b in [os.environ['LOCALAPPDATA']+r'\Claude-3p',os.environ['APPDATA']+r'\Claude'] for p in glob.glob(b+r'\claude-code-sessions\*\*')]"
```

按文件名求差集。对来源里的每个候选，列出 `title`、`cwd`、最近活动时间和 `cliSessionId`，让用户确认就是要找回的那些。

### 第 2 步：选目标文件夹

在目标 profile 里，目标是装着最近修改过的 `local_*.json` 的那个 `<账号ID>\<组织ID>` 文件夹（即当前登录的账号）。还不存在的话（这个登录下还没开过 Code 会话），请用户先随便开一个 Code 会话。有好几个看起来都是当前的，就问用户，不要猜。

### 第 3 步：逐个审核候选

以下几条全部满足才复制：

| 检查项 | 为什么 |
|---|---|
| 存在正文 `%USERPROFILE%\.claude\projects\*\<cliSessionId>.jsonl` | 否则点开是空的 |
| `cwd` 不在某个 profile 文件夹里面（比如 `%APPDATA%\Claude\scratch-workspaces\…`） | 临时工作区属于另一套 profile，拷过去没意义，跳过 |
| 目标文件夹里没有 `deleted_<会话ID>` 墓碑 | 说明用户在那边删过它，要复活先问用户（有墓碑时复制可能不生效） |
| 记录里不含来源的账号 ID 和组织 ID | 不含就能原样复制。可以这样查：`python -c "import sys;d=open(sys.argv[1],encoding='utf-8').read();[print(t,t in d) for t in sys.argv[2:]]" <文件> <账号ID前缀> <组织ID前缀> scratch-workspaces` |

**分叉的会话**：同一个 `local_<会话ID>.json` 两边都有、而且内容不同（两边各自用过，轮数或 `cwd` 不一样），**哪一份都不要覆盖**，把两份的情况报告给用户，让他决定。

### 第 4 步：备份，然后复制（Desktop 已退出）

把目标的 `claude-code-sessions` 备份一份（比如放到 `~/.claude/backups/sessions-<时间戳>`），核对文件数。确认没有 `Claude.exe` 在运行。逐个复制审核通过的文件，不覆盖：

```bash
cp -n "<来源>/claude-code-sessions/<账号ID>/<组织ID>/local_<id>.json" "<目标>/claude-code-sessions/<账号ID>/<组织ID>/"
```

不复制 `deleted_*`。`archived-sessions.idx` **只在目标没有时才复制**；目标已经有了就绝不覆盖，用户要求时才手工合并两边的列表。它是状态不是数据：原作者那次，官方那边的清单里有 2 条，网关那边有 15 条，覆盖过去会平白把 13 条会话归档掉。

### 第 5 步：验收

核对 md5 和来源一致、JSON 能解析：

```bash
md5sum "<来源>/local_<id>.json" "<目标>/local_<id>.json"
python -c "import json,sys;j=json.load(open(sys.argv[1],encoding='utf-8'));print(j['title'],j['cwd'])" "<目标>/local_<id>.json"
```

然后打开 Desktop 看侧边栏，数一下条数。被归档的会话在 Archived 里，不在主列表。运行中能不能热加载没有验证过，按必须重启处理。找回的会话如果报「checked out somewhere else」，转到问题二。

**回滚**：退出 Desktop，用备份还原目标的 `claude-code-sessions`。

**告诉用户：搬一次是快照，不是同步**。搬完之后两套 profile 各自往前走，同一条会话在两边都用就会分叉（原作者那次：一边 47 轮，一边 31 轮，指向不同的 worktree），分叉了合不回去。别在两边交替用同一条会话。

## 问题二：「this session's branch is checked out somewhere else in this repository」

### 事实

每个 Code 会话有一个 worktree，在 `<仓库>/.claude/worktrees/<名字>`，分支是 `claude/<名字>`。git 不允许一个分支同时被两个 worktree 检出。「哪个会话用哪个目录、哪个分支」记在**三个互相独立的地方**：

| 记录 | 位置 | 记的是什么 |
|---|---|---|
| git | `<仓库>/.git/worktrees/` | 哪个目录检出了哪个分支 |
| Desktop 的 worktree 注册表 | `<userData>\git-worktrees.json` | Desktop 认为有哪些 worktree、分别租给了哪个会话 |
| 会话记录 | `local_<会话ID>.json` | 这个会话要用哪个目录、哪个分支 |

**会话记录里写的目录不存在，而它要的分支正被别的目录检出着，就会报这个错**。Desktop 想重建 worktree，git 拒绝。目录还在的话 Desktop 直接用，不会冲突。常见起因：有人手动给 worktree 目录改了名或删了，会话记录还指着旧名字。

`<userData>\logs\main.log` 里会每隔几十秒重复这两行：

```
[error] the session's branch is checked out in a folder that exists; not recreating its worktree
[error] [CCD] Failed to warm session local_<会话ID>: Git is installed but isn't working: ...
```

### 第 1 步：三处都看（只读）

```bash
git worktree list --porcelain
python -c "import json,os;j=json.load(open(os.environ['APPDATA']+r'\Claude\git-worktrees.json',encoding='utf-8'));[print(n,'exists=',os.path.isdir(w['path']),w.get('branch')) for n,w in j.get('worktrees',{}).items()]"
python -c "import json,sys;print(sorted(json.load(open(sys.argv[1],encoding='utf-8')).keys()))" "<local_*.json>"
```

（第三方模式把路径换成 `%LOCALAPPDATA%\Claude-3p`。）会话记录里已知的字段名：

| Desktop 版本 | worktree 目录 | 分支 |
|---|---|---|
| 2.2553.1（2026-09） | `worktreePath` + `worktreeName` | `branch` |
| 2.37337.1（2026-10） | `cwd`（`originCwd` 是主仓库） | `branch` + `writtenBranches` |

三处对一下，找出矛盾，告诉用户。

### 第 2 步：删 worktree 前的安全检查

一般的解法是删掉占着分支的那个 worktree。五项全部跑一遍，结果全部为空或为 0 才能删：

```bash
WT=".claude/worktrees/<名字>"
git -C "$WT" status --porcelain=v1 --ignored   # 改过的、未跟踪的、被忽略的
git -C "$WT" stash list                        # stash
git rev-list --count main.."<分支>"             # 不在 main 上的提交
git -C "$WT" reflog -5                         # 本地提交痕迹
git worktree list --porcelain                  # 有没有 lock
```

被忽略的构建产物（`__pycache__/`、`settings.local.json`）不影响删除，但要一起备份。有真实改动、stash、说不清来历的独有提交或者 lock，停下来问用户。

如果 `git -C "$WT" status` 列出的全是 `../../` 开头的路径，说明这个 worktree 的 `.git` 链接坏了，git 退回到了主仓库，列出来的是主目录的文件，不是 worktree 里的改动。

### 第 3 步：删除

```bash
cd <仓库>
cp -r .claude/worktrees/<名字>/. ~/.claude/backups/worktree-<名字>-$(date +%Y%m%d-%H%M%S)/
git worktree remove .claude/worktrees/<名字>
git worktree prune -v
```

| 报错 | 原因 | 处理 |
|---|---|---|
| `is not a working tree` | `prune` 已经清掉了注册记录 | 跳过，直接删目录 |
| `Device or resource busy` | 目录被进程占着（Desktop、IDE、残留的 node / java） | 关掉再试 |

`git worktree remove` 和 `prune` **都不会**删除 `claude/*` 分支和上面的提交。

### 第 4 步：验收，接上会话

```bash
git worktree list
ls -la .claude/worktrees/
git branch --format='%(refname:short) [%(worktreepath)]' --list 'claude/*'
```

最后一条才是真正的判据：方括号里为空，说明已经没有 worktree 占着这个分支。

告诉用户在 Desktop 里打开那个会话、发一条消息（比如「继续」），Desktop 会在该在的位置重建 worktree。**Desktop 不会自己重试**，只在会话被打开或收到消息时才处理，所以修好后日志安静，不代表失败。

## 收尾汇报

给用户一段总结：方向（来源 → 目标）、复制了哪些、跳过了哪些以及原因、留给他决定的分叉会话、备份位置、删了哪些 worktree，以及三处记录里仍然对不上的地方（那是以后的冲突隐患，比如两个会话的 `cwd` 指向同一个目录、却各写了不同的分支）。
