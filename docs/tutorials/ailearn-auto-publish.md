# 个人网站全自动发布实战：GitHub Actions 不用写，定时任务 + R2 就够了

> 背景：我有个 GitHub Pages 上的英语精听训练网站，每天早上要更新一篇听力材料（含 MP3 音频）。之前每天手动下载音频、复制文件、改代码、git push，烦不胜烦。于是花了一上午搭了一套全自动流水线：每天早上定时生成材料，自动发布到网站，全程零手动。
>
> 最终架构：**定时任务生成内容 → MP3 存 Cloudflare R2 → JSON 经 GitHub API 推送 → GitHub Pages 自动部署**

---

## 一、问题拆解

每天的发布动作其实就三件事：

1. 生成今日的 JSON 数据文件（含文章、词汇、音频地址）
2. 把 MP3 音频放到网站能访问到的地方
3. 更新索引并部署

卡点在于：**MP3 是二进制**，我用的自动化通道只支持文本传输，音频一直得手动搬。这是整个方案设计的起点——文本走 GitHub API，音频走对象存储。

---

## 二、GitHub Token：让机器替你 push

### 2.1 创建 Fine-grained Token

GitHub 右上角头像 → Settings → 拉到最底 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**：

- Token name：随便取，如 `ailearn-auto-publish`
- Expiration：90 天或更长
- Repository access：**Only select repositories**，只勾你的网站仓库
- Permissions：找到 **Contents**，设为 **Read and write**

> 最小权限原则：token 只对一个仓库有效，只读写真有必要的 Contents，泄露了损失也可控。随时可以在同一页面 Revoke。

### 2.2 用 Contents API 推送（不用 git 命令行）

拿到 token 后，不需要 `git clone/push`，直接调 GitHub Contents API：

```python
import base64, json, urllib.request

def push_file(repo, path, local_file, message, token, sha=None):
    with open(local_file, "rb") as f:
        content = base64.b64encode(f.read()).decode("ascii")
    payload = {"message": message, "content": content, "branch": "main"}
    if sha:  # 更新已有文件需要带上 sha
        payload["sha"] = sha
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/contents/{path}",
        data=json.dumps(payload).encode(),
        method="PUT",
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json"},
    )
    return urllib.request.urlopen(req).status
```

文本文件和二进制文件都走 base64，一套逻辑全搞定。推送成功后 GitHub Pages 会自动重新部署，一般 1 分钟内生效。

> 验证方法：`curl https://<你的用户名>.github.io/<仓库>/data/index.json`，看 `updated` 字段是不是今天。

---

## 三、Cloudflare R2：音频的家

### 3.1 为什么不用仓库存 MP3

每天一个 400KB 的 MP3，一年约 150MB。GitHub 仓库软上限 1GB，几年内不会爆，但二进制进 git 仓库有几个膈应：

- 每次 `clone` 都要下载全部历史音频
- `git log`/`git blame` 变慢
- 架构上就不优雅：代码和媒体文件混在一起

对象存储是正解。选 Cloudflare R2 的理由：**每月 10GB 免费额度，流量（egress）免费**——这点比 AWS S3 良心得多。我们这种一年 150MB 的用量，永远在免费线内。

### 3.2 开通 R2（需要绑卡）

Cloudflare 后台 → 左侧 **R2 Object Storage** → 点 **Add R2 subscription to my account**。

注意：**必须绑定付款方式才给开通**，哪怕只用免费额度。支持 Visa/Mastercard 双币卡（中国银行发的就可以）。账单地址填真实的，Country 选 China 用拼音填。这只是 $0 验卡，不会真扣钱，用量超了才收费，随时可取消。

> 踩坑：虚拟卡大概率过不了 Stripe 的风控，3D 验证过了也会被拒。直接上实体双币卡最省事。

### 3.3 建 Bucket 并开启公开访问

R2 → **Create bucket**，名字如 `ailearn-audio`。建好后进 bucket 的 **Settings**：

- 找到 **Public Development URL** → 点 **Enable**，输入 `allow` 确认
- 会得到一个 `https://pub-xxx.r2.dev` 的公开域名——音频就通过这个地址访问

### 3.4 创建 API Token

R2 总览页地址栏把 `/r2/overview` 改成 `/r2/api-tokens`（新版后台把入口藏起来了）→ **Create Account API token**：

- Permissions：**Object Read & Write**
- Specify buckets：**Apply to specific buckets only**，只勾你的 bucket
- TTL：Forever（自动化任务不想每年换一次）

生成后拿到 **Access Key ID** 和 **Secret Access Key**（Secret 只显示一次，复制好）。

### 3.5 上传脚本（boto3，S3 兼容）

R2 是 S3 兼容 API，endpoint 格式为 `https://<AccountID>.r2.cloudflarestorage.com`，`region_name` 固定填 `"auto"`：

```python
import boto3, os

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",  # R2 要求 region 为 auto
)
s3.upload_file("/tmp/2026-10-13.mp3", "ailearn-audio", "2026-10-13.mp3",
               ExtraArgs={"ContentType": "audio/mpeg"})
# 公开访问地址：https://pub-xxx.r2.dev/2026-10-13.mp3
```

JSON 里的 `audio` 字段从 `audio/2026-10-13.mp3` 改成完整的 R2 URL，网站播放器一行代码不用改（`audio.src` 直接赋值，相对路径和绝对 URL 都吃）。

---

## 四、密钥放哪？一次安全取舍

R2 的 S3 SigV4 签名要求**本地持有真实密钥**做计算，Secret Vault 那种 surrogate 占位替换机制在这里走不通（占位符算出的签名是错的）。

我的取舍：**密钥放在自己的 VPS 上**（`~/.config/r2/credentials`，600 权限），不放在自动化平台的 VM 里。理由很简单——VPS 是独占的，出了问题我知道找谁。

```bash
# VPS 上
mkdir -p ~/.config/r2 && chmod 700 ~/.config/r2
cat > ~/.config/r2/credentials <<'EOF'
R2_ACCOUNT_ID=你的AccountID
R2_ACCESS_KEY_ID=你的AccessKeyID
R2_SECRET_ACCESS_KEY=你的SecretAccessKey
EOF
chmod 600 ~/.config/r2/credentials
```

上传时：`set -a; source ~/.config/r2/credentials; set +a`（`set -a` 让变量自动 export，子进程才能读到）。

---

## 五、定时任务串起全流程

每天早上 07:10，定时任务按顺序执行：

```
1. 生成今日 passage + TTS 合成 MP3
2. scp MP3 → VPS /tmp/
3. SSH 到 VPS，boto3 上传 MP3 → R2
4. 组装 JSON（audio 字段填 R2 公开 URL）+ 更新 index.json
5. GitHub Contents API 推送 JSON（只推文本，不推 MP3）
6. GitHub Pages 自动部署 → 网站更新
```

任何一步失败只记日志，不打扰用户。第二天早上醒来，网站已经是最新。

---

## 六、历史数据迁移

切换方案时，历史 MP3 也要搬过去。写个循环就行：

```bash
for d in 2026-10-08 2026-10-09 2026-10-10 2026-10-11 2026-10-12; do
  scp $d.mp3 vps:/tmp/$d.mp3
done
ssh vps 'set -a; source ~/.config/r2/credentials; set +a;
  for d in 2026-10-08 2026-10-09 2026-10-10 2026-10-11 2026-10-12; do
    python3 ~/bin/r2_upload.py ailearn-audio /tmp/$d.mp3 $d.mp3
  done'
```

然后批量改 JSON 的 `audio` 字段，一次推送。验证：`curl -sI https://pub-xxx.r2.dev/2026-10-12.mp3` 返回 200 且 `content-type: audio/mpeg` 即成功。

---

## 七、费用总结

| 项目 | 费用 |
|---|---|
| GitHub Pages + Contents API | 免费 |
| Cloudflare R2（10GB/月内） | 免费（实际用量 ~12MB/月） |
| VPS（已有） | 0 边际成本 |
| **合计** | **¥0** |

---

## 八、一句话总结

文本走 GitHub API，音频走 R2，密钥放自己 VPS，定时任务串起来——每天零手动，网站自动更新，一年花费零元。
