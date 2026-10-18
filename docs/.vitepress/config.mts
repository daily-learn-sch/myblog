import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/myblog/',
  title: "小海的技术笔记",
  description: "Java 开发者的实战教程：VPN、云服务、自动化",
  lang: 'zh-CN',
  ignoreDeadLinks: [/^http:\/\/localhost/],
  themeConfig: {    nav: [
      { text: '首页', link: '/' },
      { text: '教程', link: '/tutorials/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: {
      '/tutorials/': [
        {
          text: '实战教程',
          items: [
            { text: '个人网站全自动发布：GitHub + R2', link: '/tutorials/ailearn-auto-publish' },
            { text: 'Claude 专线 VPN 搭建（WireGuard）', link: '/tutorials/claude-wireguard-vpn' },
            { text: 'IdeaVim 配置与快速上手', link: '/tutorials/ideavim-setup-guide' },
            { text: 'VPN / 代理工具科普：六个工具一次讲清', link: '/tutorials/vpn-tools-guide' },
            { text: 'Mac 本地大模型搭建（Ollama + Open WebUI）', link: '/tutorials/ollama-openwebui-setup-guide' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/daily-learn-sch' },
    ],
    footer: {
      copyright: 'Copyright © 2026 小海',
    },
    search: { provider: 'local' },
  },
})
