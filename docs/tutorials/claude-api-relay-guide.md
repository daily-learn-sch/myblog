# 从 0 到 1，给自己搭一套 Claude API 中转（备用线）

> **定位先说清：这是一条备用线，不是主力。** 主力仍是你个人 desktop 的直连方案；这套东西只在“主用出问题、需要立刻切走”时顶上。
>
> **覆盖范围：Claude Code CLI / API 调用。** 桌面 App 不吃 `ANTHROPIC_BASE_URL`，所以这套替代不了桌面启动线，这点不要有误解。
>
> **一句话原理：** 你的 CLI 不再直连 `api.anthropic.com`，而是连你自己的服务器；服务器校验你发的凭证，换上真实 key 再转发，响应以 SSE 流式原样返回。

---

## 1. 先说清：这套东西是什么、不是什么

### 它是什么

- 一个**反向代理**：收你的请求，换头，转发到 Anthropic，流回响应。
- 一个**key 隔离层**：真实 key 只存在服务器上，你的笔记本、公司电脑上只有一串你自己发的凭证，丢了换一串就行，不用换真实 key。
- 一个**切换点**：上游出问题（限速、失效），你在服务器上改个配置重启，所有客户端零改动就切过去了。**备用的核心价值就在这四个字：能换上游。**

### 它不是什么

- **不能解封。** 上游 key 封了，中转过去照样封。中转不改变账号状态，只改变请求走哪条路。
- **不能加速。** 多一跳必然慢一点，换来的是可控和可切换，不是速度。
- **不是桌面方案。** 桌面 App 不认这两个环境变量，别指望它。

### 公司那套 vs 你这套

| | 公司那套（你截图那台） | 你这套（本文搭的） |
|---|---|---|
| 中转地址 | 公司内网中转地址（已隐去） | 你 VPS 的 Tailscale 内网地址（或你自己的域名） |
| 传输 | http 明文（公网 IP，凭证裸奔） | Tailscale 内网直连，或 Caddy 自动 HTTPS |
| key 归属 | 公司统一 key，全员共用 | 你自己的 key |
| 上游切换 | 公司说了算 | 你改环境变量、重启服务即切 |
| 覆盖 | CLI / API | CLI / API（同样不覆盖桌面 App） |

---

## 2. 整体架构

```
┌────────────────────┐      ① 你的凭证        ┌────────────────────────┐      ② 真实 key      ┌───────────────────┐
│ 你的电脑            │ ───────────────────▶ │ 你的中转服务器 (VPS)    │ ───────────────────▶ │ api.anthropic.com │
│ Claude Code CLI     │  ANTHROPIC_BASE_URL  │  relay.js (:8300)       │  HTTPS               │                   │
│                     │  ANTHROPIC_AUTH_TOKEN │  校验凭证 → 换头 → 转发  │                      │  Claude 模型        │
│                     │ ◀─────────────────── │  SSE 原样流回           │ ◀─────────────────── │                   │
└────────────────────┘      ③ 流式响应        └────────────────────────┘      ④ 流式响应        └───────────────────┘
```

数据流五步，缺一不可：

1. CLI 读 `ANTHROPIC_BASE_URL`，把请求发到你的服务器，而不是官方地址；
2. CLI 在 `x-api-key` 头里带的是你发的**中转凭证**（`ANTHROPIC_AUTH_TOKEN`），不是真实 key；
3. 服务器校验凭证，不对直接 401，对了才往下走；
4. 服务器把 `x-api-key` 换成**真实 key**，其余头原样透传——`anthropic-version`、`anthropic-beta` 这两个头必须透传，缺了上游会直接报错；
5. 上游响应以 SSE 流式 pipe 回客户端，**中间不缓冲**，否则长输出会卡顿、断流。

切换上游时的样子：

```
中转服务器
  ├─ 上游 key A（主用）──▶ 限速 / 失效时
  └─ 上游 key B（备用）──▶ 改环境变量 → systemctl restart → 客户端零改动
```

---

## 3. 准备清单

- 一台 VPS：复用你现有的就行，新增成本 0（本文以你那台 VPS 为例）。
- Node.js 18+：中转服务只需要 Node 标准库，不用装任何依赖。
- 一把你自己的 Anthropic API key：去 console.anthropic.com 申请，**它和 Pro 订阅不是一回事，是单独计费的 API 账单**。等账号稳定后再办，现在只看文档不动手。
- Tailscale：你已经有了，这是本文推荐的安全通道（见第 5 节），连证书都省了。
- （可选）一个域名：只有走公网 HTTPS 路线时才需要，Tailscale 路线不需要。

---

## 4. 服务端：极简中转（方案 A，推荐个人备用）

### 4.1 完整代码

在服务器上建目录、写文件：

```bash
mkdir -p /opt/claude-relay && cd /opt/claude-relay
```

把下面这段存为 `/opt/claude-relay/relay.js`。注意：**不要把真实 key 写进代码**，一律走环境变量。

```js
// relay.js —— 极简 Claude API 中转：校验自发凭证 → 换真实 key → 透传到 Anthropic
const http = require('http');
const https = require('https');

const UPSTREAM_HOST = 'api.anthropic.com';
// 支持多把 key（逗号分隔），轮换分摊限速；只有一把时只填一把
const UPSTREAM_KEYS = (process.env.ANTHROPIC_API_KEYS || process.env.ANTHROPIC_API_KEY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';

if (!UPSTREAM_KEYS.length || !RELAY_TOKEN) {
  console.error('缺少环境变量：请设置 ANTHROPIC_API_KEY（真实 key）和 RELAY_TOKEN（自发凭证）');
  process.exit(1);
}

let keyIndex = 0;
const nextKey = () => UPSTREAM_KEYS[keyIndex++ % UPSTREAM_KEYS.length];

// 逐跳头：转发时必须去掉，否则上游或客户端会行为异常
const HOP_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection',
  'transfer-encoding', 'upgrade', 'te', 'trailer',
]);

const server = http.createServer((req, res) => {
  // 1. 校验：只认自己发的凭证（Claude Code 发的是 x-api-key 头）
  if (req.headers['x-api-key'] !== RELAY_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid relay token' } }));
    return;
  }

  // 2. 换头：去掉逐跳头，把 x-api-key 换成真实 key，
  //    其余头（anthropic-version、anthropic-beta 等）原样透传
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  headers['x-api-key'] = nextKey();

  const proxy = https.request(
    { hostname: UPSTREAM_HOST, port: 443, path: req.url, method: req.method, headers },
    (upRes) => {
      // 3. 流式回传：不缓冲，SSE 原样 pipe 回客户端
      const resHeaders = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (!HOP_HEADERS.has(k.toLowerCase())) resHeaders[k] = v;
      }
      res.writeHead(upRes.statusCode, resHeaders);
      upRes.pipe(res);
    }
  );
  proxy.on('error', (err) => {
    console.error('上游请求失败：', err.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'upstream request failed' } }));
  });
  req.pipe(proxy);
});

const LISTEN_HOST = process.env.LISTEN_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 8300);
server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`中转已启动：http://${LISTEN_HOST}:${LISTEN_PORT}（上游 key 共 ${UPSTREAM_KEYS.length} 把）`);
});
```

逐段讲清三点，免得以后改代码时改错地方：

- **校验段**只认 `x-api-key` 头。Claude Code 的 `ANTHROPIC_AUTH_TOKEN` 就是通过这个头发出来的，和你截图里状态页显示的 `Auth token: ANTHROPIC_AUTH_TOKEN` 是同一回事。
- **换头段**是全文最关键的一处：真实 key 只在这里出现一次，且来自环境变量；`anthropic-version`、`anthropic-beta` 必须透传，删了它们上游直接报错。
- **回传段**用 `pipe` 直通，不读、不改、不缓存响应体。任何“先攒完整再返回”的写法都会让长输出卡顿，这是中转“差点意思”最常见的自造原因。

### 4.2 环境变量文件（key 别进代码、别进聊天记录）

建 `/opt/claude-relay/.env`，权限只给自己看：

```bash
# 真实 key：一把就填 ANTHROPIC_API_KEY，多把轮换就填 ANTHROPIC_API_KEYS（逗号分隔）
ANTHROPIC_API_KEY=sk-ant-你的真实key
# 自发凭证：随便生成一串长的，只发给自己的客户端，丢了换一串重启即可
RELAY_TOKEN=你自己生成的一串长随机字符
# 监听地址：Tailscale 路线填 VPS 的 100.x 内网地址；本机调试填 127.0.0.1
LISTEN_HOST=100.x.x.x
LISTEN_PORT=8300
```

```bash
chmod 600 /opt/claude-relay/.env
```

### 4.3 用 systemd 托管（重启、掉线自恢复）

建 `/etc/systemd/system/claude-relay.service`：

```ini
[Unit]
Description=Claude API relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/claude-relay
ExecStart=/usr/bin/node /opt/claude-relay/relay.js
EnvironmentFile=/opt/claude-relay/.env
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启动并设开机自启：

```bash
systemctl daemon-reload
systemctl enable --now claude-relay
systemctl status claude-relay   # 看到 active (running) 即成功
journalctl -u claude-relay -f  # 实时看日志，出问题先看这里
```

---

## 5. 安全：别学公司那套 http 明文

公司那套是 `http://公网 IP:8300`，凭证在公网路上明文走。你这套二选一，**首选 Tailscale**：

### 首选：只绑 Tailscale 内网地址（推荐）

- `.env` 里 `LISTEN_HOST` 填 VPS 的 Tailscale 地址（100.x.x.x），不要填 `0.0.0.0`。
- 这样中转端口根本不在公网上暴露，路径全程走加密的 tailnet，证书都不用配。
- 防火墙再补一刀（以 ufw 为例）：

```bash
ufw allow from 100.0.0.0/8 to any port 8300
ufw deny 8300
```

### 备选：公网 + Caddy 自动 HTTPS（需要域名）

- `LISTEN_HOST` 改回 `127.0.0.1`，中转只听本机。
- 前面架 Caddy，`Caddyfile` 就两行：

```text
relay.你的域名 {
    reverse_proxy 127.0.0.1:8300
}
```

- 域名解析到 VPS 公网 IP，`systemctl reload caddy` 后证书自动签发、自动续期。
- 客户端地址改成 `https://relay.你的域名`（注意是 https，不带端口）。

**无论哪条路线，都不要出现 `http://公网 IP:端口` 这种形态。** 这是公司那套唯一不值得学的地方。

---

## 6. 客户端：指过去

核心就两个环境变量，和你截图里状态页显示的两个字段一一对应：

| 环境变量 | 填什么 |
|---|---|
| `ANTHROPIC_BASE_URL` | 你的中转地址（Tailscale 路线：`http://100.x.x.x:8300`；Caddy 路线：`https://relay.你的域名`） |
| `ANTHROPIC_AUTH_TOKEN` | 你发的 `RELAY_TOKEN`，不是真实 key |

### macOS / Linux（写进 shell 配置，一劳永逸）

```bash
# 追加到 ~/.zshrc 或 ~/.bashrc，改完新开一个终端生效
export ANTHROPIC_BASE_URL="http://100.x.x.x:8300"
export ANTHROPIC_AUTH_TOKEN="你自己发的那串凭证"
```

### Windows PowerShell（当前窗口生效；要永久生效再用系统环境变量面板）

```powershell
$env:ANTHROPIC_BASE_URL="http://100.x.x.x:8300"
$env:ANTHROPIC_AUTH_TOKEN="你自己发的那串凭证"
```

### 另一种写法：Claude Code 的 settings.json

不想污染 shell 环境时，也可以写进 `~/.claude/settings.json` 的 `env` 字段，效果一样，作用域只对 Claude Code 生效：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://100.x.x.x:8300",
    "ANTHROPIC_AUTH_TOKEN": "你自己发的那串凭证"
  }
}
```

模型名是直通的：你在 CLI 里选什么模型，中转就透传什么模型名，不会偷换。想限制能用的模型，要到第 9 节的网关方案里做。

---

## 7. 验证：三步确认通了

按顺序做，前一步不过不要往下走：

**第 1 步：错凭证必须 401（证明校验层在工作）**

```bash
curl -s -X POST http://100.x.x.x:8300/v1/messages \
  -H "x-api-key: wrong" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期：401 invalid relay token
```

**第 2 步：对凭证、故意缺参数，不再是 401（证明请求已转发到上游）**

```bash
curl -s -X POST http://100.x.x.x:8300/v1/messages \
  -H "x-api-key: 你自己发的那串凭证" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期：不再是 401，而是 Anthropic 返回的 400（参数缺失）——400 在这里是好消息，说明转发通了
```

**第 3 步：CLI 实测**

打开 Claude Code，执行 `/status`，看到 `Anthropic base URL` 是你的中转地址（和你截图里那页是同一个位置），再随便问一句话收到回复，即全线贯通。

---

## 8. 进阶：多 key 轮换与一键切换上游（备用的核心）

### 多 key 轮换

第 4 节的代码已经内置了：`.env` 里用 `ANTHROPIC_API_KEYS` 填多把 key（逗号分隔），请求会轮换着用，分摊单把 key 的限速。

**诚实说明一点：** 极简版只做轮换，不做“某把 key 429 时自动重发到下一把”——因为请求体一旦发出就不能重发，真要做自动重试得先缓存请求体，复杂度立刻上去。个人备用没必要，先做到“能手动切”就够了。

### 一键切换上游（主用挂了时的操作）

```bash
# 1. 改 .env：把失效的 key 删掉，或把备用 key 挪到第一位
# 2. 重启服务
systemctl restart claude-relay
# 3. 完。客户端零改动，下一次请求自动走新 key
```

这就是第 1 节说的“备用的核心价值”：切换动作只发生在服务器上，所有客户端不用动。

### 用量日志（可选，十行以内）

想记账时，在 `server.listen` 之前加一行请求日志就够了——记时间、路径、状态码即可。token 数要解析 SSE 响应体才能拿到，那是网关级功能，极简版不做，需要时看第 9 节。

---

## 9. 方案 B：LiteLLM 网关（如果你想要用量统计和虚拟 key）

极简版够用时不要上这个。只有当你出现以下需求时再考虑：

- 多人共用，想给每个人发不同的虚拟 key、分别记账；
- 想在网关层限模型、限预算、看 token 统计面板；
- 想接不止 Anthropic 一家的上游。

做法概览（不展开全部细节，因为这是“以后可能用”的分支）：

```bash
pip install 'litellm[proxy]'
litellm --config config.yaml --port 4000
```

`config.yaml` 里配 `model_list`（上游填 Anthropic key）和 `general_settings`；客户端把 `ANTHROPIC_BASE_URL` 指向网关地址，凭证换成网关发的虚拟 key。代价是：多一个组件、多一份配置、多一个出问题的地方。**个人备用，方案 A 是终点，方案 B 是备选项。**

---

## 10. 故障排查表

| 现象 | 可能原因 | 查法 |
|---|---|---|
| 401 | 客户端凭证 ≠ 服务器 `RELAY_TOKEN`（常见是前后多了空格） | 两边字符串逐字对照 |
| 429 | 上游 key 被限速 | 换一把 key 或等窗口；看 `journalctl -u claude-relay` |
| 连接超时 / 拒绝 | 服务没起、监听地址不对、防火墙没放行 | `systemctl status claude-relay`、`ss -tlnp \| grep 8300`、`ufw status` |
| 400 invalid model | 上游 key 没有这个模型的权限 | 换官方有权限的模型名再试 |
| 流式输出卡顿、断流 | 中间有缓冲代理 | Node 直通无缓冲；若前面套了 nginx，关 `proxy_buffering` |
| `/status` 仍显示官方地址 | 环境变量没生效（旧终端、或被 settings.json 覆盖） | 新开终端，`echo $ANTHROPIC_BASE_URL` 核对 |
| 服务一启动就退出 | `.env` 缺 key 或路径不对 | 看 `journalctl -u claude-relay` 前几行报错 |

---

## 11. 上线前检查清单（逐项打勾）

- [ ] `.env` 权限是 600，真实 key 没进过代码、没进过聊天记录
- [ ] 监听地址不是 `0.0.0.0` 公网裸奔（Tailscale 内网地址，或本机 + Caddy）
- [ ] 错凭证返回 401，对凭证能走到上游 400
- [ ] `/status` 显示自定义 BASE_URL，且一次真实对话能收到回复
- [ ] `systemctl enable` 已设，VPS 重启后服务能自己起来
- [ ] 记下了切换操作：改 `.env` → `systemctl restart claude-relay`，客户端不用动

---

## 最后提醒

1. **动手时机：等账号稳定后再搭。** 现在只看文档、不动手、不申请 key、不改任何配置。
2. **这条是备用。** 平时主力仍是 desktop 直连方案；中转只在主用出问题时切过去，用完可以切回来。
3. **中转救不了被封的号。** 备用的含义永远是“换一把健康的上游 key”，不是“给同一个号加一层壳”。
