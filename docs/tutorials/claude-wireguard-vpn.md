# 给 Claude 配一条美国专线：WireGuard 分流 VPN 搭建全教程

> ⚠️ **v1.4 状态更新（2026-10-09）**：WireGuard 路线已暂停使用。2026-10-08 起，运营商 DPI 连续两次精准拦截 WireGuard 握手（先是 UDP 51820，后是 UDP 443，换端口只续命约 18 小时）；udp2raw 四种伪装模式（faketcp/UDP/ICMP/easy-faketcp）全部试过，均告失败，已从 VPS 彻底移除。**当前主力方案是 VLESS+Reality**（见第 11 节），WireGuard 仅保留作闲置备份。下面第 1–9 节的 WireGuard 搭建步骤依然有效，可作为备用路线参考；第 10 节 udp2raw 已作废，请勿再按其操作。

> 适用人群：Claude 账号频繁被风控、需要稳定美国 IP，但又不想影响现有代理（v2ray / Clash 等）的开发者。
> 效果：只有 Claude 相关流量走美国 VPS，其他所有流量（包括你现有的代理）原样不动。
> 成本：约 $2.62/月（GCP 赠金抵扣后实付 $0）；若按第 2 节切到 Standard Tier，出站前 200 GiB/月免费，基本可降到 $0。

---

## 1. 方案选型：为什么是 WireGuard + 分流

市面上的 VPN 方案大多是"全局代理"——一开全走，用完还得关，很容易和已有的科学上网工具打架。

这篇教程的方案是三个关键设计：

1. **WireGuard 而不是 OpenVPN**：内核级、握手快、配置就一个文件，资源占用极低，e2-micro 这种免费小鸡也跑得动。
2. **分流（Split Tunnel）而不是全局**：客户端 `AllowedIPs` 只写两条——Claude 服务器 IP（`160.79.104.10/32`）和隧道网段（`10.8.0.0/24`）。命中这两条的才走隧道，其余全部走本地默认路由。
3. **不动 DNS**：客户端配置里故意不设 DNS，避免和现有代理的 DNS 规则冲突。

一句话：**精确制导，只打 Claude，不误伤。**

---

## 2. 费用：一个月到底花多少钱

| 项目 | 金额（当时 Billing 截图累计，非完整自然月） |
|---|---|
| Compute Engine（e2-micro, us-west1） | $1.81 |
| Networking（出站流量） | $0.41 |
| VM Manager | $0.40 |
| **合计** | **约 $2.62，被 GCP 赠金抵扣，实付 $0** |

省钱要点：

- （可选）把 VPS 的网络层级切到 **Standard Tier**：每账号每月前 200 GiB 出站免费。Claude 纯文字流量一个月也就 1.5–6 GiB，远够用。（注意：改的是 VM 网卡的 tier，不是项目默认 tier；切换时临时公网 IP 可能会变，改完记得更新客户端配置里的 Endpoint。切换前建议先看 FAQ 里 SSH 的那条——先保证 SSH 能用，再动网络。）
- 建两条**预算告警**（Billing → Budgets）：一条 $5（账号级）、一条 $10（项目级）。预算只告警、不会自动停机，图个安心。

---

## 3. 准备工作

1. 一个 GCP 账号，开一台 Debian 12/13 的 VM，区域选 `us-west1`（俄勒冈，离中国相对近）。
2. GCP 防火墙放行一条规则（VPC network → Firewall → Create）：
   - 名称：`allow-wireguard`
   - 方向：入站，来源 `0.0.0.0/0`
   - 协议端口：`UDP 443`（不要用 WireGuard 默认的 51820：实测中 51820 的回程包曾被运营商拦截，导致两端同时断连 5 小时；443 是 HTTPS/QUIC 端口，基本不会被针对）
3. 记下 VM 的公网 IP（下面用 `<你的VPS公网IP>` 表示）。

---

## 4. 服务端搭建（SSH 连上 VPS，5 步）

```bash
# [1] 安装 WireGuard
sudo apt-get update && sudo apt-get install -y wireguard iptables

# [2] 开启 IPv4 转发（重启后依然生效）
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -w net.ipv4.ip_forward=1

# [3] 生成密钥（服务端一对，每个客户端一对）
umask 077
sudo mkdir -p /etc/wireguard
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey | sudo tee /etc/wireguard/server.pub
wg genkey | tee mac.key | wg pubkey > mac.pub        # Mac 客户端
wg genkey | tee win.key | wg pubkey > win.pub        # Windows 客户端（可选）
```

找出 VPS 的出站网卡名（下面 NAT 规则要用）：

```bash
ip route get 8.8.8.8 | awk '{print $5; exit}'
# 一般是 ens4 或 eth0，记下来，下面用 <出站网卡> 表示
```

写服务端配置 `/etc/wireguard/wg0.conf`：

```ini
[Interface]
Address = 10.8.0.1/24
ListenPort = 443
PrivateKey = <服务端私钥：/etc/wireguard/server.key 的内容>
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o <出站网卡> -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o <出站网卡> -j MASQUERADE

[Peer]
# mac
PublicKey = <Mac 客户端公钥：mac.pub 的内容>
AllowedIPs = 10.8.0.2/32

[Peer]
# windows（如不需要可删掉整段）
PublicKey = <Windows 客户端公钥：win.pub 的内容>
AllowedIPs = 10.8.0.3/32
```

启动并设开机自启：

```bash
sudo chmod 600 /etc/wireguard/wg0.conf
sudo systemctl enable --now wg-quick@wg0
sudo wg show   # 看到 interface wg0 和 peer 即成功
```

---

## 5. 客户端配置（Mac / Windows 分版本详细步骤）

### 5.1 两端通用：先准备好密钥

客户端密钥对建议在**服务端**统一生成（就是第 4 节的 `mac.key` / `win.key`），服务端配置一次写好，不用来回传公钥：

```bash
# 在 VPS 上查看，分别对应填入下面的客户端配置
cat mac.key   # Mac 客户端私钥
cat mac.pub   # Mac 客户端公钥（已填进服务端 wg0.conf 的 [Peer]）
cat win.key   # Windows 客户端私钥
cat win.pub   # Windows 客户端公钥（已填进服务端 wg0.conf 的 [Peer]）
cat /etc/wireguard/server.pub  # 服务端公钥，两端客户端都要用
```

> 备选：WireGuard 各客户端 App 自带"生成密钥对"按钮，也可以在本机生成，再把公钥追加到服务端的 `[Peer]` 段，改完跑 `sudo systemctl restart wg-quick@wg0` 生效。

先解释分流规则的依据：Claude 各域名的 IPv4 解析结果是**同一个 IP**。在 VPS 上跑：

```bash
for d in claude.ai www.claude.ai anthropic.com api.anthropic.com console.anthropic.com; do
  echo "== $d"; dig +short A $d
done
# 实测 A 记录全部返回 160.79.104.10
```

注意两点：① 同一域名还可能解析出 **IPv6 地址**（实测 `api.anthropic.com` 返回过 `2607:6bc0::10`），本教程的分流只覆盖上面的 IPv4；Windows 上如果本机 IPv6 路径不可用，需要做 5.3 节第 6 点的 IPv6 优先级修复。② 如果哪天 Claude 换 IP/加 CDN，见 FAQ 的更新方法。

### 5.2 Mac 详细步骤

1. **安装**：Mac App Store 搜 **WireGuard**（官方免费版），安装并打开。
2. **新建隧道**：点左下角 `+` → **Add Empty Tunnel**（之后也可以"从文件导入"，先按手动填走一遍，理解结构）。
3. **填入配置**（把 `<...>` 换成你的真实值）：

```ini
[Interface]
PrivateKey = <Mac 客户端私钥：mac.key 的内容>
Address = 10.8.0.2/24
# 注意：故意不设 DNS，避免影响你现有的 v2ray / Clash

[Peer]
PublicKey = <服务端公钥：server.pub 的内容>
Endpoint = <你的VPS公网IP>:443
AllowedIPs = 160.79.104.10/32, 10.8.0.0/24
PersistentKeepalive = 25
```

4. 点 **Save**，回到主界面选中该隧道，点 **Activate**。
5. 菜单栏出现 WireGuard 图标即连接成功；点开隧道详情能看到 handshake 时间和累计流量（`Data sent / Data received`）。

### 5.3 Windows 详细步骤

1. **安装**：去 wireguard.com → Download → **Windows Installer**（.msi），一路下一步。弹出"是否允许此应用更改设备"时点"是"。
2. **新建隧道**：打开 WireGuard，点左下角 **Add Tunnel** → **Add empty tunnel**。
3. **处理密钥（二选一）**：
   - **方案 A（推荐，和本教程服务端配套）**：把自动生成的 `[Interface]` 整段删掉，换成下面的配置，用第 5.1 节在服务端生成的 `win.key` 做 `PrivateKey`。
   - **方案 B（本机生成）**：保留自动生成的密钥对，把 `PublicKey` 那行复制下来，追加到服务端的 `/etc/wireguard/wg0.conf` 里作为新的 `[Peer]`，然后服务端执行 `sudo systemctl restart wg-quick@wg0`。
4. **填入配置**（注意 `Address` 用 `10.8.0.3/24`，别和 Mac 的 `.2` 冲突）：

```ini
[Interface]
PrivateKey = <Windows 客户端私钥：win.key 的内容>
Address = 10.8.0.3/24
# 注意：故意不设 DNS，避免影响现有代理

[Peer]
PublicKey = <服务端公钥：server.pub 的内容>
Endpoint = <你的VPS公网IP>:443
AllowedIPs = 160.79.104.10/32, 10.8.0.0/24
PersistentKeepalive = 25
```

5. 点 **Save**，选中隧道点 **Activate**，状态变为 Active 即成功，下方 Status 面板能看到 handshake 和流量统计。
6. **排错**：Windows 防火墙一般会自动放行；如果连不上，先换手机热点测试——能通就是公司/校园网拦截了出站 UDP，不通再查配置。如果隧道显示 Active、能 ping 通 `10.8.0.1`，但 Claude Desktop 报 `can't reach`，看 FAQ 的 IPv6 条目。

### 5.4 分流原理（两端通用，值得看懂）

- `Address`：你在隧道里的内网地址（Mac `.2` / Windows `.3`），和服务端 `10.8.0.1` 同网段。
- `AllowedIPs = 160.79.104.10/32, 10.8.0.0/24`：**只有**发往 Claude 服务器和隧道内网的包才进隧道，其他一律走本地。这是"不影响现有代理"的关键。
- `PersistentKeepalive = 25`：每 25 秒保活，防止 NAT 会话超时断连（Windows 睡眠唤醒后尤其有用）。
- 没有 `DNS = ...`：故意不写，系统 DNS 保持原样，不和现有代理打架。

---

## 6. 验证：证明流量真的走了隧道（三重验证）

配完别急着用，按顺序验证一遍，出问题早发现。

**验证 1：握手（隧道通没通）**

```bash
# 服务端
sudo wg show
# 看到 peer 下有 "latest handshake: X seconds ago" 即成功
```

**验证 2：路由（分流生没生效）**

开关隧道各跑一次，对比：

Mac：

```bash
netstat -rn | grep 160.79.104.10
# 开隧道：160.79.104.10 ... utunX       （走了 WireGuard 虚拟网卡）
# 关隧道：160.79.104.10 ... 192.168.x.1 （走了本地默认网关）
```

Windows（PowerShell）：

```powershell
Get-NetRoute -DestinationPrefix "160.79.104.10/32" | Format-Table DestinationPrefix, NextHop, InterfaceAlias
# 开隧道：InterfaceAlias 显示 WireGuard 隧道网卡
# 关隧道：InterfaceAlias 显示 Wi-Fi / 以太网
```

这一步证明了分流是精确的：开和关，行为完全可预期。

**验证 3：位置 + 流量（Claude 看到的是不是美国 IP）**

1. 打开 Claude Desktop → 设置 → 登录会话，位置应显示 **The Dalles, Oregon, US**（us-west1 机房所在地）。
2. 发几句话给 Claude，然后回服务端看：`sudo wg show` 里该 peer 的 `transfer` 计数在增长（比如从几百字节涨到几 KiB）。
3. WireGuard 客户端 App 里的 `Data sent / Data received` 是累计值，平时自己就能随时验证。

三重验证全过，这条专线就算正式可用了。

---

## 7. 日常使用规范（血泪经验）

1. **用 Claude 前先确认隧道连着**。隧道关了，请求就走本地直连，美国 IP 保护即失效。
2. **代理和隧道是互斥的**：如果终端里设了 `HTTPS_PROXY`，应用层的流量会改走代理、不再进隧道。所以——Claude 相关命令**不要**配代理；需要代理的命令（如 `gcloud` 调 Google API）**单独加**代理前缀，不要全局 export。
3. 进阶玩法可以做两个 shell 函数分开场景（以 Claude Code 为例）：

```bash
ccn() {  # 原生账号：靠 WireGuard，强制清掉代理变量
  env -u CLAUDE_CODE_USE_VERTEX -u ANTHROPIC_VERTEX_PROJECT_ID -u CLOUD_ML_REGION \
      -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy \
  claude "$@"
}
```

`env -u` 的意思是"删掉这个环境变量再执行"，只影响这一次运行，不动你的 shell。

---

## 8. 常见问题 FAQ

**Q：Claude 的域名 IP 变了怎么办？**
分流依赖 `160.79.104.10` 这个精确 IP。如果哪天 Claude 换 IP/加 CDN，隧道会"打空"。修复：在 VPS 上重跑第 5 节的 `dig` 命令，把新的 IP 更新到客户端配置的 `AllowedIPs` 里。建议每隔几个月检查一次。

**Q：隧道是通的（能 ping 通 10.8.0.1），但 Windows 上 Claude Desktop 报 `can't reach`？**
这是 Windows 的 IPv6 优先级问题：`api.anthropic.com` 会同时解析出 IPv6 地址（如 `2607:6bc0::10`），Windows 优先走 IPv6，而很多机器的 IPv6 路径是坏的（`ping -6` 直接失败）。修复：用**管理员** PowerShell 执行下面这条（永久生效，让 IPv4 优先），然后重启 Claude Desktop：

```powershell
netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 46 4
```

**Q：隧道两端突然都连不上了（握手一直失败），但服务端看着是好的？**
先在服务端抓包定位：`sudo tcpdump -i <出站网卡> udp port 443 -c 10`，同时在客户端重连一次。如果能看到客户端的握手请求进来、服务端的响应也发出去了，但客户端始终握不上，就是回程 UDP 被运营商/国际出口针对了。解法：把 WireGuard 端口换到 **UDP 443**（服务端 `ListenPort`、防火墙规则、客户端 `Endpoint` 三处一起改，重启 `wg-quick@wg0` 生效）。2026-10-08 实测：默认的 51820 回程被拦导致两端断连 5 小时，换 443 后立刻恢复。

**2026-10-09 更新**：UDP 443 的回程也被掐了（Mac 约 10:30、Windows 约 09:55 同时断，tcpdump 证据确凿：请求进、响应出，但客户端永远收不到）。443 是 QUIC/HTTPS 端口，不可能按端口封——这说明针对的已经不是端口，而是 WireGuard 本身（握手包特征 / 7×24 小时 UDP 流）。**换端口只能续命**（51820→443 只活了 18 小时）。根治方案见第 10 节：udp2raw 伪装层。

**Q：Standard Tier 切换后连不上了？**
切换网络层级时临时公网 IP 很可能变化。去 GCP 控制台确认新 IP，更新客户端 `Endpoint`，并检查防火墙规则还在。

**Q：SSH 突然连不上 VPS（Permission denied）？**
先确认连的是不是同一台机器（host key 对得上就是）。大概率是控制台动过设置导致 `authorized_keys` 丢了 key，用 GCP 网页版 SSH 进去，把公钥加回去。

**Q：隧道开了，但 Claude 还是慢？**
这是跨太平洋物理延迟，正常现象（几十毫秒）。分流方案下只有 Claude 流量受影响，刷网页、看视频都不走隧道，无感。

---

## 9. 安全提醒（必读）

- **私钥绝不公开**：`server.key`、各客户端 `.key` 只存本地，权限 `600`，不要进 git、不要截图发出来。本教程所有 `<...>` 占位符，发布时用你自己的真实值替换，但**只发给自己的设备**。
- 公钥（`.pub`）可以公开，它只能用来"认出"你，不能用来冒充你。
- VPS 的 SSH 建议禁用密码登录、只留密钥（GCP 默认即如此）。

## 10. 伪装层：udp2raw（⚠️ 已作废，2026-10-09 晚）

> **本节已作废**：udp2raw 四种模式（TCP faketcp、UDP、ICMP、easy-faketcp）全部实测失败——DPI 掐 UDP 回程、内核对伪造 TCP 发 RST、ICMP 握手走不通。已从 VPS 彻底移除（`systemctl disable udp2raw` + 删二进制 + 删 service 文件）。保留下文仅作踩坑记录，请勿再按此操作。

**背景**：2026-10-09 上午，Mac（约 10:30）和 Windows（约 09:55）两端同时握手失败。服务端 `tcpdump` 显示每个握手请求都有响应发出，但客户端永远收不到——**UDP 443 的回程也被掐了**。443 是 QUIC/HTTPS 的端口，不可能按端口封还不误伤别人，说明链路已经能认出 WireGuard 本身（握手包的字节特征，或这条 7×24 小时的 UDP 流被盯上了）。教训：**再换 UDP 端口只是续命**（51820→443 只活了 18 小时）。

**原理**：udp2raw 把 WireGuard 的 UDP 包裹进 fake-TCP，发往 443 端口。链路上看到的只是普通的 TCP 443 流量（形似 HTTPS），DPI 认不出里面的 WireGuard 握手。WireGuard 本体一行配置都不用改。

```
[Mac/Win 的 WireGuard] --UDP--> [本机 udp2raw 127.0.0.1:51820] --fake-TCP 443--> [VPS 的 udp2raw] --UDP--> [VPS 本机 WireGuard]
```

三处（服务端、Mac、Windows）用**同一个密码**——自己定一个强密码，地位等同于密钥，不要公开。下面命令里的 `"你的密码"` 全部替换成它。

### 10.1 服务端（GCP 网页 SSH，Debian）

```bash
# 先确认 TCP 443 没被占用（应无输出）
sudo ss -tlnp | grep ':443 '

# 下载安装
cd /tmp
curl -sL https://github.com/wangyu-/udp2raw/releases/download/20230206.0/udp2raw_binaries.tar.gz -o u2r.tgz
tar xzf u2r.tgz udp2raw_amd64
sudo install -m 755 udp2raw_amd64 /usr/local/bin/udp2raw

# 开机自启
sudo tee /etc/systemd/system/udp2raw.service > /dev/null <<'EOF'
[Unit]
Description=udp2raw fake-tcp tunnel for WireGuard
After=network.target

[Service]
ExecStart=/usr/local/bin/udp2raw -s -l0.0.0.0:443 -r127.0.0.1:443 --raw-mode faketcp -k "你的密码" -a
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now udp2raw
systemctl is-active udp2raw   # 应输出 active
```

注意：udp2raw 用 raw socket 工作，`ss` 里看不到监听端口，`active` 即正常。`-a` 会自动加 iptables 规则（防止内核发 RST 干扰伪装的 TCP 包）；如果它报错，再单独处理。WireGuard 服务端**不用动**（继续监听 UDP 443，udp2raw 把解开的包交到本机 127.0.0.1:443）。

GCP 防火墙：放行 **TCP 443**（编辑已有的 `allow-wireguard` 规则，加上 `tcp:443`，或新建一条规则）。如果之前截图里那条 `all-open` 规则还在，这步可跳过。

### 10.2 Mac 端

1. 下载 https://github.com/wangyu-/udp2raw-multiplatform/releases/download/20230206.0/udp2raw_mp_binaries.tar.gz ，解压后按芯片二选一：`udp2raw_mp_mac`（Intel）或 `udp2raw_mp_mac_m1`（Apple Silicon，左上角苹果菜单 → 关于本机 可查）：

```bash
chmod +x udp2raw_mp_mac_m1
xattr -d com.apple.quarantine udp2raw_mp_mac_m1   # 过 Gatekeeper，否则打不开
```

2. 先手动跑起来验证（需要 sudo，raw socket 要 root；看到输出不报错即正常）：

```bash
sudo ./udp2raw_mp_mac_m1 -c -l127.0.0.1:51820 -r34.83.76.40:443 --raw-mode faketcp -k "你的密码"
```

3. WireGuard App 里编辑 `claude-us-mac`：Peer 的 `Endpoint` 改为 `127.0.0.1:51820`，`[Interface]` 段加一行 `MTU = 1280`（隧道套隧道，降一点 MTU 防分片）。Latest handshake 变成几秒前、`ping 10.8.0.1` 通，即成功。
4. 验证通过后，Ctrl+C 停掉手动的，设开机自启。新建 `/Library/LaunchDaemons/com.user.udp2raw.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.user.udp2raw</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/udp2raw_mp_mac_m1</string>
        <string>-c</string><string>-l127.0.0.1:51820</string>
        <string>-r34.83.76.40:443</string>
        <string>--raw-mode</string><string>faketcp</string>
        <string>-k</string><string>你的密码</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
sudo cp udp2raw_mp_mac_m1 /usr/local/bin/
sudo launchctl load /Library/LaunchDaemons/com.user.udp2raw.plist
```

### 10.3 Windows 端

1. 同样下载 multiplatform 包，取 `udp2raw_mp.exe`，放到 `C:\udp2raw\`。
2. **管理员** PowerShell 先手动验证（看到输出不报错即正常）：

```powershell
C:\udp2raw\udp2raw_mp.exe -c -l127.0.0.1:51820 -r34.83.76.40:443 --raw-mode faketcp -k "你的密码"
```

3. WireGuard 里编辑隧道：`Endpoint` 改为 `127.0.0.1:51820`，`[Interface]` 加 `MTU = 1280`。握手成功、能 ping 通 10.8.0.1 即可。
4. 关掉手动的 PowerShell 窗口，设开机自启：任务计划程序 → 创建任务 → 触发器选"启动时" → 操作填 `"C:\udp2raw\udp2raw_mp.exe" -c -l127.0.0.1:51820 -r34.83.76.40:443 --raw-mode faketcp -k "你的密码"` → 勾选"使用最高权限运行"和"不管用户是否登录都要运行"。

### 10.4 验证伪装生效

服务端抓包应该只看到 **TCP**（不再是 UDP）：

```bash
sudo timeout 20 tcpdump -i any tcp port 443 -c 6
```

能看到 TCP 包即伪装层工作正常。之后如果隧道再出问题，先看三处的 udp2raw 进程在不在（`ps` / 任务管理器 / `launchctl list | grep udp2raw`），再按第 8 节的 FAQ 排查。

**启动顺序不用焦虑**：udp2raw 和 WireGuard 谁先谁后都行——WireGuard 有 25 秒 keepalive，会自己重连，udp2raw 起来后隧道自动恢复。

---

## 11. 当前主力方案：VLESS+Reality（2026-10-09 起）

WireGuard 被 DPI 连续拦截后，切到 VPS 上已有的 sing-box 的 **VLESS+Reality**（TCP 38480），实测延迟约 296ms（中国→俄勒冈，正常水平）。

**为什么选它**：
- Reality 伪装成正常 TLS 流量，没有 WireGuard 那种可识别的握手特征，DPI 难以针对
- sing-box 本来就在 VPS 上跑着，零新增成本
- 客户端用 v2rayN / Nekoray / Streisand 等，导入链接即用

**分流原则不变**：只让 Claude 相关流量走这条专线，其他流量（包括原有 v2ray 代理）原样不动。具体做法是在客户端做路由规则，只把 `anthropic.com` 相关域名和 API IP 指向 VLESS 出站。

**WireGuard 的去留**：`wg0`（UDP 51820）保持 active 作闲置备份，配置文件保留。万一哪天 VLESS 也出问题，WireGuard 随时可启用——毕竟它的分流配置和密钥都在，只是当前不走流量。

**一个未解的疑问**：之前 Claude 账号被封时，用的可能就是这台 VPS 的 IP（`34.83.76.40`）。如果封号是绑 IP 的，换协议也救不了，届时得换一台 VPS。这是下一步要验证的。

---

*教程 v1.4，2026-10-12。v1.4 修订：顶部增加状态声明（WireGuard 暂停、VLESS+Reality 为当前主力）；第 10 节 udp2raw 标记作废（四种模式全灭、已从 VPS 移除）；新增第 11 节 VLESS+Reality。v1.3 修订见原文末尾。如有问题欢迎留言。*
