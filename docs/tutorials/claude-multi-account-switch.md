# Claude 多账号切换且不丢会话（Claude Desktop / Claude Code，Mac / Windows）

> 适用场景：一个 Claude 账号额度快用完，想切到第二个账号接着干活，而且不想丢掉之前的会话。
>
> ✅ **状态：已解决（2026-10-22）。** Claude Desktop 切号后侧边栏会话「消失」的问题，参考同事的文章 [Claude 会话同步（detached.online）](https://detached.online/blog/claude-desktop%E5%88%87%E6%8D%A2%E8%B4%A6%E5%8F%B7%E5%90%8E%E4%BC%9A%E8%AF%9D%E6%B6%88%E5%A4%B1/) 已实测解决。下面第 1 节是核心原理，第 6 节是 Desktop 切号后找回会话的步骤；第 2、3 节是命令行 `claude` 的双账号配置。

## 1. 原理：正文是共用的，丢的只是侧边栏索引

一条 Code 会话的数据分在几个地方：

| 部分 | 位置 | 是否按账号分开 |
|---|---|---|
| 会话正文 | `~/.claude/projects/<项目路径>/*.jsonl` | **不分**，所有账号、所有登录方式共用 |
| 侧边栏记录（索引） | `<数据目录>/claude-code-sessions/<账号ID>/<组织ID>/local_<会话ID>.json` | **按账号分开** |
| 归档清单 | 同一文件夹下的 `archived-sessions.idx` | 按账号 |
| 删除标记 | 同一文件夹下的 `deleted_<会话ID>` | 按账号 |
| worktree 注册表 | `<数据目录>/git-worktrees.json` | — |

所以：

- **换号后聊过的内容一条都没丢**，只是 Desktop 去读另一个账号的文件夹，侧边栏就空了。
- `local_*.json` 里**不含账号 ID 和组织 ID**，身份只体现在它放在哪个文件夹。原样复制到新账号的文件夹，Desktop 就认。
- 复制是**一次性快照**，不是同步。之后两边各聊各的，同一条会话会分叉。

命令行 `claude` 这边：会话同样在 `~/.claude/projects/`，按项目目录划分。用 `CLAUDE_CONFIG_DIR` 给第二个号一个独立配置目录，再把 `projects`、`skills` 等链接回主目录，两个号就能在同一个项目目录下启动、用同一套 skill、`--resume` 接着之前的会话（第 2、3 节）。**不要共享 `.claude.json`**，登录信息在里面。

```
~/.claude/            ← 主号（原样不动）
  projects/  history.jsonl  settings.json  skills/  plugins/
~/.claude-acc2/       ← 第二个号（独立登录）
  projects  -> ~/.claude/projects
  ...（其余同理）
```

## 2. Windows 步骤（cmd，不要用 PowerShell）

### 2.1 先备份

```bat
xcopy /E /I /H "%USERPROFILE%\.claude" "%USERPROFILE%\.claude.bak"
copy "%USERPROFILE%\.claude.json" "%USERPROFILE%\.claude.json.bak"
```

### 2.2 建第二个号的目录，登录并验证（关键验证步骤）

```bat
mkdir "%USERPROFILE%\.claude-acc2"
set CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-acc2
claude
```

进去后先 `/login` 登第二个号，再用 `/status` 确认显示的是第二个号，然后退出。重新打开一个新窗口，用平时的启动方式（如 `cct`）再 `/status` 一次，应该仍是主号。两边都对，说明两个号的登录是分开保存的，可以继续。

### 2.3 让两个号共用会话和设置

```bat
cd /d "%USERPROFILE%\.claude-acc2"
rmdir /S /Q projects 2>nul
mklink /J projects "%USERPROFILE%\.claude\projects"
mklink /J skills "%USERPROFILE%\.claude\skills"
mklink /J plugins "%USERPROFILE%\.claude\plugins"
mklink /H history.jsonl "%USERPROFILE%\.claude\history.jsonl"
mklink /H settings.json "%USERPROFILE%\.claude\settings.json"
```

- 提示"已存在"的文件，先 `del` 掉再建。
- 主目录里本来就没有的文件夹/文件，跳过即可。
- `mklink /J` 是目录联接（junction），`mklink /H` 是文件硬链接，都不需要管理员权限。

### 2.4 做第二个号的启动命令

把 `cct.cmd` 复制一份，命名为 `cct2.cmd`，在 `claude ...` 那一行**前面**加一行：

```bat
set CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-acc2
```

如果有桌面快捷方式，复制一个，改名（如加个 "2"），目标改为指向 `cct2.cmd`。

### 2.5 用法

| 命令 | 作用 |
|---|---|
| `cct` | 主号 |
| `cct2` | 第二个号 |
| `cct2 --resume` | 用第二个号接着之前的会话 |

## 3. Mac 步骤（zsh）

### 3.1 备份

```bash
cp -a ~/.claude ~/.claude.bak-$(date +%Y%m%d)
cp ~/.claude.json ~/.claude.json.bak-$(date +%Y%m%d)
```

### 3.2 建第二个号的目录，登录并验证

```bash
mkdir -p ~/.claude-acc2
CLAUDE_CONFIG_DIR=~/.claude-acc2 claude
```

进去后 `/login` 登第二个号，`/status` 确认邮箱，退出。之后普通的 `claude` 里 `/status` 应该仍是主号。

### 3.3 共享会话和设置

```bash
for x in projects sessions history.jsonl settings.json skills plugins file-history; do
  rm -rf ~/.claude-acc2/$x; ln -s ~/.claude/$x ~/.claude-acc2/$x
done
```

### 3.4 改 `~/.zshrc` 里的启动函数

在你的启动函数（如 `cct`）开头加：

```zsh
local d=""; [[ "$1" == @2 ]] && { d=$HOME/.claude-acc2; shift; }
```

然后把调用 `claude` 的那行改成：

```zsh
env ${d:+CLAUDE_CONFIG_DIR=$d} claude "$@"
```

改完执行 `source ~/.zshrc`。

### 3.5 用法

| 命令 | 作用 |
|---|---|
| `cct` | 主号（原用法不变） |
| `cct @2` | 第二个号 |
| `cct @2 --resume` | 用第二个号接着之前的会话 |

## 4. 注意事项

- **同一个会话别让两个号同时开着**：两个进程同时写同一份会话记录可能冲突。
- **Claude Code 自动更新后检查一下链接**还在不在（`dir` / `ls -la ~/.claude-acc2`）。
- **桌面版 Claude App 不走 `CLAUDE_CONFIG_DIR`**：在 App 里退出再登录换号，切号后的会话找回见第 6 节。
- 两个号的登录凭据是否被系统（钥匙串 / 凭据管理器）分开保存，以第 2 步实测为准。

## 5. 回滚

- **Windows**：删掉 `%USERPROFILE%\.claude-acc2` 和 `cct2.cmd`（及复制的快捷方式）。junction 只是链接，删除不会动到主目录。
- **Mac**：`rm -rf ~/.claude-acc2`，把 `~/.zshrc` 改回原样，`source ~/.zshrc`。

主号目录 `~/.claude` 全程没有改动，另有备份兜底。

## 6. Claude Desktop 切号后找回侧边栏会话

### 6.1 先确认数据目录在哪

| 安装方式 / 登录方式 | 数据目录 |
|---|---|
| Windows 官网安装包 + 官方账号 | `%APPDATA%\Claude` |
| Windows 第三方 provider（网关、Bedrock 等） | `%LOCALAPPDATA%\Claude-3p`（组织 ID 固定为 `00000000-0000-4000-8000-000000000001`） |
| Windows 微软商店版（MSIX） | 被重定向到包目录，资源管理器里 `%APPDATA%\Claude` 是空的 |
| Mac | `~/Library/Application Support/Claude` |
| 设了 `CLAUDE_USER_DATA_DIR` | 以它为准 |

商店版的位置因机器而异：同事那台在 `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude`，我这台实际在 `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\`。**先搜一下 `claude-code-sessions` 文件夹确认真实位置**再动手：

```bat
dir /s /b /ad "%LOCALAPPDATA%\claude-code-sessions" 2>nul
dir /s /b /ad "%APPDATA%\claude-code-sessions" 2>nul
```

```bash
find ~/Library/Application\ Support -maxdepth 3 -type d -name claude-code-sessions
```

进去后能看到 `<账号ID>/<组织ID>/` 两层，新旧两个号各一套。

### 6.2 复制步骤

1. **彻底退出 Claude**（Windows 右下角托盘也要退，Mac 用 ⌘Q）。Claude 运行时会不断改写这些文件，退出时会用内存里的旧状态把你复制进去的覆盖掉。
2. 备份目标账号的文件夹。
3. 把旧号文件夹里的 `local_*.json` 复制到新号对应文件夹（同名的先比较再决定）：

```bat
xcopy "<数据目录>\claude-code-sessions\<旧账号ID>\<旧组织ID>\local_*.json" "<数据目录>\claude-code-sessions\<新账号ID>\<新组织ID>\" /D
```

```bash
cp -n "<数据目录>/claude-code-sessions/<旧账号ID>/<旧组织ID>/"local_*.json "<数据目录>/claude-code-sessions/<新账号ID>/<新组织ID>/"
```

4. **`archived-sessions.idx` 和 `deleted_*` 不要整份覆盖**：它们记的是状态。整份覆盖会平白多归档或放出一堆会话；目标那边有某条会话的 `deleted_` 标记的话，光复制记录可能不生效，需要单独处理。
5. 重新打开 Claude，侧边栏应能看到会话，点开能接着聊。

### 6.3 报 “branch is checked out somewhere else” 怎么办

Code 会话的 worktree 由三处共同记录：git（`<仓库>/.git/worktrees/`）、Desktop 的 `git-worktrees.json`、会话记录里的目录和分支。会话记录里的目录不存在、分支又被别的 worktree 占着，就会报这个错。修法是把三处对齐（`git worktree list` / `git worktree prune` 看 git 那边，再对照 `git-worktrees.json` 和会话记录改目录）。

注意会话记录的**字段名随版本变**：旧版用 `worktreePath` / `worktreeName`，新版用 `cwd` / `originCwd`。改之前先打开一条记录看清字段名。

### 6.4 懒人做法：把 SKILL 交给 AI

同事整理了一份给 AI 用的迁移 SKILL，我就是下载后直接丢给 Claude，让它先只读排查、备份，再自己完成迁移的。本站存了一份原样副本：

| 下载 | 说明 |
|---|---|
| <a href="/myblog/skills/claude-session-sync/SKILL.md" target="_blank" download>SKILL.md（英文版）</a> | 给 AI 用，建议用这个 |
| <a href="/myblog/skills/claude-session-sync/SKILL.cn.md" target="_blank" download>SKILL.cn.md（中文版）</a> | 内容相同，方便自己看 |

作者：同事（detached.online），原文与原始下载：[Claude 会话同步](https://detached.online/blog/claude-desktop%E5%88%87%E6%8D%A2%E8%B4%A6%E5%8F%B7%E5%90%8E%E4%BC%9A%E8%AF%9D%E6%B6%88%E5%A4%B1/)（[SKILL.md](https://detached.online/skills/claude-desktop-profile-switch/SKILL.md) / [SKILL.cn.md](https://detached.online/skills/claude-desktop-profile-switch/SKILL.cn.md)），以原文为准。

## 7. 走过的弯路

1. **以为会话跟账号绑在一起**：先用 `CLAUDE_CONFIG_DIR` 给第二个号单独配置目录，再用 junction / 软链接共享 `~/.claude`。命令行 `claude` 这样能 `--resume` 接着干，但 Desktop 换号后侧边栏照样是空的，因为侧边栏索引是按账号 ID 存的。
2. **用交接文档代替**：让 Claude 给每个置顶会话写一份交接文档，新号里照着继续。能用，但只是变通，侧边栏回不来。
3. **商店版找错目录**：照常规去 `%APPDATA%\Claude` 找，商店版的数据实际在重定向后的目录，我这台是 `AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc`。
4. **Mac 代理参数没生效**：`open -a Claude --args --proxy-server=...` 传不进参数，要直接运行 `/Applications/Claude.app/Contents/MacOS/Claude --proxy-server=...`；而且自动更新后重开会丢掉这个参数，所以另加了一个定时检查，发现没带代理就带上重开。

## 致谢

切号找回会话的方法来自同事的文章：[Claude 会话同步](https://detached.online/blog/claude-desktop%E5%88%87%E6%8D%A2%E8%B4%A6%E5%8F%B7%E5%90%8E%E4%BC%9A%E8%AF%9D%E6%B6%88%E5%A4%B1/)，细节和 SKILL 下载以原文为准。

## 延伸阅读

- [Claude Code 官方文档：设置与配置](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Microsoft：mklink 命令](https://learn.microsoft.com/windows-server/administration/windows-commands/mklink)
