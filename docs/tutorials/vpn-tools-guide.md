# VPN / 代理工具科普：Tailscale、WireGuard、V2Ray、Clash、EasyConnect、Shadowsocks

> 写于 2026-10-18，2026-10-18 晚扩写为透彻版。
> 2026-10-21 扩补：新增「网络层级」专节、为每个工具补了一个真实场景案例、加入两幅动画示意图。
> 适合：被这些名字绕晕过的人；想一次搞懂"它们分别是什么、原理是什么、该用哪个"的人。

网上教程里这些名字经常混着出现："用 Clash 配 V2Ray 节点"、"公司让装 EasyConnect"、"Tailscale 组个内网"……
其实它们分属三类完全不同的东西，解决三个不同的问题。**先分清问题，再看工具，原理自然就通了。**

---

## 一、总览：三个问题，三类工具

| 你想解决的问题 | 工具类别 | 代表 |
|---|---|---|
| 从国内访问境外网站（出网） | 翻墙代理 | Shadowsocks、V2Ray |
| 管理多个代理节点、按规则分流 | 代理客户端（规则引擎） | Clash |
| 把自己的多台设备连成一个内网 | 组网 VPN | WireGuard、Tailscale |
| 在家访问公司内网 | 企业 SSL VPN | EasyConnect（深信服） |

再补一个技术维度——它们工作在网络的不同层级：

| 工具 | 本质 | 工作层级 | 要不要自己的服务器 | 开源/闭源 |
|---|---|---|---|---|
| Shadowsocks | 代理协议 | 应用层（SOCKS5） | 要（境外 VPS） | 开源 |
| V2Ray | 代理平台 | 应用层 | 要（境外 VPS） | 开源 |
| Clash | 代理客户端/规则引擎 | 应用层（TUN 接管） | 不要（用现成节点） | 开源 |
| WireGuard | VPN 协议 | 网络层（L3 隧道） | 要（任意 VPS） | 开源 |
| Tailscale | 组网服务（基于 WireGuard） | 网络层 | 不要 | 客户端开源、控制面闭源 |
| EasyConnect | 企业 SSL VPN | 传输层（SSL/TLS 隧道） | 公司提供 | 闭源商业 |

---

## 二、先搞懂三个核心概念：VPN、代理、组网

### VPN vs 代理：一句话区分

- **VPN**：在网络层建一条**加密隧道**。隧道建好后，你的设备就像"搬进"了隧道另一端所在的网络，
  整台设备的流量（所有应用）都能走进去，对应用透明。
- **代理**：在应用层做**流量转发**。应用把请求交给代理，代理替你去取回来。
  一般只接管你指定的应用，或按规则决定哪些走代理、哪些直连。

打个比方：VPN 是给你修了一条**专属隧道**，车（所有流量）都从隧道走；
代理是请了一个**代购**，你把购物清单（指定的请求）给他，他买回来交给你。

### 组网是 VPN 的另一种用法

"翻墙"和"组网"用的可能是同一种 VPN 技术，但目的相反：

- **翻墙**：隧道通向**别人的网络**（境外服务器），借它的出口上网。
- **组网**：隧道连的是**自己的设备**（家里的 NAS、云服务器、手机），组成一个虚拟局域网，
  设备之间用内网 IP 直接互访，不经过公网暴露端口。

理解了这一层，后面每个工具的定位就不会乱了。

---

## 三、网络层级：每个工具在哪一层"动手脚"

上一节分清了"隧道 vs 代理"，这一节再往下钻一层：**网络通信本身是分层的，每个工具只在其中某一层（或几层）做文章**。
搞懂这一节，后面所有工具的"为什么能伪装、为什么能分流、为什么会被 DPI 认出来"，都有了统一的解释。

### 先用寄快递理解四层模型

工程上把网络通信拆成层（常说的 TCP/IP 四层模型；教科书里的 OSI 七层是它的细化版，理解工具用四层足够）。
拿寄快递打比方：

- **应用层——"寄什么、寄给谁"**：你写的信、要寄的货本身，还有内容是写给谁的。
  对应到上网，就是浏览器、聊天软件、命令行工具产生的数据（一个网页请求、一句命令）。
- **传输层——"打包、编号、保完整"**：把货物分箱、贴上箱号，保证到齐、能按顺序拼回去，丢了还能重发。
  对应的就是 TCP（可靠、按序）和 UDP（快、不保证）；端口号也住在这一层，相当于注明"交给收件人家的哪个部门"。
- **网络层——"写地址、定路线"**：包裹上写明收发地址（IP 地址），沿途每个分拨中心（路由器）只看地址、决定下一站往哪送。
  它只管"送到那台机器"，不关心箱子里装了什么。
- **链路层——"每一程的具体运输"**：这一程用卡车、下一程换飞机——只负责相邻两点之间的这一小段
  （你的电脑到路由器走 Wi-Fi，路由器往外走光纤）。每换一程，运输工具就换一次，但里面的箱子不动。

发送时数据**自上而下逐层封装**：每过一层，就被套上一层"外套"（那一层的头部信息）；
到了对端再**自下而上逐层解封装**，一层层脱掉，最后应用层拿到原始数据。整个旅程画成动画是这样：

<!-- 动画一：分层封装 / 解封装。纯内联 SVG + CSS，自包含无外部依赖 -->
<svg viewBox="0 0 660 330" style="width:100%;height:auto;display:block;margin:12px auto" role="img" aria-label="数据包分层封装动画">
  <style>
    .a1pkt { animation: a1pkt 9s ease-in-out infinite; }
    .a1fT { animation: a1fT 9s linear infinite; opacity: 0; }
    .a1fN { animation: a1fN 9s linear infinite; opacity: 0; }
    .a1fL { animation: a1fL 9s linear infinite; opacity: 0; }
    @keyframes a1pkt {
      0% { transform: translate(170px, 16px); opacity: 1; }
      10% { transform: translate(170px, 56px); opacity: 1; }
      20% { transform: translate(170px, 116px); opacity: 1; }
      30% { transform: translate(170px, 176px); opacity: 1; }
      40% { transform: translate(170px, 236px); opacity: 1; }
      55% { transform: translate(490px, 236px); opacity: 1; }
      65% { transform: translate(490px, 176px); opacity: 1; }
      75% { transform: translate(490px, 116px); opacity: 1; }
      85% { transform: translate(490px, 56px); opacity: 1; }
      92% { transform: translate(490px, 16px); opacity: 1; }
      96% { transform: translate(490px, 16px); opacity: 0; }
      97% { transform: translate(170px, 16px); opacity: 0; }
      100% { transform: translate(170px, 16px); opacity: 1; }
    }
    @keyframes a1fT { 0%, 24% { opacity: 0; } 30%, 76% { opacity: 1; } 82%, 100% { opacity: 0; } }
    @keyframes a1fN { 0%, 34% { opacity: 0; } 40%, 66% { opacity: 1; } 72%, 100% { opacity: 0; } }
    @keyframes a1fL { 0%, 44% { opacity: 0; } 50%, 56% { opacity: 1; } 62%, 100% { opacity: 0; } }
    .a1t { font-family: sans-serif; font-size: 13px; fill: #1e293b; }
    .a1s { font-family: sans-serif; font-size: 11px; fill: #64748b; }
  </style>
  <rect x="2" y="2" width="656" height="326" rx="12" fill="#f8fafc" stroke="#cbd5e1" />
  <text x="170" y="24" text-anchor="middle" class="a1t" font-weight="bold">发送端</text>
  <text x="490" y="24" text-anchor="middle" class="a1t" font-weight="bold">接收端</text>
  <text x="84" y="60" text-anchor="end" class="a1t">应用层</text>
  <text x="84" y="120" text-anchor="end" class="a1t">传输层</text>
  <text x="84" y="180" text-anchor="end" class="a1t">网络层</text>
  <text x="84" y="240" text-anchor="end" class="a1t">链路层</text>
  <text x="576" y="60" class="a1t">应用层</text>
  <text x="576" y="120" class="a1t">传输层</text>
  <text x="576" y="180" class="a1t">网络层</text>
  <text x="576" y="240" class="a1t">链路层</text>
  <rect x="90" y="36" width="160" height="40" rx="6" fill="#e0e7ff" stroke="#a5b4fc" />
  <rect x="90" y="96" width="160" height="40" rx="6" fill="#dbeafe" stroke="#93c5fd" />
  <rect x="90" y="156" width="160" height="40" rx="6" fill="#dcfce7" stroke="#86efac" />
  <rect x="90" y="216" width="160" height="40" rx="6" fill="#fef3c7" stroke="#fcd34d" />
  <rect x="410" y="36" width="160" height="40" rx="6" fill="#e0e7ff" stroke="#a5b4fc" />
  <rect x="410" y="96" width="160" height="40" rx="6" fill="#dbeafe" stroke="#93c5fd" />
  <rect x="410" y="156" width="160" height="40" rx="6" fill="#dcfce7" stroke="#86efac" />
  <rect x="410" y="216" width="160" height="40" rx="6" fill="#fef3c7" stroke="#fcd34d" />
  <line x1="250" y1="236" x2="410" y2="236" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5 4" />
  <text x="170" y="300" text-anchor="middle" class="a1s">↓ 封装：一层层穿外套</text>
  <text x="330" y="300" text-anchor="middle" class="a1s">每一程由链路层接力</text>
  <text x="490" y="300" text-anchor="middle" class="a1s">↑ 解封装：一层层脱外套</text>
  <g class="a1pkt">
    <rect class="a1fL" x="-30" y="-22" width="60" height="44" rx="6" fill="#fef3c7" fill-opacity="0.55" stroke="#f59e0b" stroke-width="2" />
    <rect class="a1fN" x="-25" y="-18" width="50" height="36" rx="5" fill="#dcfce7" fill-opacity="0.6" stroke="#22c55e" stroke-width="2" />
    <rect class="a1fT" x="-20" y="-14" width="40" height="28" rx="4" fill="#dbeafe" fill-opacity="0.7" stroke="#3b82f6" stroke-width="2" />
    <rect x="-15" y="-10" width="30" height="20" rx="3" fill="#f97316" />
    <text x="0" y="3.5" text-anchor="middle" style="font-family:sans-serif;font-size:10px;fill:#ffffff">数据</text>
  </g>
</svg>

图 1：一个数据包的旅行。橙色是数据本身；蓝、绿、黄三层"外套"，分别是传输层、网络层、链路层
在发送端加上、到接收端又逐层脱掉的头部信息。注意最外层的链路外套只活一程——每经过一个路由器就换一件。

### 每个工具在哪一层动手脚

| 工具 | 动手脚的层 | 具体怎么工作 |
|---|---|---|
| Shadowsocks | 应用层 | 在本机开一个 SOCKS5 代理口，应用主动把流量"交"给它，它把整条数据流加密后发给境外服务器。它不碰网络层——应用不主动走代理，它就管不着 |
| V2Ray / VLESS | 应用层为主，伪装蹭在传输层之上 | VLESS 本身是应用层代理协议（应用把请求交给它代发）；它的伪装（TLS / Reality）套在应用数据外面，让旁观者看到的只是一次普通 HTTPS 访问 |
| Clash | 应用层，TUN 模式下沉到网络层 | 平时在应用层按规则决定每条流量走哪个节点；TUN 模式则造一块虚拟网卡，在网络层先把所有 IP 包抓下来再分发——不认代理的应用也能被管住 |
| WireGuard | 网络层 | 造一块虚拟网卡：操作系统把 IP 包交给它，它把**整个 IP 包加密**后塞进一个普通 UDP 包发走。对应用完全透明，就像多插了一条网线 |
| Tailscale | 网络层（数据）＋ 应用层（协调） | 真正搬数据的是 WireGuard，工作在网络层；额外多一个跑在应用层的"控制面"——中央服务器只发密钥、分配 100.x 地址、协调打洞，自己不经手数据 |
| EasyConnect | 借传输层建隧道，效果落在网络层 | 用 TLS 在 443 端口上建隧道（所以穿透性像普通 HTTPS 一样好）；隧道里再发你一个公司内网 IP，效果上等于把你整机接进了公司的网络层 |

### 层级决定了三件事

1. **能不能精细分流**：层级越高越"懂内容"。应用层的工具能按"哪个应用、哪个域名"挑流量
   （代购能看购物清单）；网络层的隧道默认只认 IP 地址、对所有应用一视同仁，
   想精细分流得另配路由规则慢慢调。
2. **能不能伪装**：审查（DPI）主要盯两样东西——流量的"长相"，和各种协议的握手特征。
   VLESS 把自己裹进真实网站的 TLS 里，长相就是正常 HTTPS，难认；
   WireGuard 在网络层裸奔、握手包特征固定，一眼可辨——这就是它容易被掐的根本原因。
3. **接管范围与透明度**：网络层方案对应用完全透明，装好之后所有应用自动被管，代价是"全都要"；
   应用层代理需要应用主动配合，不支持代理设置的程序会直接"漏"出去——
   Clash 的 TUN 模式正是为了堵这个漏，才下沉到网络层去抓包的。

记住这三条因果，再看下面每个工具的优点和毛病，就都是同一套逻辑的推论了。

---

## 四、Shadowsocks：轻量翻墙代理的开山鼻祖

**一句话定位**：一个极简的加密代理协议，个人翻墙的入门选择。

- **是什么**：2012 年由 clowwindy 开源的代理**协议**。注意它只定义"怎么加密传输"，
  你得自己有一台境外服务器来跑服务端。
- **原理（讲透）**：它在你电脑上开一个本地 SOCKS5 端口（比如 127.0.0.1:1080），
  数据流向是这样的：

```
  浏览器 → [本地 1080 端口] → AEAD 加密 → 境外服务器解密 → 目标网站
                                   ↑
                        对审查者：只看到一堆"看不懂"的加密流量
```

  加密用的是 AEAD 算法（如 aes-256-gcm），**整个 TCP 流**一次加密，没有复杂的握手过程，
  所以延迟低、省电，手机上体验尤其好。
  它的哲学是"轻"：协议本身不管伪装，伪装靠外挂插件（simple-obfs / v2ray-plugin），
  把加密流量化妆成"看起来像普通 HTTPS"的样子。
- **适合谁**：刚入门、想自己搭一条线的人；对延迟敏感的手机用户。
- **不适合谁**：指望它长期对抗 DPI 的人——协议特征相对固定，
  只靠"看不懂"来混，在严格审查下容易被识别封锁。
- **案例**：小林在自己的境外 VPS 上搭了个 Shadowsocks 节点，手机装上客户端、导入配置。
  坐地铁时想查一篇国外的技术文档，他点开客户端连上节点，浏览器里页面唰地打开；
  因为整个数据流只做一次加密、没有复杂的握手，手机又省电又不发烫。
  他的用法很"轻"：需要查资料时才开一下，平时关掉，从不指望它接管全机流量。
- **延伸阅读**：[Shadowsocks 官网](https://shadowsocks.org)（协议介绍与各平台客户端）

## 五、V2Ray：模块化的代理平台

**一句话定位**：一个"代理界的瑞士军刀"——支持多种协议、多种伪装方式的**平台**。

- **是什么**：Project V（V2Fly）旗下的开源代理软件。现在常说的"V2Ray 节点"，
  一般指它支持的 VMess 或 VLESS 协议。
- **原理（讲透）**：它的核心设计是**分层解耦**，把一次代理拆成四层，每层可换：

```
  应用流量
    → [路由层：按域名/IP 决定走不走代理]
    → [协议层：VMess / VLESS / Trojan / Shadowsocks]
    → [传输层：TCP / WebSocket / mKCP / gRPC]
    → [伪装层：TLS]
    → 境外服务器，逐层解开
```

  关键创新在**伪装**：VLESS + WebSocket + TLS 套在一起，审查者看到的就是一次普通 HTTPS 访问；
  进阶的 **VLESS + Reality** 更进一步——直接"借用"一个真实大网站（如微软、苹果官网）的 TLS 指纹，
  连证书都是真的，审查者看到的就是你在正常访问那个大网站，几乎无法区分。
  这也是目前对抗 DPI 的主力方案（我自己的主力线路就是 VLESS + Reality，
  之前 WireGuard 被 DPI 掐过两次 UDP 握手后切过来的）。
- **适合谁**：想要一条"一次配好、长期稳定"的主力线路的人；愿意花一下午研究配置的人。
- **不适合谁**：怕麻烦的人——传输方式、流控、指纹、回落这些概念，新手容易被淹没。
  怕折腾可以直接用 Clash + 现成节点（见下一节）。
- **案例**：程序员小陈有一台自己的美国 VPS，上面跑着 VLESS + Reality。
  他只给一个命令行工具设了代理环境变量：这个工具的请求先到本机 V2Ray 客户端，
  打包成 VLESS、披上 Reality 的外衣，送到 VPS 再从美国出口出去；
  而他的浏览器、聊天软件、公司内网系统完全不知道这条线的存在，照常直连。
  想让哪个程序"走专线"就给哪个设变量，其他流量一概不动——
  这正是第三节说的：应用层代理做精细分流的典型样子。
- **延伸阅读**：[V2Fly 官方文档](https://www.v2fly.org/)（配置手册，建议从"快速上手"看起）

## 六、Clash：不是协议，是规则引擎

**一句话定位**：代理界的"交通指挥中心"——自己不翻墙，只负责调度。

- **是什么**：开源代理**客户端**（核心已改名 Mihomo，但大家还习惯叫 Clash）。
  它不提供任何翻墙能力，只做两件事：接入各种节点（SS/V2Ray/Trojan 都行），按规则决定流量走哪。
- **原理（讲透）**：它通过两种方式接管流量，再按规则分流：

```
  方式一 TUN 模式：虚拟网卡接管系统全部流量（最彻底，游戏/终端也走）
  方式二 系统代理：只接管走系统代理的应用（浏览器等）

  分流规则（yaml 文件，灵魂所在）：
    国内网站、国内 IP → 直连
    国外网站 → 走代理节点
    广告/跟踪域名 → 直接拦截
    特殊网站 → 指定走某个节点（策略组）
```

  一套好规则能做到"无感上网"：该直连的直连，该代理的代理，不用手动开关。
- **适合谁**：手里有多个节点或机场订阅的人；想要"国内外自动分流"的人。
- **常见误解**："Clash 连不上"——90% 不是 Clash 的问题，而是底下的**节点失效**或**规则写错**。
  排查顺序永远是：先测节点通不通，再看规则。
- **案例**：小周订阅了一个有十几个节点的服务，用 Clash 一次全部导入，又套了一份社区维护的分流规则。
  此后他的日常是"无感"的：早上打开电脑，国内购物网站直连秒开，国外的文档站自动走香港节点，
  视频会议被规则指定走日本节点保稳定；哪个节点抽风，策略组就自动切到下一个可用的。
  他几个月没手动点过一次"连接"按钮——规则引擎的价值不在翻墙本身，在于把"选哪条路"自动化了。
- **延伸阅读**：[Mihomo GitHub 仓库](https://github.com/MetaCubeX/mihomo)（核心项目，看 Release 找客户端）

## 七、WireGuard：极简现代的 VPN 协议

**一句话定位**：代码只有 4000 行、已合入 Linux 内核的下一代 VPN 协议。

- **是什么**：2016 年出现的开源 VPN **协议**。注意：它是"修隧道的技术"，
  不是翻墙工具——隧道连向谁、通向哪，取决于你自己的服务器。
- **原理（讲透）**：传统 VPN（OpenVPN/IPsec）握手要来回好几轮、代码几十万行；
  WireGuard 用 Noise 协议框架，**一次握手**就完成密钥交换和身份认证（1-RTT），
  加密用 ChaCha20，认证和加密一次做完。三个杀手特性：

  1. **极简**：约 4000 行代码，审计容易，出 bug 的面小；
  2. **内核态**：Linux 下跑在内核里，速度快、延迟低、手机上省电；
  3. **漫游**：连接不绑定 IP，手机从 Wi-Fi 切到 4G，IP 变了隧道不断（靠 cryptokey routing 认设备不认 IP）。

  它的阿喀琉斯之踵是**握手包特征固定**：DPI 能识别出"这是 WireGuard 握手"并直接掐掉——
  我的美国 VPS 专线就被这样掐过两次 UDP 握手。这也是"协议本身不做伪装"的代价。
- **适合谁**：有公网服务器、想自建"专线"的人；远程访问家里/公司内网服务；
  需要低延迟稳定隧道（比如我的 Claude 专线：只让 Claude 相关 IP 走隧道，其他流量不动的分流模式）。
- **不适合谁**：指望"装上就能翻墙"的人——它只管隧道，出口是哪就是哪；
  连的是国内服务器就还是国内出口。
- **案例**：老吴家里有台小主机，跑着照片备份和几个自用服务，人出差时最怕临时要取家里的东西。
  他给这台小主机和自己的笔记本之间拉了一条 WireGuard 隧道：在酒店打开笔记本、隧道一连，
  访问家里服务的内网地址就像坐在自家书房——NAS 的管理页、内网打印机，全都照常用。
  中途手机热点和酒店 Wi-Fi 来回切换，隧道自己无声地跟上，不用人重连。
- **延伸阅读**：[WireGuard 官网](https://www.wireguard.com/)｜[官方白皮书（PDF）](https://www.wireguard.com/papers/wireguard.pdf)（想深挖原理看这篇，写得非常清楚）｜[Noise 协议官网](https://noiseprotocol.org/)（握手框架的原始设计）

## 八、Tailscale：基于 WireGuard 的零配置组网

**一句话定位**：把 WireGuard 最麻烦的部分全部托管掉的组网**服务**——"登录即组网"。

- **是什么**：一家公司提供的服务，底层数据传输就是 WireGuard。
  个人版免费（100 台设备以内），公司靠企业版赚钱。
- **原理（讲透）**：它把组网拆成**控制面**和**数据面**：

```
  控制面（Tailscale 中央服务器，闭源）：
    你用 Google/GitHub 账号登录 → 它给每台设备发密钥
    → 分配 100.x.x.x 虚拟 IP → 协调 NAT 打洞

  数据面（设备之间，开源 WireGuard）：
    优先打洞直连（P2P，速度最快）
    打不通（如对称 NAT）→ 走 DERP 中继服务器兜底（慢一点，但一定能通）
    全程端到端加密，中继服务器也看不到内容
```

  你要做的只是在每台设备上登录一下，剩下的全自动。
  典型用法：家里的 NAS、办公室电脑、云服务器、手机都装上，它们就像在同一个局域网里，
  直接用虚拟 IP 互访——远程桌面、SSH、访问家里跑的服务，一个端口都不用在公网开放。

把上面这条"直连优先、中继兜底"的路径画成动画，是这样：

<!-- 动画二：Tailscale 流量之旅——打洞直连 vs DERP 中继兜底。纯内联 SVG + CSS，自包含 -->
<svg viewBox="0 0 660 250" style="width:100%;height:auto;display:block;margin:12px auto" role="img" aria-label="Tailscale 直连与中继兜底动画">
  <style>
    .a2d1 { animation: a2d1 3.6s linear infinite; }
    .a2d2 { animation: a2d2 7s linear infinite; }
    @keyframes a2d1 {
      0% { transform: translate(148px, 104px); opacity: 1; }
      78% { transform: translate(512px, 104px); opacity: 1; }
      88% { transform: translate(512px, 104px); opacity: 0; }
      100% { transform: translate(148px, 104px); opacity: 0; }
    }
    @keyframes a2d2 {
      0% { transform: translate(82px, 150px); opacity: 1; }
      12% { transform: translate(82px, 196px); opacity: 1; }
      30% { transform: translate(330px, 196px); opacity: 1; }
      48% { transform: translate(578px, 196px); opacity: 1; }
      60% { transform: translate(578px, 150px); opacity: 1; }
      70% { transform: translate(578px, 150px); opacity: 0; }
      100% { transform: translate(82px, 150px); opacity: 0; }
    }
    .a2t { font-family: sans-serif; font-size: 13px; fill: #1e293b; }
    .a2s { font-family: sans-serif; font-size: 11px; fill: #64748b; }
  </style>
  <rect x="2" y="2" width="656" height="246" rx="12" fill="#f8fafc" stroke="#cbd5e1" />
  <text x="330" y="30" text-anchor="middle" class="a2t" font-weight="bold">同一个数据包，两条可能的路</text>
  <line x1="140" y1="104" x2="520" y2="104" stroke="#22c55e" stroke-width="2" stroke-dasharray="6 4" />
  <text x="330" y="92" text-anchor="middle" style="font-family:sans-serif;font-size:12px;fill:#15803d">① 打洞直连 · WireGuard（最快）</text>
  <path d="M 82 144 L 82 196 L 578 196 L 578 144" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="6 4" />
  <rect x="24" y="88" width="116" height="56" rx="8" fill="#ffffff" stroke="#94a3b8" />
  <text x="82" y="112" text-anchor="middle" class="a2t">家里的电脑</text>
  <text x="82" y="130" text-anchor="middle" class="a2s">Tailscale 节点</text>
  <rect x="520" y="88" width="116" height="56" rx="8" fill="#ffffff" stroke="#94a3b8" />
  <text x="578" y="112" text-anchor="middle" class="a2t">手机</text>
  <text x="578" y="130" text-anchor="middle" class="a2s">人在外面</text>
  <rect x="275" y="174" width="110" height="44" rx="8" fill="#fff7ed" stroke="#f59e0b" />
  <text x="330" y="193" text-anchor="middle" class="a2t">DERP 中继</text>
  <text x="330" y="209" text-anchor="middle" class="a2s">只转发密文</text>
  <text x="330" y="238" text-anchor="middle" style="font-family:sans-serif;font-size:12px;fill:#b45309">② 直连打不通时走中继兜底（慢一点，但必通）</text>
  <circle class="a2d1" r="7" fill="#16a34a" />
  <circle class="a2d2" r="7" fill="#d97706" />
</svg>

图 2：Tailscale 的流量之旅。绿点走的是打洞直连——两台设备点对点，速度最快；
黄点走的是兜底路线——直连打不通时绕一趟 DERP 中继，中继只负责转发密文、看不到内容。
两条路对你来说没有区别：登录之后选哪条，Tailscale 自己决定。

- **适合谁**：有多台设备、想异地互访的人；不想折腾端口转发、动态 DNS、证书的人。
- **不适合谁**：对"控制面在美国公司手里"介意的人（登录和打洞协调依赖它的服务器）；
  需要翻墙的人——它默认不提供境外出口（exit node 功能可以指定某一台节点做出口，但那是进阶玩法）。
- **和裸 WireGuard 怎么选**：怕麻烦 → Tailscale；要完全自主可控、有公网服务器 → 裸 WireGuard 自建。
- **案例**：小林在外出差，客户临时要一份只存在家里 NAS 上的旧合同。
  他掏出手机，在文件 App 里点开那个以 100.x 开头的地址——NAS 就像装在他口袋里，合同直接下载了下来。
  整个过程中他没在路由器上开过任何一个公网端口，家里的宽带甚至没有公网 IP，
  全靠 Tailscale 帮两台设备打洞直连。出差那几天他还顺手开了把 exit node（出口节点）：
  笔记本的流量全部从家里的电脑出门——在外面上网时，网站看到的"他"和在家时一模一样。
- **延伸阅读**：[Tailscale 官网](https://tailscale.com/)｜[官方文档库](https://tailscale.com/kb/)（从 "How Tailscale works" 看起，讲打洞讲得很透）

## 九、EasyConnect：深信服的企业 SSL VPN

**一句话定位**：公司 IT 统一部署的远程办公工具——**和翻墙是两回事**。

- **是什么**：深信服（Sangfor）的商业闭源方案，国内很多公司用它让员工在家访问内网。
  个人装不上也用不上，只有公司 IT 能部署。
- **原理（讲透）**：基于 SSL/TLS 建加密隧道，把你"逻辑上"接入公司内网。
  和 IPsec VPN 相比，SSL VPN 穿透性更好（走 443 端口，像普通 HTTPS，不易被防火墙拦）。
  它的特色是**终端安全检查**：登录前检查你的电脑——杀毒软件装没装、系统补丁齐不齐、
  有没有装违规软件，不合规就不让进。还支持"应用级发布"：只给你开 OA、ERP 等几个应用，
  而不是把整个内网暴露给你。
- **适合谁**：就一种人——公司要求装，那就装。场景只有远程办公访问内网系统。
- **注意**：客户端权限很大、常驻后台，会扫描本机安全状态。
  **只装在工作电脑上**，不要图方便装在个人主力机；离职后记得卸载。
  也别指望它翻墙——出口走的是公司网络，能访问什么公司说了算。
- **案例**：财务小李在家办公，早上第一件事是打开 EasyConnect、输工号密码登录。
  客户端先不急着连，而是花十几秒给她的电脑"体检"：杀毒软件在不在、系统补丁齐不齐——
  有次她刚重装完系统、补丁没打全，直接被拦在门外，打电话给 IT 处理完才放行。
  体检通过、隧道建好，她打开 OA 批报销、进 ERP 查账，和坐在工位上没区别；
  但她的个人网盘、聊天软件并不走这条隧道——公司只把 OA 和 ERP 这几个应用"发布"给了她。
- **延伸阅读**：[深信服官网](https://www.sangfor.com.cn/)（产品页找 SSL VPN / EasyConnect）

---

## 十、它们之间怎么搭配（常见组合）

新手最晕的是"这些东西要一起用吗"。答案是：**按需组合**，常见搭配就三种：

1. **翻墙全家桶**：Clash（客户端/规则） + V2Ray 或 Shadowsocks 节点（线路）。
   Clash 负责" traffic 交警"，节点负责"实际翻墙"。这是目前个人翻墙最主流的组合。
2. **组网全家桶**：Tailscale 一装全搞定；硬核玩家用裸 WireGuard 自建（配一台有公网 IP 的服务器做"汇聚点"）。
3. **各干各的**：白天 EasyConnect 连公司内网办公，晚上 Clash 切自己的节点上外网——
   注意不要把翻墙代理和公司内网混在一条线路上，公司数据走公司通道。

## 十一、怎么选：三问定位法

1. **你想访问境外网站？** → 选翻墙代理：Shadowsocks 入门，V2Ray（VLESS+Reality）做主力；
   节点多了就用 Clash 统一管理、自动分流。
2. **你想把自己的几台设备连成内网？** → 别折腾翻墙工具，直接上 Tailscale，十分钟搞定；
   有公网服务器、想完全自主可控，再考虑裸 WireGuard 自建。
3. **公司让你装 EasyConnect？** → 照做，但只装在工作机上；它和翻墙是两回事，
   不要指望它帮你上外网。

## 十二、常见误区（一次澄清）

- **"Clash 就是翻墙软件"**：错。它只是客户端和规则引擎，没有节点就什么都干不了。
- **"VPN 就是翻墙"**：错。VPN 是技术，翻墙是用途之一；Tailscale 组内网、EasyConnect 连公司，用的都是 VPN 技术，但都不翻墙。
- **"WireGuard 装上就能上外网"**：错。它只负责建隧道，出口取决于你的服务器在哪。
- **"Tailscale 是免费翻墙"**：错。它默认不提供境外出口，它是组网工具。
- **"协议越复杂越安全"**：不一定。WireGuard 恰恰以极简著称——代码少意味着可审计、漏洞面小。
- **"今天好用的配置永远好用"**：错。DPI 和伪装是持续攻防，理解"加密—伪装—分流"三层原理，
  比记住某个具体配置长寿得多。

## 十三、几句提醒

- **免费节点和来路不明的"机场"**：流量经过别人的服务器，账号密码都有被嗅探的风险。
  能自己搭就自己搭，嫌麻烦就选口碑好的付费服务，别贪免费。
- **公司数据走公司通道**：用 EasyConnect 处理工作时，遵守公司的数据安全规定。
- **工具会过时，原理不会**：上面每一节的"原理"部分，比"怎么配置"保值十倍。

---

## 延伸阅读

按"想深挖"的顺序排：

- 概念打底：[维基百科 - 虚拟专用网](https://zh.wikipedia.org/wiki/虚拟专用网)
- WireGuard 原理：[官方白皮书（PDF）](https://www.wireguard.com/papers/wireguard.pdf)
- V2Ray 配置：[V2Fly 官方文档](https://www.v2fly.org/)
- Tailscale 打洞原理：[Tailscale 官方文档库](https://tailscale.com/kb/)
- Noise 握手框架：[noiseprotocol.org](https://noiseprotocol.org/)
- 本博客动手篇：[Claude 专线 VPN 搭建（WireGuard 分流）](./claude-wireguard-vpn.md)
