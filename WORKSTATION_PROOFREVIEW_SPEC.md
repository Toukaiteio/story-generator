# story-generator: 校对问题列表去卡片化（人机功效审计第一批）

## 背景
行内差异已改成正文原地渲染、无面板。校对问题列表是同一毛病：`src/components/studio/ProofreadingReview.vue`（ManuscriptView 主流程用）每个问题一张卡片，卡片里再套原文摘录框和建议修改框，同一改动要读两个框才能对照，顶上还有两个 pill，信号盖过正文。

## 必须做到的改动（只改呈现，逻辑不变）
1. 删掉每条问题的卡片边框与阴影，删掉原文摘录框和建议修改框。改动处在同一段流动正文里原地显示：原文用灰色删除线，建議用绿色，和行内差异同一渲染语言；标题一行，说明为普通灰字，不要再给说明加框。
2. 严重程度 + 类别两个 pill 合并成一行小灰字，例如“medium · 重复用词”，不再用 pill。
3. 每条的操作收成两个文字按钮：采纳修改 / 忽略。不再是胶囊按钮 + 图标按钮混搭；applyFix / ignore / polishAll / close 四个动作一个都不能少。
4. 顶部标题行保留（校对、N 个待处理、全部润色、关闭）。无问题时的空态改成普通文字，不再套卡片阴影。
5. 不改校对的计算、问题过滤（已修复/已忽略不显示）、采纳后写回逻辑；不碰行内差异已改好的部分。

## 硬约束
- 只在分支 ui-workstation-rewrite 上工作，基线 dev d8d1923；不推送、不动 main/dev、不删除任何功能；不写任何密钥/token。
- 保存的正文仍是纯文本。

## 验证与截图（监督方会独立重跑，但你必须先跑通）
- `XDG_RUNTIME_DIR=/tmp/xdg PNPM_HOME=/tmp/pnpm-home COREPACK_HOME=/tmp/corepack pnpm build` 通过；`vue-tsc --noEmit` 干净；vitest 通过。
- grep 门禁：旧 GitHub 配色 0；`text-2xs` 0；ProofreadingReview 里不再有 shadow-ios-pill / 内框 bg-danger-subtle + bg-accent-subtle 成对出现的结构。
- 中文截图（种子假项目，无真实数据，无密钥）到 `/tmp/proofreview-shots/`：(1) 多条问题的新列表，无卡片、无内框、无 pill；(2) 采纳一条修改后的状态；(3) 无问题空态。
- 最终报告必须包括：删掉的容器/边框/阴影/内框清单、新渲染规则、保留的动作清单、build/typecheck/test 结果、diff stat、剩余问题。截图只供监督方审查，不要自己发给用户。
