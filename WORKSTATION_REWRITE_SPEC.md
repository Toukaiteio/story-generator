# story-generator UI / 交互完全重做 — 监督规格（dsh 执行用）

## 0. 硬约束（违反即返工）
- 基准分支：`dev`，当前 HEAD `d8d1923 feat: decouple UI from engine and rebuild studio workstation`。
- 工作分支：新建 `ui-workstation-rewrite`，从 `dev` 切出。禁止改 `main`，禁止 `git push`，禁止 force-push，禁止删除任何已有功能。
- 功能只允许“换入口”，不允许“删入口”。文末的功能清单每一项必须在新 UI 里找到对应入口，否则该项算未完成。
- 禁止在任何文件、日志、提交信息里写密钥、API key、token。已有 IPC `file:read/write` 不得扩大暴露面；如需动 `electron/main.ts`，只做图标与窗口配置，文件通道保持原样或只收紧。
- 代码风格遵循仓库 `AGENTS.md`：文件超过约 400 行就拆分；注释只写代码表达不了的约束；不写填充注释；UI 文案直接说事，不写“Not X but Y”、不写鸡汤收尾、不写聊天机器人客套话。
- 不许做表面功夫：每个按钮、每个胶囊、每个 AI 建议都必须真实调用已有 `src/app` / `src/services` 的动作，禁止空按钮、禁止假数据、禁止用占位文案冒充功能。
- 语言：UI 保持现有中英 i18n 结构，不新增语言文件体系；新增文案必须同时进 `zh` 与 `en`（或走现有 `translatePhrase` 机制），不留硬编码英文孤岛。

## 1. 审计结论（已核实，执行时不得推翻）
- 技术栈：Vue 3 + Vite + TypeScript + Pinia + Electron，`pnpm`，`tailwindcss 3`，`lucide-vue-next`。
- 现有问题根源：
  1. 配色是 GitHub 深色系：`tailwind.config.ts` 里 surface `#0d1117/#161b22/#1c2128/#21262d/#2d333b`，accent `#58a6ff`，与用户定的 iOS + 胶囊风完全不符。
  2. 圆角是 `0.375rem` / `rounded-2xl` 混用，不是全胶囊；`src/assets/styles/main.css` 里大量 `.app-panel/.app-list-item` 是 6px 方角面板。
  3. 空间浪费：`StoryView.vue` 是 `mx-auto max-w-3xl` 居中窄栏；`StudioShell.vue` 左边 56px 第二轨 + 右边常开 Copilot 抽屉 + 顶栏，三层夹击后正文只剩一条缝，截图正是这个状态。
  4. 线性页面：路由是 Projects / Workspace / Knowledge / Styles / Providers / Settings 六个独立页，截图黄框就是左侧这 6 个入口。进一个页就丢掉小说上下文，写小说不是这样工作的。
  5. 输入过多：`src/components + src/pages + src/layouts` 里 `BaseInput/BaseTextarea/<input>/<textarea` 命中 70 处；`CharacterDetail.vue` 一个人物就有 8 个 textarea；`Providers.vue` 1752 行、`WritingStyles.vue` 1081 行、`KnowledgeBase.vue` 921 行，全是表单页。
  6. 小字解释过多：`text-2xs` 在 `src` 里命中 51 处，大量大写小标题 + 灰色说明，是用户明确禁止的“多余小字组件”。
  7. 程序图标缺失：仓库里没有任何 icon 资产，`electron/main.ts` 未设置窗口图标，`package.json` 的 electron-builder 配置未设置 icon，打包出来就是默认 Electron 图标。
- 已有、且必须保留的底层能力（不要重写引擎，只改 UI 与调用方式）：
  - `src/services/elements/`：`StoryElement` + `states[]`，`elementStateAt(element, chapterIndex)`、`buildElementContextForChapter`，状态含 `chapterIndex/time/location/status/summary`。
  - `src/app`：`useStoryEngine / useStudioActions`，含 `proposeChapterPlan / applyChapterPlan / acceptChapterPlan / proposeElementStates / applyElementProposals / addElement / removeElement / setElementStatus / improveSelection / continueChapter / humanizeText / humanizeChapter / recap / proofreadChapter / polishChapter / askCopilot / draftStorySeed / draftProjectConfig`。
  - `src/services/agent/`：`loop.ts / piContext.ts / contextData.ts`，AgentLoop 要求稳定前缀（system + 项目上下文每轮只构建一次、只追加、不重排），这是缓存命中与行为稳定的前提，UI 不得每动作重建上下文。
  - 导出：`markdown / json / plaintext / epub`（`src/services/export/`）。

## 2. 新视觉系统（全部组件、全部改）
- 风格锚点：iOS 系统风，不是 GitHub 风，不是游戏风，不是霓虹风。
- 配色（只用这一套，不许多彩）：
  - 背景：`#F2F2F7`；卡片/工作面：白色 `#FFFFFF`；次级面：`#E5E5EA`；分隔线：`rgba(0,0,0,0.08)`。
  - 文字：主 `#000000` / `#1C1C1E`，次 `#3C3C43`（60% 透明度写法亦可），弱 `#8A8A8E`，只用于确实次要的元信息，不用于解释。
  - 强调色：只用一个系统蓝 `#007AFF`，hover `#0A84FF`，柔和底 `#EAF4FF`。成功/警告/危险只在状态本身出现，不做装饰性彩虹。
  - 旧色值验收：`grep -r "0d1117\|161b22\|58a6ff\|1f6feb" src tailwind.config.ts` 必须为 0（历史注释也不留）。
- 形状：
  - 所有按钮、分段控件、标签、筛选、状态、操作条：一律胶囊 `rounded-full`，最小触达高度 44px（桌面紧凑场景可 36px，但不得低于 32px）。
  - 卡片：圆角 20–28px，不是 6px；卡片之间用 12px 间距，不用细边框堆叠。
  - 导航、分段、操作条：胶囊容器 + 胶囊子项，选中项为白底阴影（iOS segmented 式），不是方块高亮。
- 字体与层级：
  - 字号层级只用 4 档：标题 20–24 / 正文 15–17 / 次要 13 / 元信息 12；删除 `text-2xs`（10px）解释性文案，`text-2xs` 在新 UI 里只允许出现在确实需要的时间戳/计数，且不得成段。
  - 层级靠字号与字重区分，不靠全大写小标题、不靠灰色说明段。
  - 正文行高 1.6–1.8，中文阅读优先；编辑区禁止把正文压成窄栏。
- 图标：
  - 全部用 `lucide-vue-next`，单色，大小 18–20；图标本身就是入口，不再配一段小字解释它是什么。
  - 新程序图标：胶囊底 + 书/笔的极简图形，浅色底、系统蓝图形、圆角图标规范。交付物：`build/icon.svg`（矢量源）+ `build/icon.png`（512px）+ `electron-builder` 配置（win/mac/linux 指向同一源，Windows 需 `.ico` 时用脚本从 PNG 生成，不许留默认图标）+ `BrowserWindow` 的 `icon` 指向该文件。图标不许用 emoji、不许用文字堆叠。

## 3. 一站式工作站结构（取代六页线性流）
- 只保留一个工作上下文：打开项目后不离开项目。顶栏不再是页面切换器，而是：项目胶囊（点开换项目/新建项目）+ 章节/元素上下文胶囊 + 全局命令入口（见 4）。
- 旧六页的新入口（缺一不可）：
  - Projects：工作站启动页 + 项目胶囊下拉，列表为胶囊卡片，含打开、删除、导出（md/json/txt/epub）。
  - Workspace/Studio：就是工作站本身，不再是其中一页。
  - Knowledge：工作站右侧“资料”抽屉 / 命令入口，不再独立页；功能：知识库、文档导入（文件选择器）、搜索、嵌入/检索，全部保留。
  - WritingStyles：工作站内“风格”抽屉 / 章节配置胶囊，功能：风格库、选择、编辑、快照，全部保留。
  - Providers：工作站内“模型”抽屉 / 设置入口，功能：供应商、模型目录、拉取模型列表、密钥与 baseURL、maxTokens 预设，全部保留。
  - Settings：工作站内“设置”抽屉，功能：语言、更新检查、通用设置，全部保留。
  - 路由可保留旧路径做深链兼容，但主 UI 不再用左侧图标栏做页面跳转；左侧那 6 个图标入口必须删除，截图黄框的那组页面形态不得复活。
- 工作站三区（可收起、可调宽，不许三层常驻夹击正文）：
  1. 左区（可收起为胶囊轨）：大纲与章节时间线，不是页面列表。章节是时间线上的卡片，可点跳、可拖动排序（已有数据结构支持时才做拖动，否则点跳 + 状态胶囊即算完成，不得做假拖动）。
  2. 中区（主区，默认占满剩余宽度）：写作面。默认不是 `max-w-3xl` 居中窄栏；正文宽度随窗口走，阅读宽度上限只在超宽屏时用柔和上限，且左右留白不得超过正文宽度的 25%。
  3. 右区（默认收起，点胶囊展开）：上下文区，含当前章节的元素状态、Copilot 建议、校对/润色 diff。展开时中区不被挤成窄缝；右区宽度上限 360px，且可一键收起回胶囊按钮。
- 非线性是硬性要求：从任何章节、任何元素、任何建议卡片都能直接跳到写作面对应位置，且不丢失当前章节/选区/元素选择；不许用“下一步/上一步”向导式流程组织写作。

## 4. 小说家工作流（先工作流，后界面）
以人类小说家抛开 AI 后的真实工作流为骨架，再把 AI 放在能真正省力的点上：
  1. 定 bible：人物、事件、线索、地点、物件，先有状态，再写正文。不是先填一堆表单再开始写。
  2. 搭软木板：章节卡片按状态（构思/草稿/校对/定稿）排布，随时插章、改顺序、回头改前面章节，AI 只做“下一章提议”与“本章计划 diff”，不做线性推进器。
  3. 写正文：选区即操作。选中一段文字，弹出胶囊操作条：加深、缩短、续写、换一种写法、去 AI 味、回顾前文；每个操作返回 diff 卡片，接受/拒绝，不直接覆盖原文。
  4. 过一遍：校对与润色是 diff 卡片流，不是新页面；每张卡片只说改了什么、为什么（不超过一行），接受/拒绝/只接受部分。
  5. 对账：写完一章后，系统按该章内容提议元素状态变化（人物状态、事件进展、线索埋/收、地点/物件变化），用户按条接受/拒绝；对不上的地方（新出现的人名、时间线冲突）必须显式标出，不得悄悄入库。
  6. 查资料：写作面内直接调知识库片段，插入的是引用卡片，不是把全文粘贴进正文。
- Word 痛点对应表（实现时逐条对号，不得只写文案）：
  - 版本与位置丢失 → 工作站保留章节/选区/元素三重上下文，切换不丢位。
  - 人物前后不一致 → 元素时间线 + 章节切片上下文注入生成（见 5）。
  - 伏笔埋了忘收 → 线索（thread）状态 `planted/advanced/paid` 必须在时间线上可见，收束时可点跳回埋设章。
  - 校对疲劳 → diff 卡片 + 批量接受/拒绝，不做全文重写。
  - AI 味与凭空编造 → 风格快照 + 人味化 + 上下文切片约束；AI 提议的新人名/新事件必须先作为元素提议出现，接受后才进 bible，不得直接写进正文后才发现。
  - 资料散落 → 知识库抽屉与引用卡片，不开新页。

## 5. 动态元素机制（本任务最重要的一块，必须真实可用）
- 数据模型不动结构、只补齐 UI 与调用：`StoryElement` 的 `states[]` 按 `chapterIndex` 排序，每个 state 有 `time/location/status/summary`。
- 元素视图重做：
  - 顶部是一条章节时间线滑块（第 0 章 → 最新章），拖动滑块即切换“在这一章时，世界是什么样”。
  - 列表按 kind 分胶囊筛选：人物 / 事件 / 线索 / 地点 / 物件；点一个元素，右侧（或下方抽屉）显示它的状态时间线：每一格是“在第 N 章 / 时间 / 地点 / 状态 / 摘要”，可点跳到对应章节。
  - 新增元素：只用“种类胶囊 + 名称”两个动作，名称可由 AI 根据当前章节提议（点选即建），不许再出现人物 8 个 textarea 的表单。
  - 人物详情：不再是 8 个 textarea 表单；改为：当前状态卡片 + 状态时间线 + 关系胶囊（与哪些元素在哪些章节有关联）+ 一个“备注”区（AI 起草、可接受/编辑）。人物原有字段（外貌、背景、动机、目标、冲突、当前状态）必须映射为状态摘要或备注内容，不得丢失，入口是时间线与卡片，不是表单页。
  - 写完一章后：自动调用已有 `proposeElementStates`，结果以“状态提议 diff 卡片”出现，每条可单独接受/拒绝；接受后调用 `applyElementProposals`，并在时间线上立即可见。
  - 生成上下文：写作、续写、计划、校对时，注入的是 `elementStateAt(当前章节)` 的切片，不是全量 bible；UI 上要能看到“当前章节注入了哪些元素状态”（胶囊列表，可点开看摘要，不展开全文）。
- 验收：新建一个测试项目（不提交到仓库），走“建元素 → 写一章 → 提议状态 → 接受 → 滑到下一章看状态已变”全程可用；只改 UI 不走通这条链，算未完成。

## 6. 少输入原则（可度量）
- 工作站主流程（Story / Board / Manuscript / Elements）里，自由文本输入只保留 4 类：
  1. 正文编辑区本身（写作面、提纲正文区）——这是作品，不是配置。
  2. Copilot 对话的唯一输入框 + 快捷动作胶囊（计划下一章 / 回顾 / 同步元素 / 校对 / 润色）。
  3. 搜索框（项目内搜索、知识库搜索、元素搜索各一处，共用样式）。
  4. 新建项目/新建元素的名称（单行、AI 可起草）。
- 其余一律改为：胶囊单选/多选、分段控件、模型与风格选择器（从目录拉取，不手输 ID）、数字用预设胶囊（章节数 4/8/12/16/24/32 已有，maxTokens 用预设档，不手输数字）、开关用胶囊开关。
- 供应商/设置页的密钥与 baseURL 是例外（确实必须手输），但必须配“拉取模型列表”与“从目录选模型”，不许让用户手输模型 ID + 显示名 + maxTokens 三连。
- 度量：重做后 `grep -rn "BaseInput\|BaseTextarea" src/components/studio src/components/character src/layouts` 的命中必须比现在显著下降，且 Studio 主流程里不得再出现带 label 的表单堆叠；最终报告里必须贴出重做前后的命中数对比。
- 禁止小字解释：删除 `text-2xs` 成段说明、大写小标题说明、控件下方灰色提示；控件本身（图标 + 短标签 + 选中态）必须自明，实在需要说明的，只允许在空状态放一句话。

## 7. AgentLoop 与 AI 辅助位置（只用已有引擎，不另起炉灶）
- 上下文构建：每轮 Agent 只构建一次前缀（system + 项目快照 + 当前章节切片 + 元素切片），之后只追加、不重排、不重写；UI 动作（点建议、换章节）不得触发整轮上下文重建。检查 `src/services/agent/loop.ts / piContext.ts / context/index.ts` 的现有实现，UI 层不得绕过它自造 prompt。
- 前缀一致性：同一轮内模型、风格快照、元素切片保持一致；换模型/换风格只在下一轮生效，UI 上用胶囊显示“本轮模型/风格”，不许在轮中悄悄换。
- AI 建议一律是可审查产物：章节计划 diff、选区改写 diff、元素状态提议、校对/润色 diff，全部是卡片 + 接受/拒绝，不是聊天正文让用户自己抄。
- Copilot 不再是常开抽屉：默认收起为右下角/右上角胶囊按钮，点开才是对话；对话里快捷动作胶囊优先，自由输入是兜底。
- 参考对象只借鉴交互模式，不抄代码、不引新依赖：Codex / Opencode / Pi 的 agent loop、工具调用状态、todo 进度、diff 审查模式；仓库已依赖 `@mariozechner/pi-agent-core / pi-ai`，继续用它。

## 8. 其他页面迁移清单（不删功能，只换入口）
- Projects：启动页胶囊卡片 + 项目胶囊下拉；新建项目用 AI 起草（`draftStorySeed / draftProjectConfig`）+ 一次确认，不用多页表单。
- KnowledgeBase：资料抽屉；导入用文件选择器；搜索用单搜索框；知识库新建只用名称胶囊 + 导入动作。
- WritingStyles：风格抽屉；风格卡片为胶囊列表，点选即用，编辑只在抽屉内做一次确认。
- Providers：模型抽屉；供应商卡片 + 模型目录选择 + 拉取模型列表；密钥/baseURL 保留手输，但配验证与拉取。
- Settings：设置抽屉；语言、更新、通用项用胶囊/分段，不用长表单。
- 导出：项目胶囊菜单里保留 md/json/txt/epub 四种，不许少一种。
- 角色、章节、元素、风格、知识库、供应商的旧数据结构与本地持久化保持兼容，不做破坏性迁移；如需迁移，必须写迁移函数 + 旧数据回退测试。

## 9. 本次执行分工（dsh 只做 Phase 1，Phase 2 等用户看完再定）
- Phase 1（本次必须交付）：
  1. `tailwind.config.ts + src/assets/styles/main.css`：新 iOS 胶囊视觉 token，旧 GitHub 色清零。
  2. `src/components/ui/` 全量：BaseButton/BaseSegmented/BaseTag/BaseBadge/BaseCard/BaseDialog/BaseDrawer/BaseDropdown/BaseSelect/BaseInput/BaseTextarea/BaseTooltip/EmptyState/ProgressBar/Spinner/ToastContainer/ToolCallStatus/TodoListStatus，全部改为胶囊 + iOS 视觉，API 尽量兼容，改 API 时必须同步改调用处。
  3. `src/layouts/WorkStation.vue + src/components/layout/AppSidebar.vue + AppHeader.vue`：删除左侧六图标页面栏，改为工作站壳 + 项目胶囊 + 命令入口。
  4. `src/components/studio/StudioShell.vue + StudioRail.vue + StoryView.vue + BoardView.vue + ManuscriptView.vue + ElementsView.vue + ElementDetail.vue + CharacterDetail.vue + CopilotDrawer.vue + SuggestionCard.vue + ChapterCard.vue + NewStoryDialog.vue`：按 3/4/5/6 重做，功能全部接线。
  5. `build/icon.svg + build/icon.png + electron-builder icon 配置 + BrowserWindow icon`：新程序图标。
  6. 其他页（Knowledge/WritingStyles/Providers/Settings/Projects）在 Phase 1 至少完成：视觉 token 统一 + 入口迁移到工作站抽屉/菜单（功能代码可先复用旧组件，但不得再以独立页面形态出现为主入口）；若时间/复杂度不允许全量重做，必须在最终报告里逐页列出“已迁移 / 仍复用旧组件 / 下一步”，不许含糊说“都改了”。
- Phase 2（本次不做，只列出，不许提前做一半留尾巴）：
  - 知识库/风格/供应商/设置的抽屉全量重做 + 命令面板（Cmd/Ctrl+K）+ 元素时间线拖动与冲突检测 + 更多自动化测试。
- 完成标准（监督方会逐项跑）：
  - `pnpm install && pnpm build` 通过；`npx vue-tsc --noEmit` 通过（或把现有失败逐条列出并修掉，不得忽略）。
  - `pnpm vitest run` 现有测试通过；元素时间线新增至少 1 个测试：`elementStateAt` 在章节切换时返回正确切片，提议接受后状态可见。
  - `git status` 只在 `ui-workstation-rewrite` 分支上有改动；`git diff --stat` 贴在报告里；不得有未提交的密钥文件。
  - 功能清单逐项打勾（见文末），缺项即返工。

## 10. 功能清单（逐项核对，执行报告必须原样贴出并打勾）
- [ ] 项目：新建（AI 起草 + 确认）、打开、切换、删除、导出 md/json/txt/epub
- [ ] 大纲：查看、编辑、保存、AI 生成/扩展大纲
- [ ] 项目配置：体裁、章节数、写作格式、语言、风格选择（胶囊/选择器，不用表单堆叠）
- [ ] 章节：计划下一章、计划已有章节、接受/丢弃计划 diff、打开写作、校对、润色
- [ ] 写作：标题、正文、选区操作（加深/缩短/续写/换写法/去 AI 味/回顾）、续写流式、建议 diff 接受/拒绝、字数统计、自动保存
- [ ] 元素：新建（种类胶囊 + 名称）、筛选、详情时间线、状态提议、接受/拒绝、删除、改状态、关联人物
- [ ] 人物：详情（状态卡片 + 时间线 + 关系胶囊 + 备注）、原有字段内容不丢失
- [ ] Copilot：对话、快捷动作（计划/回顾/同步元素/校对/润色）、工具调用状态、todo 进度
- [ ] 知识库：新建库、导入文档、搜索、删除、嵌入/检索
- [ ] 风格库：查看、选择、编辑、新建、删除、风格快照
- [ ] 供应商：供应商列表、模型目录、拉取模型、密钥/baseURL、maxTokens 预设
- [ ] 设置：语言、更新检查、通用设置
- [ ] 图标与配色：新图标已接线、旧 GitHub 色清零、全部 UI 组件为 iOS 胶囊风

## 11. 给执行者的最后三句话
- 先读 `AGENTS.md` 与 `src/app/README.md`，再动手；不要凭想象重写引擎。
- 每改一个视图，先确认它调用的 `useStudioActions` 动作还在、参数没变；改 UI 不改引擎契约。
- 做完先自己跑构建与测试，失败就修，不要把失败留给监督方；报告里只写已验证的事实，不写“大概可以”。
