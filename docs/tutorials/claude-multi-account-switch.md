# Claude Code 多账号切换且不丢会话（Mac / Windows）

> 适用场景：Claude Code（`claude` CLI）的一个账号额度快用完，想切到第二个账号继续干活，又不想每次退出重新登录，更不想丢掉之前的会话历史。
>
> ⚠️ **状态：方案待实测验证。** 第 2 步就是验证环节——确认两个账号的登录确实分开保存后，再继续后面的步骤。文中 `cct` 代表你自己的 Claude 启动命令（脚本/函数），没有的话直接用 `claude`。

## 1. 原理：会话跟项目走，不跟账号走

- Claude Code 的会话记录保存在 `~/.claude/projects/` 下，**按项目目录划分**，和当前登录的是哪个账号无关。所以换号本身不会丢会话，麻烦只在于"同一时间只能登一个号"，每次换都要重新走浏览器登录。
- 环境变量 `CLAUDE_CONFIG_DIR` 可以让 Claude Code 使用另一个配置目录。给第二个号单独一个目录（如 `~/.claude-acc2`），它就有自己独立的登录状态，两个号可以同时保持登录。
- 再把 `projects`、`history.jsonl`、`settings.json`、`skills`、`plugins` 等用**链接**指回主目录 `~/.claude`，两个号看到的就是同一份会话和设置。
- **不要共享 `.claude.json`**：登录/账号信息在这里，共享了就又变回"一个号"。

```
~/.claude/            ← 主号（原样不动）
  projects/  history.jsonl  settings.json  skills/  plugins/
~/.claude-acc2/       ← 第二个号（独立登录）
  projects  -> ~/.claude/projects
  history.jsonl -> ~/.claude/history.jsonl
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
- **桌面版 Claude App 不受影响**：它不走 `CLAUDE_CONFIG_DIR`，换号仍在 App 里退出再登录。
- 两个号的登录凭据是否被系统（钥匙串 / 凭据管理器）分开保存，以第 2 步实测为准。

## 5. 回滚

- **Windows**：删掉 `%USERPROFILE%\.claude-acc2` 和 `cct2.cmd`（及复制的快捷方式）。junction 只是链接，删除不会动到主目录。
- **Mac**：`rm -rf ~/.claude-acc2`，把 `~/.zshrc` 改回原样，`source ~/.zshrc`。

主号目录 `~/.claude` 全程没有改动，另有备份兜底。

## 延伸阅读

- [Claude Code 官方文档：设置与配置](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Microsoft：mklink 命令](https://learn.microsoft.com/windows-server/administration/windows-commands/mklink)
