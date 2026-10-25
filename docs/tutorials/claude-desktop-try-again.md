# Claude 桌面版白屏「Can't reach / Try again」：两轮根因、诊断与改法

> 适用场景：Mac 上 Claude Desktop 打开后整页白屏，文案是 `Can't reach Claude. Check your connection.`，按钮是 `Try again`。同一条专线代理下，Chrome 里的网页版有时还能开。
>
> ✅ **状态：已沉淀（2026-10-25）**。专线本身怎么搭，见 [Claude 专线全记录](./claude-wireguard-vpn.md)（当前方案是第 12 节 Tailscale 内网代理，§12.5 是 PAC 补丁，§12.6 是三代方案怎么选）。本文只讲桌面壳层白屏：先分清是 PAC 把验证流量漏给了本机 v2ray，还是 Electron 过不了 Cloudflare，再按顺序改。

---

## 1. 先看清这张白屏

典型画面：

- 窗口白底，中间一行 `Can't reach Claude`
- 下面是 `Check your connection.`，加一个蓝色 `Try again`
- 再点 `Try again`、从 Dock 或启动台重开，画面不变

两件容易看错的事：

1. **专线出口是通的。** 用 Tailscale HTTP 代理 `http://<VPS内网IP>:18080` 去 `curl`，返回的是预期的美国出口 `<VPS公网IP>`；Chrome 用同一代理也能打开 Claude 登录页。桌面照样白屏。
2. **这和封号页不是同一张皮。** 组织被停用时，文案通常是 Organization disabled / Usage Policy，不会停在 `Can't reach`。

记一句再往下排：**出口 IP 正确，只说明专线进程活着；桌面 Electron 的主视图（mainView）还可以单独卡在 Cloudflare 上。**

---

## 2. 两轮根因，先对上你卡在哪一轮

```text
白屏 Try again
        │
        ▼
curl -x http://<VPS内网IP>:18080  出口是美国 IP？
        │
     否 ┴ 是
     │     │
     ▼     ▼
 先修专线   lsof：Claude → 本机 v2ray（10808）是否为 0？
（Tailscale /        │
 sing-box）     否 ┴ 是，且已有连到 18080
                │     │
                ▼     ▼
         历史根因 §12.5    本轮根因
         子会话漏进 v2ray   Electron 没有 cf_clearance
```

端口 `10808` 是作者本机 v2ray 的 HTTP 口，下面都用这个数字；你的端口不同，命令里换成你自己的。`<VPS内网IP>` 是 VPS 在 Tailscale 里的 `100.x` 地址，`<VPS公网IP>` 是这台 VPS 的出口，都不要写进公开笔记。

### 2.1 历史主因：`--proxy-server` 只管主页面（§12.5，2026-10-23）

**表象**：Raycast「Claude Proxy」已经带了 `--proxy-server=http://<VPS内网IP>:18080`，主页面看起来在走专线，仍会偶尔白屏。关掉本机 v2ray 后更明显。`lsof` 里除了到 `18080` 的连接，还有零星连接去 `127.0.0.1:10808`。

**机制**：桌面是 Chromium。启动参数 `--proxy-server` 只约束主页面。人机验证、支付、错误上报和统计跑在别的会话分区里，读的是 **macOS 系统代理的 PAC**。旧 PAC 只把 `claude.ai` / `claude.com` / `anthropic.com` 送进 `18080`，其余一律 `PROXY 127.0.0.1:10808`。v2ray 一抖或一关，这些请求失败，主视图跟着白屏。

当时漏出去的域名：

| 用途 | 域名 |
|---|---|
| 人机验证 | `hcaptcha.com`、`challenges.cloudflare.com` |
| 支付 | `stripe.com`、`stripecdn.com`、`stripe.network` |
| 上报 / 统计 / 客服 | `sentry.io`、`statsig.com`、`statsigapi.net`、`featuregates.org`、`intercom.io`、`intercomcdn.com`、`intercomassets.com`、`segment.io`、`segment.com` |

VPS 上 `sing-box-ts` 的日志在白屏前后可以完全干净：那些失败请求根本没进专线。日志安静不能证明桌面没问题。

### 2.2 本轮：出口正常，Electron 过不了 Cloudflare（2026-10-25）

**表象**：PAC 已按 §12.5 补全，`lsof` 里 Claude → `10808` 为 0、→ `18080` 有连接，`curl` 出口正确，网页同代理能开，桌面仍是 `Try again`。

**机制**：mainView 要通过 Cloudflare 挑战，才会留下可用的 `cf_clearance`。本轮桌面 Cookie 里常见只有 `__cf_bm`，没有 `cf_clearance`。挑战停在壳层里，页面就一直是「Can't reach」。专线进程并没有挂。

两轮对照：

| | §12.5 PAC 泄漏 | 本轮 Electron / Cloudflare |
|---|---|---|
| `curl` 出口 | 主路可能是对的，旁路在抖 | 一直是预期的美国 IP |
| `lsof` → `10808` | 有连接 | 应为 0 |
| `lsof` → `18080` | 有，同时夹着 10808 | 有 |
| 同代理的网页 | 也可能一起抖 | 往往能开登录页 |
| Cookie | 不看这个 | 有 `__cf_bm`，没有 `cf_clearance` |

先跑完第 3 节的四条命令，再决定改 PAC 还是做后面的 A/B。两轮混着治，会把已经走对的专线改乱。

---

## 3. 诊断顺序

在 Mac 上按这个顺序跑。每一条都是只读的。

### 3.1 专线通不通

```bash
curl -x http://<VPS内网IP>:18080 -sS --max-time 15 https://api.ipify.org
echo
tailscale status | head
```

第一行应是 `<VPS公网IP>`。`tailscale status` 里 VPS 那一行应在线。对不上就先修 Tailscale 登录和 VPS 上的 `sing-box-ts`，先别动桌面 Cookie。

### 3.2 这个进程是不是带代理启动的

```bash
ps eww -o pid,command -p "$(pgrep -f '/Applications/Claude.app' | head -1)" \
  | tr ' ' '\n' \
  | grep -E 'proxy-server|PROXY|disable-webrtc|disable-quic' || true
```

命令行里要有 `--proxy-server=http://<VPS内网IP>:18080`。没有的话，多半是 Dock、启动台，或自动更新之后自己拉起来的进程。完全退出，再用第 4 节的启动器开。

`--disable-webrtc` / `--disable-quic` 可以有，也可以没有。它们的用途在第 4.3 节，缺了它们不等于这次白屏的原因。

### 3.3 有没有漏到本机 v2ray

```bash
lsof -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null | grep -i claude | grep 10808 || echo "OK: no 10808"
lsof -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null | grep -i claude | grep 18080 || echo "WARN: no 18080 yet"
```

稳定之后的目标：**10808 零条，18080 有若干条。** 刚启动时可能残留一两条 10808，过一会儿会自己消失；隔一两分钟再看一次。10808 一直在，就做第 4.1 节，不要先去猜 Cloudflare。

### 3.4 桌面 Cookie 里有没有 clearance

数据目录在 `~/Library/Application Support/Claude/`。本轮的模式是：挑战相关 Cookie 只有名字为 `__cf_bm` 的那条，没有 `cf_clearance`。

看名字即可。**不要把 Chrome 里的 `cf_clearance` 拷进桌面**——值会被丢掉，白屏还在，目录里多一堆对不上的 Cookie。桌面也不接受 `--remote-debugging-port`，这条路不用试。

---

## 4. 改法

短时间反复退出、重开、连点 `Try again`，会在同一个出口上留下一串失败记录。一轮诊断，至多一次有目的的重开，然后停下来看结果。

### 4.1 补 PAC，并给启动脚本注入代理（§12.5 的有效改法）

系统设置 → 网络 → 代理 → 自动代理配置，指向的文件是 `~/claude-proxy.pac`。先备份再改：

```bash
cp ~/claude-proxy.pac ~/claude-proxy.pac.bak-20261023
```

PAC 把 Claude 自己的域名，加上第 2.1 节那张表里的第三方域名，都指到专线。Google（例如 `pay.google.com`）**故意不加**，避免整包 Google 流量被拉进专线。

```javascript
function FindProxyForURL(url, host) {
  var ts = ["claude.ai","claude.com","anthropic.com","claudeusercontent.com",
    "hcaptcha.com","challenges.cloudflare.com",
    "stripe.com","stripecdn.com","stripe.network",
    "sentry.io","statsig.com","statsigapi.net","featuregates.org",
    "intercom.io","intercomcdn.com","intercomassets.com",
    "segment.io","segment.com"];
  for (var i = 0; i < ts.length; i++) {
    var d = ts[i];
    if (host == d || dnsDomainIs(host, "." + d)) return "PROXY <VPS内网IP>:18080";
  }
  return "PROXY 127.0.0.1:10808";
}
```

`host == d || dnsDomainIs(host, "." + d)` 同时盖住主域名和子域名，又不会误伤 `xxclaude.ai` 这种名字。兜底仍走 v2ray：Claude 内置浏览器里打开的普通网站继续走原来的代理，这是有意的。两条路如果出口 IP 相同，这次改动不会让 Claude 看到 IP 变化。

Raycast 脚本 `claude.sh` 在 `#!/bin/bash` 下一行加上代理环境变量，让桌面里内置的 Claude Code、插件等子进程也走专线：

```bash
cp claude.sh claude.sh.bak-20261023
```

```bash
#!/bin/bash
export HTTPS_PROXY=http://<VPS内网IP>:18080 HTTP_PROXY=http://<VPS内网IP>:18080 NO_PROXY=localhost,127.0.0.1
# 后面保持你原来的退出 + open -a "Claude" --args --proxy-server=...
```

大小写两套都可以写上（`http_proxy` / `https_proxy`），和专线文第 12.2 节的 CLI 函数同一习惯。**不要**把这些变量写进 `~/.claude/settings.json` 的 `env`，那会让所有会话都吃到这条代理。

两处都改完之后：

1. 菜单里 Quit，确认没有残留的 Claude 进程。Dock、启动台、`open -a Claude`（不带参数）都不会带上 `--proxy-server`。
2. **只开一次** Raycast「Claude Proxy」，或执行带上述环境变量的 `claude.sh`。
3. 等 30–60 秒，再跑第 3.3 节的 `lsof`。10808 为 0、18080 有连接，这一轮的改法就落地了。

回滚是把备份拷回去，再按同样方式完全退出、启动一次：

```bash
cp ~/claude-proxy.pac.bak-20261023 ~/claude-proxy.pac
cp claude.sh.bak-20261023 claude.sh
```

### 4.2 10808 已经是 0，仍白屏：只重开一次

PAC 和 `lsof` 都已经符合 4.1 的结果时，不要再改 PAC。

1. 完全退出。
2. 只用带代理的启动器开一次。
3. 等 30–60 秒，看主视图是否变成登录页或会话页。
4. 仍白屏，做下面的 A/B **一次**。做完无论成败，都停手。

网页若停在 Cloudflare 的 “Just a moment”，可以多等一会儿或刷新一次。那只说明同出口下浏览器有机会过挑战，桌面壳层不一定跟着过。

### 4.3 A/B：临时去掉 WebRTC / QUIC 开关

部分启动脚本在 `--proxy-server` 后面还加了：

```bash
open -a "Claude" --args \
  --proxy-server="http://<VPS内网IP>:18080" \
  --disable-webrtc \
  --disable-quic
```

这两项挡住 WebRTC 和 QUIC 把本机真实 IP 漏出去。它们不负责通过 Cloudflare。2026-10-23 附近一次能打开的启动参数里，常常只有 `--proxy-server`。个别环境下多出来的两项会干扰 Electron 拿 clearance，所以值得做一次对照，做完要能退回去。

1. 再备份一份当前脚本：`cp claude.sh claude.sh.bak-ab`。
2. 临时删掉 `--disable-webrtc` 和 `--disable-quic`，**留下** `--proxy-server`。
3. 完全退出，只开一次。
4. 主视图起来了：把这次改动留在脚本里，并接受「防泄漏参数目前没开」这件事；之后若要加回，再观察是否重新白屏。
5. 仍然白屏：**立刻** `cp claude.sh.bak-ab claude.sh`，再按原参数启动一次。不要在失败的脚本上继续叠别的 Chromium 参数。

### 4.4 今天先用网页把活干完

同代理下的 Chrome 独立 profile（单独的 Claude Login 窗口）往往能过 Cloudflare。桌面修好之前，用它继续工作。

1. 用带同一个 `18080` 代理的脚本打开这个 profile。
2. 登录选 **Continue with email**。这个 profile 若曾经用个人 Google 登录过，点 Continue with Google 可能绑回旧组织。
3. 邮箱里的魔法链接：复制 URL，粘贴进**同一个**已经挂着代理的窗口。在邮件客户端里直接点，会进日常浏览器，代理和 profile 都丢。

### 4.5 再往上才是住宅 IP / 指纹浏览器

网页同代理也过不了挑战、桌面 A/B 也还原了，才考虑美区住宅出口或指纹浏览器。那是验证卡死时的下一级，要换出口、看成本和指纹策略，**不是**日常白屏的第一招。本轮这种「`lsof` 已干净、网页还能开」的情况，停在 4.4 即可。

---

## 5. 这些做法可以停

| 做法 | 结果 |
|---|---|
| 从 Chrome 复制 `cf_clearance` 到桌面 | 值会被丢掉 |
| 给桌面加 `--remote-debugging-port` | App 直接拒绝 |
| `--proxy-server` 指到 VLESS 端口（专线文里的 `:38480`） | 那不是 HTTP 代理，壳层用不了 |
| Dock / 启动台 / 更新后自动拉起 | 进程不带 `--proxy-server`，流量回到 `10808` |
| 旧 PAC 只放行 claude / anthropic | hCaptcha、Cloudflare challenge、stripe、sentry、statsig、intercom、segment 继续漏到 v2ray |
| 短时间循环强制退出再启动，用来「看看好了没有」 | 刚恢复的会话会被杀掉，失败记录变密 |

每次更新之后，桌面会自己重启且不带代理参数。用第 4.1 节的启动器再开一次。更新本身不用改 PAC。

---

## 6. 下次白屏按这个顺序

1. `curl -x http://<VPS内网IP>:18080 https://api.ipify.org` 是否为 `<VPS公网IP>`；`tailscale status` 里 VPS 是否在线。不通就修通道。
2. 进程命令行里有没有 `--proxy-server=…:18080`。没有就 Quit，只用启动器开一次。
3. `lsof`：Claude → `10808` 是否为 0，→ `18080` 是否有连接。有泄漏就做 4.1，然后重新数一遍。
4. 10808 已是 0 仍白屏：A/B 一次去掉 `--disable-webrtc` / `--disable-quic`。失败立刻还原。
5. 还要干活：网页独立 profile，Continue with email，魔法链接贴回同一窗口。
6. 住宅出口 / 指纹浏览器留到网页也过不了挑战的时候。VLESS Reality 仍是专线文里的备用通道，不要未经确认就把它的端口填进 `--proxy-server`。

---

## 7. 修好之后怎么确认

用只读命令留证：`ps` 看启动参数，`lsof` 数 10808 和 18080，`curl -x` 看出口。这三样足够说明「现在这条进程走的是专线」。

不要为了再确认一次，把已经能用的进程杀掉重开。需要看它会不会被更新冲掉时，等下一次真实更新，再用启动器拉起，然后重跑上面三条。排查当中不要挂一个自动 kill / relaunch 的循环。

---

## 8. 和切号有关的边界

白屏经常和「换了个号」叠在一起，两件事分开处理：

- 被封禁组织里的云端聊天，新号桌面不会官方接管。
- 本机 Claude Code 的 `~/.claude/projects/**/*.jsonl` 可以只读摘出摘要，贴进新号会话里续写。不要把旧号的 session、Cookie、指纹写回新的桌面 profile。
- 独立 Login profile 里若登过个人 Google，桌面和网页都走 **Continue with email**。

切号后侧边栏会话怎么搬，见 [Claude 多账号切换且不丢会话](./claude-multi-account-switch.md)。

---

## 9. 最小检查表

- [ ] `curl -x http://<VPS内网IP>:18080 https://api.ipify.org` 是 `<VPS公网IP>`
- [ ] 进程命令行含 `--proxy-server=http://<VPS内网IP>:18080`
- [ ] `lsof`：Claude → `10808` 为 0，→ `18080` 有连接
- [ ] 这一轮只完全退出并用启动器开过一次，没有连点 `Try again`
- [ ] 做了 WebRTC/QUIC 的 A/B 时留了 `claude.sh.bak-ab`，失败已拷回
- [ ] 要继续干活时，网页兜底可用；没有从 Chrome 拷 Cookie，也没有点 Google SSO

---

## 10. 延伸阅读

- [Claude 专线全记录](./claude-wireguard-vpn.md) — 搭 Tailscale 内网代理；§12.5 是本文 4.1 的原始记录，§12.6 是 WireGuard / VLESS / Tailscale 怎么选
- [Claude 多账号切换且不丢会话](./claude-multi-account-switch.md) — Desktop / Code 切号与侧边栏索引

---

*记录于 2026-10-25。地址一律用 `<VPS内网IP>`、`<VPS公网IP>` 占位；本机 v2ray 端口按作者环境写作 `10808`。Cookie 只写名字（`__cf_bm`、`cf_clearance`），不写值。*
