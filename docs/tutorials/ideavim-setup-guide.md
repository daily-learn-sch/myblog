# IdeaVim 配置与快速上手：一次换电脑引出的配置体检

> 写于 2026-10-14。环境：Windows 11 + IntelliJ IDEA 2026.2 + IdeaVim。
> 适合：装了 IdeaVim、写了 `.ideavimrc`，但总觉得"用了很久还是不熟"的人。

---

## 一、起因

换电脑后，IDEA 里的 Vim 快捷键全部失灵：按 `,` 没反应，EasyMotion 的 `,,s` 也没反应。顺着排查下去，发现两件事：

1. **迁移时漏了东西**：IDEA 的「导入设置」只带配置，**不带插件**；`.ideavimrc` 也不属于 IDEA 设置，需要单独拷。
2. **用了很久的 `.ideavimrc` 本身就有好几处"按了不生效"的配置**，只是一直没发现。

下面把迁移步骤、踩过的坑、整理后的完整配置和快速熟练的方法一起记下来。

---

## 二、换电脑时 IdeaVim 要迁移的三样东西

| 东西 | 位置 | 怎么迁 |
|---|---|---|
| 配置文件 `.ideavimrc` | Windows：`C:\Users\<用户名>\.ideavimrc` | 直接拷贝 |
| IdeaVim 及其配套插件 | IDEA 插件 | **导入设置不会装插件**，需在 Settings → Plugins 里手动装，装完重启 |
| Vim 与 IDE 的快捷键分配 | Settings → Editor → Vim | 随 IDEA 设置导入，导入后核对一遍 |

需要装的插件：

| 插件 | 作用 | 没装的表现 |
|---|---|---|
| **IdeaVim** | Vim 模拟本体 | 完全没有 Vim 操作 |
| **Which-Key** | 按 leader 后弹出快捷键提示 | 按 `,` 没任何反应 |
| **IdeaVim-EasyMotion** | 屏幕内快速跳转 | `,,s` 没反应 |
| **AceJump** | EasyMotion 的依赖 | EasyMotion 装了也用不了 |
| IdeaVimExtension（可选） | 退出插入模式时自动切回英文输入法 | 中文输入法下按 Esc 后还是中文 |

### 坑：配置文件放错位置

如果你在 Windows 上用 MSYS2 / UCRT64 终端，它的 `~` 是 `C:\msys64\home\<用户名>`，**不是** `C:\Users\<用户名>`。在终端里 `cp xxx ~/.ideavimrc`，文件会进 MSYS2 的家目录，IDEA 读不到。

**最快的确认方法**：点 IDEA 右下角状态栏的 IdeaVim 图标 →「Open ~/.ideavimrc」，打开的是谁，IDEA 读的就是谁。

---

## 三、体检：旧配置里"按了不生效"的 6 个问题

这些问题都不会弹窗报错，所以可能用了几个月都发现不了。

### 1. 写了不存在的选项

```vim
" ❌ IdeaVim 没有这个选项，导致下面的 yank 高亮其实没开
set ideavim.plugins
let g:highlightedyank_highlight_duration = 300

" ✅ 扩展要逐个 set 开启
set highlightedyank
let g:highlightedyank_highlight_duration = 300
```

怎么发现的：IDEA 日志（Help → Show Log in Explorer → `idea.log`）里有一行：

```
WARN - com.maddyhome.idea.vim.vimscript.Executor - ... Unknown option: ideavim.plugins
```

> 💡 改完 `.ideavimrc` 后去 `idea.log` 里搜 `vimscript.Executor`，是发现配置错误最直接的办法。

### 2. 手滑多打一个字符

```vim
" ❌ 多了一个 <，实际先执行了 < 缩进操作，分屏不会发生
nnoremap <Leader>ws <<C-w>s

" ✅
nnoremap <Leader>ws <C-w>s
```

### 3. 用了不存在的 Ex 命令

```vim
" ❌ :scroll 不是 Vim 命令（scroll 是选项）
nnoremap <C-d> :scroll +10<CR>

" ✅ 翻半页，光标保持在屏幕中间
nnoremap <C-d> <C-d>zz
nnoremap <C-u> <C-u>zz
```

### 4. 快捷键被分给了 IDE，映射永远不会触发

```vim
" ❌ 在 Settings → Editor → Vim 里 Ctrl+H/J/L 已分给 IDE，这三行永远不生效
nnoremap <C-h> <C-w>h
nnoremap <C-j> <C-w>j
nnoremap <C-l> <C-w>l

" ✅ 换成 Leader 版本，不和 IDE 抢键
nnoremap <Leader>wh <C-w>h
nnoremap <Leader>wj <C-w>j
nnoremap <Leader>wk <C-w>k
nnoremap <Leader>wl <C-w>l
```

> 💡 `Ctrl+C / V / F / S` 这类建议交给 IDE；`Ctrl+D / U / O / I / W` 这类交给 Vim。写 `<C-x>` 映射前，先去 Settings → Editor → Vim 看这个键归谁。

### 5. `notimeout` + 互为前缀的映射 = 短的那个永远等下去

Which-Key 推荐配 `set notimeout`（弹窗不会自动消失），但它有个副作用：

```vim
" ❌ 按完 ,ag 后，IdeaVim 不知道你是要 ,ag 还是 ,ags，会一直等第 4 个键
nnoremap <Leader>ag  :action Generate<CR>
nnoremap <Leader>ags :action GenerateGetterAndSetter<CR>

" ✅ 让它们不互为前缀
nnoremap <Leader>agg :action Generate<CR>
nnoremap <Leader>ags :action GenerateGetterAndSetter<CR>
```

**规则：开了 `notimeout`，就不要定义 `A` 和 `A + 任何字符` 这样的两条映射。**

### 6. 插入模式下用 Leader 映射，会误触

```vim
" ❌ 插入模式下 leader 就是逗号，写 foo(a,obj) 时 ",o" 会触发换行；
"    而且开着 notimeout，每打一个逗号都要等下一个字符才显示
inoremap <Leader>o <Esc>o

" ✅ 删掉，用 Vim 原生：插入模式下 Ctrl+O 再按 o
```

同理，`inoremap jj/jk/kk <Esc>` 三个只留一个 `jk` 就够了。
---

## 四、整理后的完整配置

> 可以直接复制使用。Leader 键是 `,`。用到的扩展都是 IdeaVim 内置的，只有 EasyMotion 需要额外装 IdeaVim-EasyMotion + AceJump 两个插件，Which-Key 需要装 Which-Key 插件。

```vim
" ============================================================================
" IdeaVim 扩展（内置，只需 set 开启）
" ============================================================================
" 复制时高亮闪一下
set highlightedyank
let g:highlightedyank_highlight_duration = 300
" 快速跳转：,,s 再输入一个字符，按屏幕上的字母直接跳过去（依赖 IdeaVim-EasyMotion + AceJump 插件）
set easymotion
" 包围：ysiw" 给单词加双引号，cs"' 双引号换单引号，ds" 删除双引号
set surround
" 注释：gcc 注释当前行，gc + 移动 注释一段（可视模式下直接 gc）
set commentary
" J 合并行时用 IDEA 的智能合并（如字符串拼接合成一个字符串）
set ideajoin

" ============================================================================
" 基础设置
" ============================================================================
let mapleader=","

set number
set scrolloff=5
set history=10000
set clipboard=unnamed

set hlsearch
set incsearch
set ignorecase
set smartcase
set showmode

" 清除搜索高亮（,, 留给 EasyMotion）
nnoremap <Leader>sc :nohlsearch<CR>

" ============================================================================
" 模式 & 编辑效率
" ============================================================================
" 插入模式下 jk 回到普通模式
inoremap jk <Esc>
" 插入模式另起一行：用原生 Ctrl+O 再按 o / O，无需映射

vnoremap v <Esc>

nnoremap <Space> viw

nnoremap U <C-r>

nnoremap H ^
nnoremap L $

nnoremap Q gq

" ============================================================================
" 滚动 / 窗口分屏
" ============================================================================
" 翻半页，光标保持在屏幕中间
nnoremap <C-d> <C-d>zz
nnoremap <C-u> <C-u>zz

" 分屏间切换（Ctrl+H/J/L 已交给 IDE，所以用 Leader 版本）
nnoremap <Leader>wh <C-w>h
nnoremap <Leader>wj <C-w>j
nnoremap <Leader>wk <C-w>k
nnoremap <Leader>wl <C-w>l

nnoremap <Leader>wv <C-w>v
nnoremap <Leader>ws <C-w>s
nnoremap <Leader>wc <C-w>c

" ============================================================================
" Tab / 编辑器切换 & 关闭
" ============================================================================
nnoremap <Leader>tn :action NextTab<CR>
nnoremap <Leader>tp :action PreviousTab<CR>

nnoremap <Leader>en :action NextEditor<CR>
nnoremap <Leader>ep :action PreviousEditor<CR>

" 切回上一个文件，再按一次切回来（Vim 原生 Ctrl+^，适合两个文件来回对照）
nnoremap <Leader>bb <C-^>

nnoremap <Leader>cx :action CloseEditor<CR>
nnoremap <Leader>co :action CloseAllEditorsButActive<CR>
nnoremap <Leader>ca :action CloseAllEditors<CR>

" ============================================================================
" 查找 / 搜索
" ============================================================================
nnoremap <Leader>ff  :action Find<CR>
nnoremap <Leader>fip :action FindInPath<CR>
nnoremap <Leader>rp  :action Replace<CR>
nnoremap <Leader>rip :action ReplaceInPath<CR>

nnoremap <Leader>se  :action SearchEverywhere<CR>
nnoremap <Leader>fr  :action RecentFiles<CR>
nnoremap <Leader>gf  :action GotoFile<CR>

nnoremap <Leader>fp :action SelectInProjectView<CR>

" 格式化代码
nnoremap <Leader>cf :action ReformatCode<CR>
vnoremap <Leader>cf :action ReformatCode<CR>

" ============================================================================
" 跳转
" ============================================================================
nnoremap <Leader>gd :action GotoDeclaration<CR>
nnoremap <Leader>gi :action GotoImplementation<CR>
nnoremap <Leader>gc :action GotoClass<CR>
nnoremap <Leader>gs :action GotoSymbol<CR>
nnoremap <Leader>gt :action GotoTest<CR>

nnoremap <Leader>fu :action FindUsages<CR>

" 回到光标上一个位置 / 前进（IDEA 导航历史，可跨文件；等同 Vim 的 Ctrl+O / Ctrl+I）
nnoremap <Leader>fb :action Back<CR>
nnoremap <Leader>fw :action Forward<CR>

" ============================================================================
" 运行 / 调试
" ============================================================================
" 运行当前（或最近）Run Configuration
nnoremap <Leader>rr :action Run<CR>
" 重新运行
nnoremap <Leader>rR :action Rerun<CR>
" 调试当前（或最近）配置
nnoremap <Leader>rd :action Debug<CR>
" 运行时选择文件 / Run Configuration
nnoremap <Leader>ra :action RunAnything<CR>
" 运行到光标
nnoremap <Leader>rc :action RunToCursor<CR>
" 停止
nnoremap <Leader>rs :action Stop<CR>

" ============================================================================
" 重构 / 检查
" ============================================================================
nnoremap <Leader>re :action RenameElement<CR>
nnoremap <Leader>rf :action RenameFile<CR>

" 提取方法：先选中代码再按（普通模式下作用于当前行/表达式）
nnoremap <Leader>em :action ExtractMethod<CR>
vnoremap <Leader>em :action ExtractMethod<CR>

nnoremap <Leader>oi :action OptimizeImports<CR>
nnoremap <Leader>ic :action InspectCode<CR>

" ============================================================================
" 新建 / 生成
" ============================================================================
nnoremap <Leader>ac :action NewClass<CR>
nnoremap <Leader>af :action NewFile<CR>

nnoremap <Leader>agg :action Generate<CR>
nnoremap <Leader>ags :action GenerateGetterAndSetter<CR>
nnoremap <Leader>agc :action GenerateConstructor<CR>

" ============================================================================
" 调试细节
" ============================================================================
nnoremap <Leader>db :action ToggleLineBreakpoint<CR>
nnoremap <Leader>dr :action Resume<CR>
nnoremap <Leader>di :action StepInto<CR>
nnoremap <Leader>do :action StepOver<CR>
nnoremap <Leader>de :action EvaluateExpression<CR>

" ============================================================================
" 工具 / 视图
" ============================================================================
nnoremap <Leader>tt :action ActivateTerminalToolWindow<CR>
nnoremap <Leader>pp :action ActivateProjectToolWindow<CR>

" ============================================================================
" Git / 通用
" ============================================================================
nnoremap <Leader>ga  :action GotoAction<CR>
nnoremap <Leader>ann :action Annotate<CR>

" ============================================================================
" which-key：按 , 后稍等，弹出所有 , 开头的快捷键
" notimeout 下不要定义互为前缀的映射（如 ,ag 和 ,ags），否则短的那个会一直等下一个键
" ============================================================================
set which-key
set notimeout
```

### 设计思路：用"字母分组"记快捷键

Leader 后面的第一个字母代表一类操作，记住分组就不用死记每一个：

| 前缀 | 含义 | 例子 |
|---|---|---|
| `,g` | **G**oto 跳转 | `,gd` 定义、`,gi` 实现、`,gc` 类、`,gf` 文件 |
| `,f` | **F**ind 查找 | `,ff` 文件内查找、`,fip` 全局查找、`,fu` 查引用、`,fb/,fw` 后退/前进 |
| `,r` | **R**un / **R**efactor | `,rr` 运行、`,rd` 调试、`,re` 重命名 |
| `,d` | **D**ebug 调试细节 | `,db` 断点、`,do` 步过、`,di` 步入、`,de` 求值 |
| `,w` | **W**indow 分屏 | `,wv` 竖分、`,ws` 横分、`,wh/j/k/l` 切换 |
| `,t` / `,e` | **T**ab / **E**ditor / **E**xtract | `,tn/,tp` 下/上一个标签、`,em` 提取方法 |
| `,b` | **B**uffer 文件切换 | `,bb` 切回上一个文件（再按一次切回来） |
| `,c` | **C**lose / **C**ode | `,cx` 关闭当前、`,co` 关闭其他、`,cf` 格式化 |
| `,a` | **A**dd / Generate | `,ac` 新建类、`,agg` 生成菜单、`,ags` getter/setter |

---

## 五、怎么快速熟练起来

"配了一堆快捷键但用不熟"，通常是因为**一次想记太多**，以及**忘了的时候没有低成本的查法**。下面是我的做法。

### 1. 让 Which-Key 当随身速查表

装好 Which-Key 插件并 `set which-key` 后，**按 `,` 停一下**，会弹出所有 `,` 开头的映射。忘了就按 `,` 看一眼，不用翻配置文件。用得多了，自然就不用看了。

### 2. 每周只练 5 个

不要试图一次掌握全部，按周加量：

| 周 | 练这 5 个 | 场景 |
|---|---|---|
| 第 1 周 | `,gd` `,fu` `,fb` `,gi` `,se` | 读代码：跳定义、查引用、跳回来、找实现、全局搜 |
| 第 2 周 | `,rr` `,rd` `,db` `,do` `,di` | 跑代码和调试 |
| 第 3 周 | `,re` `,cf` `,oi` `,agg` `gcc` | 改代码：重命名、格式化、整理 import、生成代码、注释 |
| 第 4 周 | `,,s` `ysiw"` `cs"'` `ciw` `.` | 高效编辑：EasyMotion、surround、Vim 文本对象和重复 |

**方法**：把这周的 5 个写在便利贴上贴在显示器边。规定自己：这 5 个操作**这周不许用鼠标**。一周后基本就成肌肉记忆了。

### 3. Vim 原生操作比映射更值得练

映射只是把 IDE 功能换个键；真正提效的是 Vim 的**动词 + 名词**组合：

| 动词 | 名词（文本对象） | 组合 | 效果 |
|---|---|---|---|
| `c` 改 | `iw` 单词 | `ciw` | 删掉当前单词并进入插入 |
| `d` 删 | `i"` 引号内 | `di"` | 删除引号里的内容 |
| `y` 复制 | `ip` 段落 | `yip` | 复制整段 |
| `c` 改 | `i(` 括号内 | `ci(` | 重写方法参数 |
| `v` 选 | `it` 标签内 | `vit` | 选中 XML/HTML 标签内容 |

再加上 **`.` 重复上一次修改**，很多"改十处"的事按十次 `n.` 就完成了。

读代码时还有一组"跳进去、跳回来"最常用：

| 想做的 | 快捷键 |
|---|---|
| 跳进光标处方法/类的定义 | `gd` 或 `,gd` |
| 回到光标刚才的位置（可跨文件，连按一直往回退） | `Ctrl+O` 或 `,fb`；前进用 `Ctrl+I` 或 `,fw` |
| 在两个文件之间来回切 | `,bb`（Vim 原生 `Ctrl+^`） |
| 同一文件内回到跳转前的位置 | ` `` `（两下反引号） |

### 4. 想给某个 IDE 功能加快捷键：查 Action ID

IDEA 里每个菜单功能都有一个内部名字（Action ID），比如「格式化代码」是 `ReformatCode`。`.ideavimrc` 里的 `:action XXX` 就是按这个名字调用 IDE 功能，所以任何菜单功能都能映射，关键是拿到它的 ID。

**实例：给「提取方法」（Refactor → Extract Method）配 `,em`**

1. **先打开跟踪**：`Ctrl+Shift+A` 搜「**IdeaVim: Track Action IDs**」回车。
2. **再用鼠标执行一次这个功能**：选中一段代码，点 Refactor → Extract Method。
3. **看右下角通知**：显示 `Action ID: ExtractMethod`，这就是要找的名字。
4. **写进 `.ideavimrc`**（提取方法要先选中代码，所以可视模式也加一条）：

```vim
nnoremap <Leader>em :action ExtractMethod<CR>
vnoremap <Leader>em :action ExtractMethod<CR>
```

5. **生效**：`:source ~/.ideavimrc`。之后选中代码按 `,em` 就等于点了 Extract Method。
6. **关闭跟踪**：再搜一次 Track Action IDs 回车关掉，否则每个操作都会弹通知。

**另一种查法**：普通模式下输入 `:actionlist 关键字`，例如 `:actionlist extract`，列出名字里带 extract 的所有 ID。

> ⚠️ 开了 `notimeout` 时，新快捷键不要和已有的互为前缀：已有 `,en` 可以加 `,em`，但不能再加单独的 `,e`。

### 5. 改完立刻生效，不用重启

普通模式下：

```vim
:source ~/.ideavimrc
```

（新装插件、开启 EasyMotion 这类扩展，建议重启一次 IDEA。）

---

## 六、排错清单

| 现象 | 排查 |
|---|---|
| 所有 Vim 操作都没了 | Tools → Vim 是否勾选；IdeaVim 插件是否装了、启用了 |
| 自定义映射全部无效 | 状态栏 IdeaVim 图标 →「Open ~/.ideavimrc」，确认打开的是你的配置文件（Windows 注意别放到 MSYS2 家目录） |
| 按 leader 没弹窗 | 是否装了 Which-Key 插件；配置里是否有 `set which-key` |
| `,,s` 没反应 | 是否装了 IdeaVim-EasyMotion **和** AceJump；配置里是否有 `set easymotion` |
| 某个 `<C-x>` 映射无效 | Settings → Editor → Vim，看这个键是不是分给了 IDE |
| 某个映射按了没反应、一直在等 | 是否和另一个映射互为前缀（开了 `notimeout` 时） |
| 怀疑配置有语法错误 | `idea.log` 里搜 `vimscript.Executor`，有 `Unknown option` 等提示 |

---

## 七、小结

1. 换电脑时，**插件要手动装**、**`.ideavimrc` 要单独拷**、**位置要放对**。
2. `.ideavimrc` 写错了大多不会报错，定期去 `idea.log` 里搜 `vimscript.Executor` 体检一下。
3. `notimeout` 和 Which-Key 是好搭档，但要避免互为前缀的映射。
4. 熟练靠的不是配置多，而是**Which-Key 随查 + 每周 5 个刻意练习**。
