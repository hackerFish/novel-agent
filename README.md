# 执笔 NovelAgent —— 长篇连载创作 Agent

参考 [AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) 流程精简而成的**长篇连载创作 Agent**（客户端优先，本地模型优先）：Step1 设定 → Step2 目录 → Step3 写章 → Step4 定稿 → Step5 发布，去 AI 味、可持续连载。

## 与 AI_NovelGenerator 的对比

| 能力           | AI_NovelGenerator | NovelAgent（本项） |
|----------------|-------------------|----------------|
| 四步流程       | ✅ 设定→目录→写章→定稿 | ✅ 同左 + Step5 发布 |
| 雪花法/角色弧光 | ✅ 详细 prompt | ✅ 精简版 |
| 前文摘要+角色状态 | ✅ | ✅ |
| 一致性审校     | ✅ | ✅ 可选 + 自动修复 |
| 向量检索引擎   | ✅ Embedding+向量库 | ❌ 去掉（依赖重） |
| 知识库         | ✅ | ❌ 去掉 |
| 多 LLM 适配器  | 多种云/本地 | 仅 Ollama + OpenAI 兼容 |
| 技术栈         | Python + GUI | Node + React（单页） |
| 发布支持       | ❌ | ✅ 番茄批量排程/发布包 |

只保留精华：**设定→目录→写章→定稿** 与 **前文摘要/角色状态**，不做向量与知识库，结构更轻。

**几百万字长篇与大纲**：Step1 可设章节数最高 5000 章（约千万字量级）；超过 80 章时设定中会自动包含「全书总纲（分卷梗概）」便于长篇不跑偏。Step2 超过 60 章时自动改为**分卷生成目录**（每卷建议 10–50 章，单次最多 50 章以保证格式稳定），按卷逐次生成并追加；生成后会做**目录校验**，有问题时自动让 AI 修正，保证整本书都有清晰大纲。

## 环境与运行

- **Node.js** 18+
- 本地生成建议：**Ollama** + 14b+ 模型（如 `qwen2.5:14b`）

```bash
cd novel-agent
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..
npm run dev
```

浏览器打开终端提示的前端地址（如 http://localhost:5173），后端 http://localhost:3001。

**持久化**：配置保存到 `server/.t-book-config.json`，项目（设定、目录、已写章节、摘要与角色状态）保存到 `server/.t-book-project.json`，重启不丢。顶部「保存项目」可随时手动保存；有已写章节时可用「导出全书」按章节顺序导出为 TXT。

**上下文与 API 限制**：对接 [DeepSeek API](https://api-docs.deepseek.com/) 时，推荐使用 `deepseek-v4-flash`（快速）或 `deepseek-v4-pro`（高质量）；旧名 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 弃用。V4 支持 1M 上下文，写章仍按保守预算截断设定/摘要/上一章结尾等字段，并在发送前做总长度校验；截断时尽量在行末或句末切断，保证问答连贯、不缺失关键指令。

## 使用流程

1. **配置**：点「配置」→ 选 Ollama 或 OpenAI，填地址/模型/Key → 保存；Ollama 可点「检测 Ollama」。右上角会显示「已连接」/「未连接」表示后端是否可用；项目加载失败时会提示并可「重试」。
2. **Step1 生成设定**：填主题、类型、章节数（支持几百～五千章）、每章字数 →「生成设定」。得到核心种子+角色+世界观+情节架构；篇幅超过 80 章时还会生成「全书总纲（分卷梗概）」。
3. **Step2 生成目录（大纲）**：总章数 ≤60 时一次生成全部目录；>60 章时按卷生成（每卷建议 10–50 章），多次点击「生成第 N 卷」逐卷追加；支持「全自动生成大纲」连续生成到结尾。生成后会做目录校验，未通过时自动尝试修正。可编辑后点「解析目录」供 Step3 选章；「已生成到第 X 章」以实际解析出的最大章节号为准。
4. **Step3 写章**：用「上一章/下一章」或下拉选章节号，可选填「本章指导」与去 AI 味强度 →「生成本章」。正文旁显示约字数；可对当前章做「一致性审校」（可勾选「生成后自动一致性校验」），再前往 Step4。顶部「导出全书」可导出已写章节为 TXT。
5. **Step4 定稿**：选已写章节 →「定稿本章」→ 自动更新前文摘要与角色状态，便于下一章衔接。可手动编辑摘要与角色状态。

重复 Step3→Step4 直到全部章节完成。右上角 💬 可打开「与 AI 对答记录」侧边栏，查看各步与 AI 的完整对话。

## 项目结构（精简）

```
novel-agent/
├── client/                 # Vite + React 单页
│   ├── public/             # favicon 等静态资源
│   └── src/
│       ├── components/     # ConfigPanel, Step1~5
│       └── App.tsx         # 五步状态与流程
├── server/
│   └── src/
│       ├── index.js
│       ├── config.js
│       ├── llm/adapter.js   # Ollama / OpenAI
│       ├── writer/
│       │   ├── prompts.js   # 设定/目录/章节/摘要/角色状态/一致性
│       │   ├── humanize.js  # 去 AI 味后处理
│       │   ├── directoryParser.js
│       │   ├── directoryValidator.js
│       │   ├── formatEngine.js
│       │   ├── tomatoQuality.js  # 番茄可读性本地评分
│       │   ├── voiceCard.js      # 口吻卡
│       │   ├── chapterPipeline.js
│       │   └── generator.js
│       ├── publish/schedule.js   # 番茄定时发布排程
│       ├── storage/chapterStorage.js
│       └── routes/
│           ├── workflow.js  # step1~4, directory/parse, check-consistency
│           ├── project.js   # GET/POST /api/project 项目持久化（多书）
│           ├── publish.js   # 发布排程 / 批量导出 / 自动发布
│           ├── book.js      # 批量生产中心 / 全书审计
│           └── config.js
├── writer/
│   ├── bookState.js  # 能力图鉴 + 伏笔追踪器（结构化状态机）
│   ├── directorOutline.js  # 导演式顶层大纲 + 单章细纲
│   └── ...
├── branding/               # 品牌图标（SVG/PNG 多尺寸）
├── package.json
└── README.md
```

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查（前端用于显示「已连接」/「未连接」） |
| GET/POST | /api/project | 读/写项目状态（设定、目录、已写章节、摘要、角色状态、lastGeneratedChapter） |
| GET/POST | /api/config | 读/写运行配置 |
| GET | /api/config/ollama | 检测 Ollama |
| POST | /api/step1-setting | 生成设定 |
| POST | /api/step2-directory | 生成目录（支持分卷；返回 validation、messages 等） |
| POST | /api/directory/parse | 解析目录为章节列表 |
| POST | /api/step3-chapter | 生成单章 |
| POST | /api/chapter/pipeline | 单章全流程：生成→一致性→定稿（一键流水线） |
| POST | /api/book/batch-generate | 批量生产：断点续传生成到目标章（生产中心） |
| GET | /api/book/batch-generate/status | 批量生产进度 |
| POST | /api/book/audit | 全书审计：番茄分/AI味/问题章节/伏笔能力统计（品控看板） |
| POST | /api/book/promotion-score | **番茄推流验证分**：6维度×10分=60分制，满分才可发布 |
| POST | /api/outline/director | 导演式顶层大纲（分卷蓝图/爽点/伏笔/结局） |
| POST | /api/outline/chapter | 单章执行细纲（目标/开场钩/爽点/章尾钩/伏笔） |
| POST | /api/chapter/format | 章节本地格式修复 + 番茄可读性评分 |
| POST | /api/step4-summary | 更新前文摘要 |
| POST | /api/step4-character-state | 更新角色状态 |
| POST | /api/check-consistency | 一致性审校 |
| POST | /api/chapter/consistency-repair | 一致性自动修复 |
| GET | /api/voice-card/presets | 口吻卡预设 |
| POST | /api/publish/schedule | 番茄发布排程预览 |
| POST | /api/publish/batch-export | 批量导出发布包（分章 txt + CSV） |
| POST | /api/publish/apply-schedule | 写入各章建议发布时间 |
| GET/POST | /api/books | 多书管理 |

## 许可

MIT
