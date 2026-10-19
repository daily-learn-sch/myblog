# Apple Silicon Mac 本地大模型搭建指南（Ollama + Open WebUI）

> 基于 2026-10-18 在 **Mac mini M4 / 24GB**（用户：小海兄）上的真实安装过程整理。  
> 适用于任意 **Apple Silicon（M 系列）且内存 ≥ 16GB** 的 Mac。  
> 目标：按本文从零完成 **安装 → 拉模型 → Web 对话 → 自启动 → 自测闭环**，且可复现。

---

## 1. 目标与架构

### 1.1 要搭成什么样

| 能力 | 说明 |
|---|---|
| 本地推理 | 在本机跑 7B/8B 量化模型，数据不出本机 |
| 网页聊天 | 浏览器打开 `http://localhost:3000` 对话 |
| 开机自启 | 登录后 Ollama + Open WebUI 自动起来 |
| 写代码调用 | OpenAI 兼容 API：`http://localhost:11434/v1` |
| 可选云端 | 在 Open WebUI 里接入 DeepSeek / OpenAI / Claude API，与本地模型并排对比 |

### 1.2 架构（本机、无 Docker）

```
浏览器 → Open WebUI (:3000) ──→ Ollama (:11434) ──→ 本地 GGUF 模型（Metal / MLX）
                │
                └──→（可选）DeepSeek / OpenAI / Claude 云端 API
```

| 组件 | 端口 | 本机参考版本（2026-10-18） | 安装方式 |
|---|---|---|---|
| Ollama | `11434` | 0.40.0 | Homebrew |
| 模型 | — | `qwen2.5:7b`、`deepseek-r1:8b`（及 `*-16k`） | `ollama pull` / ModelScope |
| Open WebUI | `3000` | 0.12.3 | `uv tool install`（Python 3.12） |
| uv | — | 0.9.21 | Homebrew |

**为什么不用 Docker？**  
国内拉 `ghcr.io` / Docker Hub 上的 Open WebUI 镜像往往极慢或失败；本机实测用 **uv/pip + 清华 PyPI 镜像** 安装 Open WebUI 更稳、更快。本文按「无 Docker」路径写死，避免踩坑。

---

## 2. 硬件要求

| 项目 | 最低 | 推荐（本文参考机） |
|---|---|---|
| 芯片 | Apple Silicon（M1 及以上） | M4 |
| 内存 | **16GB** | **24GB**（跑 7B/8B Q4 较从容） |
| 磁盘空闲 | ≥ 20GB | ≥ 30GB（模型约 9GB + WebUI 环境约 2GB + 余量） |
| 系统 | macOS 13+ | 本机为较新 macOS（arm64，非 Rosetta） |

**内存经验：**

- 7B / 8B **Q4_K_M**：运行时约 **5–6GB** 内存，24GB 机器很舒服。
- 14B Q4：约 9GB，16–24GB 机器可用。
- 32B：能勉强加载但会挤内存、明显变慢；不建议入门首选。
- 763B 级云端开源权重（如部分 DeepSeek 大杯）**不可能**在 24GB 本机跑，只能走 API。

---

## 3. 环境准备

以下命令均在 **本机 Terminal（zsh）** 执行。路径以 Apple Silicon Homebrew 默认前缀 `/opt/homebrew` 为准。

### 3.1 确认芯片与内存

```bash
uname -m                    # 应为 arm64
sysctl -n machdep.cpu.brand_string
sysctl -n hw.memsize | awk '{print $1/1024/1024/1024 " GB"}'
```

### 3.2 安装 / 配置 Homebrew（中国大陆建议用中科大镜像）

若尚未安装 Homebrew：

```bash
# 官方安装脚本（若过慢，可改用国内文档中的镜像安装方式）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Apple Silicon 把 brew 写入 shell
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

配置中科大（USTC）镜像，加速 `brew install`（国内强烈建议）：

```bash
# 写入当前 shell；也可永久放进 ~/.zprofile
export HOMEBREW_API_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles"
export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.ustc.edu.cn/brew.git"
export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.ustc.edu.cn/homebrew-core.git"

brew update
brew --version
```

> 镜像地址以 [USTC Homebrew 帮助](https://mirrors.ustc.edu.cn/help/brew.git.html) 为准，若变更请改上述变量。

### 3.3 安装 uv（用于装 Open WebUI）

```bash
brew install uv
uv --version
# 本机参考：uv 0.9.21
```

确保用户本地 bin 在 PATH 中（`uv tool` 会把命令装到这里）：

```bash
mkdir -p ~/.local/bin
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
export PATH="$HOME/.local/bin:$PATH"
```

### 3.4 创建工作目录

```bash
mkdir -p ~/local-llm/{modelfiles,logs,models,open-webui-data}
```

之后约定：

| 路径 | 用途 |
|---|---|
| `~/local-llm/modelfiles/` | Modelfile（对话模板、扩展上下文） |
| `~/local-llm/logs/` | Open WebUI 日志 |
| `~/local-llm/open-webui-data/` | WebUI 数据库、上传、向量库 |
| `~/local-llm/models/` | 可选：本地 RAG 向量模型 |
| `~/.ollama/models` | Ollama 模型权重（自动管理） |

---

## 4. 安装 Ollama

### 4.1 用 Homebrew 安装并自启

```bash
brew install ollama
brew services start ollama
```

验证：

```bash
ollama --version
# 本机参考：ollama version is 0.40.0

curl http://localhost:11434
# 应返回：Ollama is running
```

`brew services start` 会写入 LaunchAgent：

- 文件：`~/Library/LaunchAgents/sh.brew.ollama.plist`
- 日志：`/opt/homebrew/var/log/ollama.log`

常用管理：

```bash
brew services start ollama
brew services stop ollama
brew services restart ollama
tail -f /opt/homebrew/var/log/ollama.log
```

### 4.2 （可选）性能相关环境变量

本机 plist 中曾启用（brew 服务可在 plist 的 `EnvironmentVariables` 里加）：

| 变量 | 示例值 | 作用 |
|---|---|---|
| `OLLAMA_FLASH_ATTENTION` | `1` | 开启 Flash Attention |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | KV cache 量化，省一点内存 |

改完后：

```bash
brew services restart ollama
```

---

## 5. 拉取模型

### 5.1 官方源（能通就优先）

```bash
ollama pull qwen2.5:7b
ollama pull deepseek-r1:8b
ollama list
```

### 5.2 国内官方源过慢 → 用 ModelScope（实测路径）

本机安装时官方源约 **380KB/s**，改走 ModelScope GGUF 后正常。注意：

1. **只适合「单文件 GGUF」仓库**；分片 GGUF 当前不支持这样拉。
2. ModelScope 拉下来的模型 **有时缺正确对话模板**（例如变成裸模板 <code v-pre>{{ .Prompt }}</code>），回答会怪——必须用 Modelfile 套上官方 TEMPLATE。

#### 5.2.1 拉取并起短名

```bash
# Qwen2.5-7B Instruct Q4_K_M（约 4.7GB）
ollama pull modelscope.cn/lmstudio-community/Qwen2.5-7B-Instruct-GGUF:Q4_K_M

# DeepSeek-R1-0528-Qwen3-8B Q4_K_M（约 5.0GB，与官方 deepseek-r1:8b 同源级别）
ollama pull modelscope.cn/unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF:Q4_K_M
```

#### 5.2.2 用 Modelfile 套上官方模板并命名

把下面两个文件写到 `~/local-llm/modelfiles/`（内容精简示意；完整 TEMPLATE 可从 Ollama 官方库对应模型页复制，本机完整文件已存在于同目录）。

**`~/local-llm/modelfiles/Modelfile.qwen2.5-7b`（关键结构）：**

```dockerfile
FROM modelscope.cn/lmstudio-community/Qwen2.5-7B-Instruct-GGUF:Q4_K_M
# 此处粘贴官方 qwen2.5 的 TEMPLATE / SYSTEM / stop 参数
SYSTEM """You are Qwen, created by Alibaba Cloud. You are a helpful assistant."""
PARAMETER stop "<|im_start|>"
PARAMETER stop "<|im_end|>"
```

**`~/local-llm/modelfiles/Modelfile.deepseek-r1-8b`（关键结构）：**

```dockerfile
FROM modelscope.cn/unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF:Q4_K_M
# 此处粘贴官方 deepseek-r1:8b 的 TEMPLATE / stop / temperature 等
PARAMETER temperature 0.6
PARAMETER top_p 0.95
```

创建本地标签：

```bash
ollama create qwen2.5:7b -f ~/local-llm/modelfiles/Modelfile.qwen2.5-7b
ollama create deepseek-r1:8b -f ~/local-llm/modelfiles/Modelfile.deepseek-r1-8b
ollama list
```

> 若官方 `ollama pull qwen2.5:7b` 已成功，可跳过 ModelScope，直接用官方标签。

### 5.3 命令行冒烟（注意脚本里的 stdin 坑）

交互式：

```bash
ollama run qwen2.5:7b
# 输入问题；输入 /bye 退出
```

**非交互 / 写在脚本里时，必须接上 `</dev/null`**，否则 `ollama run` 会一直等标准输入，看起来像「卡住」：

```bash
ollama run qwen2.5:7b "用一句话介绍一下合肥。" </dev/null
ollama run deepseek-r1:8b --hidethinking "9.11 和 9.9 哪个大？只给结论。" </dev/null
```

本机自测参考答案方向：

- 合肥介绍：一句通顺中文即可。
- `9.11` vs `9.9`：结论应为 **9.9 更大**。
- 本机约 **21 tokens/s**（7B/8B Q4，视机型略有出入）。

---

## 6. 安装 Open WebUI（uv，不用 Docker）

### 6.1 用清华 PyPI 镜像安装

```bash
# 国内加速：清华 PyPI
export UV_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"

# Open WebUI 支持 Python 3.11–3.12；本机用 3.12.12（uv 拉 3.11 过慢时可直接用本机已有 3.12）
uv tool install open-webui --python 3.12

which open-webui
# 期望：~/.local/bin/open-webui
open-webui --version
# 本机参考：0.12.3
```

安装位置参考：

- 工具命令：`~/.local/bin/open-webui`
- 虚拟环境：`~/.local/share/uv/tools/open-webui`（约 2GB）

### 6.2 （强烈建议）预置 RAG 向量模型，避免启动卡 HuggingFace

Open WebUI 首次启用知识库时可能去 HuggingFace 下 `all-MiniLM-L6-v2`，国内易卡住。可提前放到本地并在启动环境里指定（本机做法）：

```bash
# 从 ModelScope 等国内源下载 all-MiniLM-L6-v2 到：
# ~/local-llm/models/all-MiniLM-L6-v2
# 校验与 HuggingFace 一致的 sha256 更稳妥
```

启动时配合环境变量（见下一节 LaunchAgent）：

| 变量 | 值 |
|---|---|
| `RAG_EMBEDDING_MODEL` | `/Users/<你的用户名>/local-llm/models/all-MiniLM-L6-v2` |
| `RAG_EMBEDDING_MODEL_AUTO_UPDATE` | `false` |
| `RAG_RERANKING_MODEL_AUTO_UPDATE` | `false` |
| `HF_ENDPOINT` | `https://hf-mirror.com`（备用镜像） |

### 6.3 前台试跑一次

把路径里的用户名换成你的（本机为 `xiaohaixiong`）：

```bash
export DATA_DIR="$HOME/local-llm/open-webui-data"
export OLLAMA_BASE_URL="http://127.0.0.1:11434"
export HF_ENDPOINT="https://hf-mirror.com"
export HF_HUB_DISABLE_XET=1
# 若已预置向量模型：
# export RAG_EMBEDDING_MODEL="$HOME/local-llm/models/all-MiniLM-L6-v2"
# export RAG_EMBEDDING_MODEL_AUTO_UPDATE=false
# export RAG_RERANKING_MODEL_AUTO_UPDATE=false

open-webui serve --host 127.0.0.1 --port 3000
```

另开一个终端验证：

```bash
curl -o /dev/null -s -w '%{http_code}\n' http://localhost:3000
# 期望：200
```

浏览器打开：<http://localhost:3000>  
确认无误后，用 `Ctrl+C` 停掉前台进程，再配自启动。

---

## 7. 自启动（launchd）

### 7.1 Ollama

已由 `brew services start ollama` 管理，一般无需手写 plist。确认：

```bash
brew services list | grep ollama
curl http://localhost:11434
```

### 7.2 Open WebUI：自建 LaunchAgent

创建 `~/Library/LaunchAgents/com.xiaohai.open-webui.plist`（**把所有 `/Users/xiaohaixiong` 换成你的家目录**）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>DATA_DIR</key>
		<string>/Users/xiaohaixiong/local-llm/open-webui-data</string>
		<key>HF_ENDPOINT</key>
		<string>https://hf-mirror.com</string>
		<key>HF_HUB_DISABLE_XET</key>
		<string>1</string>
		<key>OLLAMA_BASE_URL</key>
		<string>http://127.0.0.1:11434</string>
		<key>PATH</key>
		<string>/Users/xiaohaixiong/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
		<key>RAG_EMBEDDING_MODEL</key>
		<string>/Users/xiaohaixiong/local-llm/models/all-MiniLM-L6-v2</string>
		<key>RAG_EMBEDDING_MODEL_AUTO_UPDATE</key>
		<string>false</string>
		<key>RAG_RERANKING_MODEL_AUTO_UPDATE</key>
		<string>false</string>
	</dict>
	<key>KeepAlive</key>
	<true/>
	<key>Label</key>
	<string>com.xiaohai.open-webui</string>
	<key>ProgramArguments</key>
	<array>
		<string>/Users/xiaohaixiong/.local/bin/open-webui</string>
		<string>serve</string>
		<string>--host</string>
		<string>127.0.0.1</string>
		<string>--port</string>
		<string>3000</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/xiaohaixiong/local-llm/logs/open-webui.err.log</string>
	<key>StandardOutPath</key>
	<string>/Users/xiaohaixiong/local-llm/logs/open-webui.out.log</string>
	<key>WorkingDirectory</key>
	<string>/Users/xiaohaixiong/local-llm/open-webui-data</string>
</dict>
</plist>
```

加载与管理：

```bash
# 加载（启动）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xiaohai.open-webui.plist

# 重启
launchctl kickstart -k gui/$(id -u)/com.xiaohai.open-webui

# 看状态
launchctl print gui/$(id -u)/com.xiaohai.open-webui | grep state

# 停止（卸载本次会话；plist 仍在则下次登录还会自启）
launchctl bootout gui/$(id -u)/com.xiaohai.open-webui

# HTTP 检查
curl -o /dev/null -s -w '%{http_code}\n' http://localhost:3000
```

彻底取消自启：先 `bootout`，再把 plist 移出 `~/Library/LaunchAgents/`。

日志：

```bash
tail -f ~/local-llm/logs/open-webui.err.log
tail -f ~/local-llm/logs/open-webui.out.log
```

---

## 8. 首次注册与管理员

1. 浏览器打开 <http://localhost:3000>
2. **第一个注册的账号就是管理员**（不会发验证邮件，邮箱可随意填）
3. 登录后，左上角模型下拉框应能看到 `qwen2.5:7b`、`deepseek-r1:8b`（以及你创建的 `*-16k`）
4. 可点「+」同时选多个模型，同一问题 **并排对比（Multi-Model Chat）**

数据都在 `~/local-llm/open-webui-data/`（含 `webui.db`）。删此目录等于清空账号与聊天记录。

---

## 9. 接入 DeepSeek / OpenAI / Claude API

菜单路径以 Open WebUI 为准（文档：Settings → Admin → Connections）：

1. 管理员登录 → 左下角头像 → **Admin Panel → Settings → Connections**
2. **Manage OpenAI API Connections** → ➕ **Add Connection**
3. 按提供商填写后 Save；模型会出现在下拉框，可与本地模型并排测。

### 9.1 DeepSeek

| 项 | 值 |
|---|---|
| URL | `https://api.deepseek.com/v1`（与不带 `/v1` 的 base 通常都兼容） |
| API Key | 在 [platform.deepseek.com](https://platform.deepseek.com) 创建 |
| Model IDs | 可留空自动发现；必要时手动填官方当前模型名 |

### 9.2 OpenAI

| 项 | 值 |
|---|---|
| URL | `https://api.openai.com/v1` |
| API Key | OpenAI 控制台创建的 Key |

### 9.3 Claude（Anthropic）

Open WebUI 对 Anthropic 可能有独立「Anthropic」连接入口（视版本而定）；若走 OpenAI 兼容代理，则填你的代理 Base URL + Key。以当前版本 Admin → Connections 界面为准。

### 9.4 本地 OpenAI 兼容 API（给 Java / Python / Agent 用）

| 项 | 值 |
|---|---|
| Base URL | `http://localhost:11434/v1` |
| API Key | 任意字符串（如 `ollama`），本地不校验 |
| 模型名 | `qwen2.5:7b` / `deepseek-r1:8b` / `*-16k` |

```bash
curl http://localhost:11434/v1/models

curl http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"Reply with exactly: pong"}]}'
```

Python（OpenAI SDK）：

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
r = client.chat.completions.create(
    model="qwen2.5:7b",
    messages=[{"role": "user", "content": "你好"}],
)
print(r.choices[0].message.content)
```

Spring AI：可用 OpenAI starter，把 `spring.ai.openai.base-url` 指到 `http://localhost:11434`；或用 Ollama starter：`spring.ai.ollama.base-url=http://localhost:11434`。

---

## 10. 自测闭环（含示例题）

按顺序打勾，全部通过即闭环完成。

### 10.1 服务存活

```bash
curl -s http://localhost:11434
# Ollama is running

curl -o /dev/null -s -w '%{http_code}\n' http://localhost:3000
# 200

ollama list
ollama ps
```

### 10.2 命令行推理

```bash
ollama run qwen2.5:7b "用一句话介绍一下合肥。" </dev/null
ollama run qwen2.5:7b "In one sentence, what is the JVM?" </dev/null
ollama run deepseek-r1:8b --hidethinking "9.11 和 9.9 哪个大？只给结论。" </dev/null
```

### 10.3 HTTP API

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"Reply with exactly: pong"}]}' \
  | grep -o '"content":"[^"]*"'
# 期望出现 content 含 pong
```

### 10.4 网页

1. 打开 <http://localhost:3000> 并登录  
2. 选 `qwen2.5:7b` 发一句「你好」有回复  
3. 换 `deepseek-r1:8b` 再测一题  

### 10.5 对比题库（本地 vs 云端，建议各跑一遍）

同一题分别问 `qwen2.5:7b`、`deepseek-r1:8b`、（可选）`deepseek-flash` 等云端模型：

1. （中文写作）用 150 字向不懂技术的人解释「微服务」，要有生活比喻。  
2. （English）改写并简要说明每处修改：`I have do Java backend for ten years and familiar many framework.`  
3. （Java）用 Java 17 写线程安全 LRU（容量固定、get/put O(1)）+ 3 个 JUnit 5 测试。  
4. （排错）高并发下为何丢数据？如何改？`Map<String,Integer> m = new HashMap<>(); m.put(k, m.getOrDefault(k,0)+1);`  
5. （系统设计）订单 30 分钟超时取消：延迟队列 vs 定时扫表 vs Redis 过期监听。  
6. （推理）三开关三灯，只能进隔壁一次，如何对应？写出推理。  
7. （陷阱）9.11 和 9.9 哪个大？strawberry 里几个 r？  
8. （知识截止）训练数据截止？2026 年 Java 版本？最新 Spring Boot 大版本？（看谁会编）  
9. （长上下文）贴 ≥3000 字文档：5 条要点 + 3 处矛盾/含糊。（见第 11 节，默认 4096 易爆）  
10. （Agent）用 JSON 写出：根据「明天合肥会不会下雨，下雨就提醒带伞」需调哪些工具、参数与顺序。

评分：准确性、是否胡编、中英自然度、代码能否编译、速度。

---

## 11. 上下文超限坑（4096 → 用 Modelfile 建 `*-16k`）

### 11.1 现象

长文总结、多轮长对话时出现上下文不够、截断或报错。Ollama 许多模型默认 **`num_ctx` = 4096**，贴 3000+ 字需求文档时很容易顶满。

### 11.2 解法：基于已有模型建 16k 变体

```bash
# ~/local-llm/modelfiles/Modelfile.qwen2.5-7b-16k
cat > ~/local-llm/modelfiles/Modelfile.qwen2.5-7b-16k << 'EOF'
FROM qwen2.5:7b
PARAMETER num_ctx 16384
EOF

# ~/local-llm/modelfiles/Modelfile.deepseek-r1-8b-16k
cat > ~/local-llm/modelfiles/Modelfile.deepseek-r1-8b-16k << 'EOF'
FROM deepseek-r1:8b
PARAMETER num_ctx 16384
EOF

ollama create qwen2.5:7b-16k -f ~/local-llm/modelfiles/Modelfile.qwen2.5-7b-16k
ollama create deepseek-r1:8b-16k -f ~/local-llm/modelfiles/Modelfile.deepseek-r1-8b-16k
ollama list
```

在 Open WebUI 下拉框选 `qwen2.5:7b-16k` / `deepseek-r1:8b-16k` 再跑长文档题。

**注意：** `num_ctx` 越大，KV cache 越吃内存；24GB 上 16k 对 7B/8B Q4 通常可接受，再往上（32k/64k）请自己用 `ollama ps` 与「活动监视器」观察。

---

## 12. 启停、资源释放与日常管理

装好之后日常只有两种状态：**用的时候拉起来，不用的时候释放资源**。释放分四个层级，从轻到重按需选。

### 12.1 启停速查表

| 组件 | 启动 | 停止 | 查状态 |
|---|---|---|---|
| Ollama | `brew services start ollama` | `brew services stop ollama` | `brew services list \| grep ollama`；`curl localhost:11434` |
| Open WebUI | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xiaohai.open-webui.plist` | `launchctl bootout gui/$(id -u)/com.xiaohai.open-webui` | `launchctl print gui/$(id -u)/com.xiaohai.open-webui \| grep state`；`curl -o /dev/null -s -w '%{http_code}\n' localhost:3000` |
| 已加载模型 | `ollama run qwen2.5:7b </dev/null`（触发加载） | `ollama stop qwen2.5:7b`（只卸载模型，服务还在） | `ollama ps` |

> `id -u` 输出你的用户 ID（如 501），`launchctl` 的 `gui/<uid>` 域必须用它，不能简写。

### 12.2 释放资源的四个层级（从轻到重）

**L1 · 只卸载模型（最轻，日常推荐）**

模型推理时占约 5–6GB 内存，退出对话不会自动释放。用完后：

```bash
ollama ps                 # 看当前加载了哪些模型
ollama stop qwen2.5:7b    # 卸载这一个
ollama stop deepseek-r1:8b
```

Ollama 服务本身还在（空载几乎不占资源），下次 `ollama run` 或在网页里点一下模型会自动重新加载。**这是日常"释放资源"的首选。**

**L2 · 停掉 Ollama 服务**

```bash
brew services stop ollama
```

所有已加载模型退出内存，11434 端口关闭。想用时 `brew services start ollama` 恢复。注意：这只是停掉本次运行，plist 还在，**重启 Mac 后 Ollama 依然会自启**（通常这正是你想要的）。

**L3 · 停掉 Open WebUI**

```bash
launchctl bootout gui/$(id -u)/com.xiaohai.open-webui
```

释放 WebUI 的 Python 进程（约几百 MB）。同理，plist 还在的话重启后会自启。

**L4 · 彻底取消开机自启（出差 / 长期不用）**

```bash
mkdir -p ~/local-llm/backup-plist

# Ollama：停服务 + 把 plist 挪走（不删除，方便恢复）
brew services stop ollama
mv ~/Library/LaunchAgents/sh.brew.ollama.plist ~/local-llm/backup-plist/

# Open WebUI：停服务 + 挪走 plist
launchctl bootout gui/$(id -u)/com.xiaohai.open-webui
mv ~/Library/LaunchAgents/com.xiaohai.open-webui.plist ~/local-llm/backup-plist/
```

恢复自启：把 plist 移回去，再 `brew services start ollama` / `launchctl bootstrap …`。

> 记住这个区别：**L1–L3 是"本次生效、重启恢复"；只有 L4（移出 plist）能阻止下次开机自启。**

### 12.3 一键脚本（可选）

嫌命令长，包两个脚本放 `~/local-llm/`：

**`~/local-llm/llm-stop.sh`**（释放全部资源）：

```bash
#!/bin/bash
ollama stop qwen2.5:7b 2>/dev/null
ollama stop deepseek-r1:8b 2>/dev/null
brew services stop ollama
launchctl bootout gui/$(id -u)/com.xiaohai.open-webui 2>/dev/null
echo "已释放：模型已卸载，Ollama 与 Open WebUI 已停止"
```

**`~/local-llm/llm-start.sh`**（全部拉起并自检）：

```bash
#!/bin/bash
brew services start ollama
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xiaohai.open-webui.plist 2>/dev/null || \
  launchctl kickstart -k gui/$(id -u)/com.xiaohai.open-webui
sleep 3
curl -s http://localhost:11434 && echo
curl -o /dev/null -s -w 'WebUI: %{http_code}\n' http://localhost:3000
```

```bash
chmod +x ~/local-llm/llm-start.sh ~/local-llm/llm-stop.sh
```

### 12.4 资源占用量级（本机 2026-10-18）

| 项目 | 约占用 |
|---|---|
| `~/.ollama/models` | 9.0 GB |
| Open WebUI（uv tool 环境） | 2.0 GB |
| uv 缓存 `~/.cache/uv` | ~2 GB（可与环境有 APFS 克隆共享；可 `uv cache clean`） |
| Ollama + mlx 等 | ~0.2 GB |
| `~/local-llm`（数据/向量/日志） | ~0.1 GB+ |
| **合计** | **约 11–13 GB** |

### 12.5 笔记本省电建议

- 模型加载后约 5–6GB（7B/8B Q4）；风扇起飞时先 `ollama ps`，看是不是一次加载了多个模型。
- 笔记本建议接电再跑大模型；低电量时按 §12.2 的 L1/L2 释放。
- 只有插电常开的台式场景（比如这台 Mac mini）才适合长期开着自启。

---

## 13. 常见问题

| 现象 | 原因与处理 |
|---|---|
| `ollama run` 在脚本里卡住 | 缺 stdin；加 `</dev/null` |
| `brew install` / 拉 bottle 很慢 | 配 USTC 等 Homebrew 镜像（见 §3.2） |
| `ollama pull` 官方源极慢 | 改 ModelScope GGUF + Modelfile 套模板（见 §5.2） |
| ModelScope 模型回答怪异 | 缺 TEMPLATE；用官方模板 `ollama create` |
| Docker / `ghcr.io` 拉 Open WebUI 失败 | **预期坑**：国内慢；改用本文 uv 路径 |
| `uv tool install` 慢或超时 | `export UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple` |
| Open WebUI 启动卡在下模型 | 预置向量模型 + `RAG_*_AUTO_UPDATE=false` + `HF_ENDPOINT` |
| 网页 3000 非 200 | `launchctl print … \| grep state`；看 `~/local-llm/logs/open-webui.err.log` |
| 长文报上下文不够 | 默认 4096；建 `*-16k`（见 §11） |
| 内存飙高 / 风扇转 | `ollama ps` 看加载了几个模型；停用不用的；降 `num_ctx` |
| 想卸干净 | 见下方卸载命令 |

### 13.1 卸载 / 释放空间

```bash
# 只删模型
ollama rm deepseek-r1:8b
ollama rm qwen2.5:7b
ollama rm qwen2.5:7b-16k
ollama rm deepseek-r1:8b-16k

# 卸 Open WebUI
launchctl bootout gui/$(id -u)/com.xiaohai.open-webui 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.xiaohai.open-webui.plist
uv tool uninstall open-webui
uv cache clean
# 会删账号与聊天记录：
# rm -rf ~/local-llm/open-webui-data ~/local-llm/models

# 卸 Ollama（含全部模型）
brew services stop ollama
brew uninstall ollama && brew autoremove
rm -rf ~/.ollama
```

---

## 14. 延伸阅读

| 资源 | 链接 |
|---|---|
| Ollama 官网 | https://ollama.com |
| Ollama GitHub | https://github.com/ollama/ollama |
| Ollama 模型库 | https://ollama.com/library |
| Open WebUI 文档 | https://docs.openwebui.com |
| Open WebUI GitHub | https://github.com/open-webui/open-webui |
| Open WebUI：连接 Provider | https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/ |
| DeepSeek API 文档 | https://api-docs.deepseek.com/ |
| ModelScope | https://www.modelscope.cn |
| USTC Homebrew 镜像说明 | https://mirrors.ustc.edu.cn/help/brew.git.html |
| 清华 PyPI 镜像 | https://mirrors.tuna.tsinghua.edu.cn/help/pypi/ |
| uv 文档 | https://docs.astral.sh/uv/ |
| HuggingFace 镜像（社区常用） | https://hf-mirror.com |

---

## 附录 A. 本机一次装成后的关键路径速查

| 项 | 路径 |
|---|---|
| 使用说明（安装当日笔记） | `~/local-llm/README-使用说明.md` |
| Modelfile | `~/local-llm/modelfiles/` |
| Open WebUI 数据 | `~/local-llm/open-webui-data/` |
| Open WebUI 日志 | `~/local-llm/logs/open-webui.*.log` |
| Ollama LaunchAgent | `~/Library/LaunchAgents/sh.brew.ollama.plist` |
| Open WebUI LaunchAgent | `~/Library/LaunchAgents/com.xiaohai.open-webui.plist` |
| Ollama 日志 | `/opt/homebrew/var/log/ollama.log` |
| 模型权重 | `~/.ollama/models` |

## 附录 B. 给「跟着文档执行的 AI」的检查清单

1. `uname -m` = `arm64`，内存 ≥ 16GB  
2. `brew`、`uv`、`ollama`、`open-webui` 均在 PATH  
3. `curl localhost:11434` → `Ollama is running`  
4. `ollama list` 含目标模型；长文场景另有 `*-16k`  
5. `curl -w '%{http_code}' localhost:3000` → `200`  
6. 脚本中所有 `ollama run ...` 均带 `</dev/null`  
7. 未使用 Docker；国内网络已配 Homebrew / PyPI /（必要时）ModelScope 与 HF 镜像  
8. 未替用户保存任何云端 API Key；Key 由用户在 WebUI Connections 自行填写  

---

*文档根据 2026-10-18 真实安装整理，命令以当日环境为准；组件版本升级后以官方文档为准微调即可。*
