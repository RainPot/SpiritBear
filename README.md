# TabErrand

在 Chrome 侧栏里用自己的模型对话。TabErrand 可以回答问题、阅读当前网页、搜索资料和整理来源，需要时把结果保存成 Markdown。

> TabErrand v0.2.0 可在本地加载。下图是对话侧栏的运行画面，使用受控网页的示例数据。

![TabErrand 对话侧栏。@ 标签页随消息发送，助手回复带来源并附 Markdown 文件。](docs/assets/task-preview.png)

[本地加载](#本地加载) · [任务示例](#一条任务从哪里开始) · [技术方案](docs/technical-design.md)

## 一条任务从哪里开始

> 在小红书搜索「前端面经」，阅读 5 条相关笔记，按知识点、项目追问和面试流程整理，附上原文链接，保存为 Markdown。

侧栏收到任务后，TabErrand 会新建一组任务标签页，在你授权的站点里搜索、筛选并打开结果。点击「接管网页」会先暂停后续动作，再切到正在处理的页面。需要登录或遇到验证码时，侧栏会提示你打开相应页面，处理完可点「继续任务」。任务标签页可以逐个打开，完成后也可以一次关闭。

当前 HTTPS 标签页会自动出现在输入框的参考列表里。打开小红书首页后，可以直接说「在这里找前端面经」。输入 `@` 可以加入其他页面，例如「比较 `@文档 A` 和 `@文档 B` 的接入要求」。

```mermaid
flowchart LR
  A["发送消息与标签页参考"] --> B["按需搜索或阅读"]
  B --> C["在对话中给出结果"]
  C -->|"明确要求保存"| D["自动下载 Markdown"]
```

这条示例明确要求保存。完整报告会自动下载到 Chrome 的下载目录，侧栏提供「在文件夹中显示」和「另存为」。如果只收集到部分材料，侧栏会显示缺了什么，并保留已收集的草稿。

### Markdown 节选

以下内容和链接用于展示文件格式。

```markdown
# 前端面经整理

## 知识点
- 浏览器缓存：整理协商缓存与强缓存的面试问法。[1]

## 项目追问
- 准备一例性能优化，讲清定位过程、改动和验证数据。[2]

## 来源
1. [缓存相关问答](https://example.org/interviews/cache)
2. [项目复盘示例](https://example.org/interviews/project-review)
```

## 连续对话

输入框默认带上活动的 HTTPS 标签页，发送前可以移除。当前页的标题和站点随引用进入任务。Agent 需要读取未授权站点的正文时，会在该轮对话中请求权限。按 Enter 发送，Shift+Enter 换行。

从输入框切换模型。发送后在对应回复中查看浏览动作和接管入口，运行中也可以从输入框暂停。追问会带上近期回复和已采集的来源。

点击「新对话」开始独立对话，从「历史」可以回到已有记录。结果默认显示在对话中。需要下载时，在指令里写「保存为 Markdown」，或者事后从回复下方点击「保存 Markdown」。

打开普通 HTTPS 网页、清空输入框后，可以点「总结本页」或「翻译本页」。助手读取当前页最多 5,000 字符的可见正文，把摘要或简体中文译文发到对话里。

在「设置 → 站点指引」可以保存某个站点的搜索入口、筛选步骤等经验。例如，为 `www.xiaohongshu.com` 保存「从首页搜索框输入关键词，按最新排序」。对应站点进入授权范围后，指引会随浏览任务发给模型。

## 首版能力

| 能力 | 你可以做什么 |
| --- | --- |
| 标签页上下文 | 默认附上当前页，用 `@` 选择其他页面。 |
| 任务标签组 | 让 Agent 在专用标签页里导航、输入搜索词、筛选、滚动和阅读。 |
| 进度与接管 | 查看操作进度、暂停并切到当前页、继续任务或关闭该任务打开的标签页。 |
| 网页快捷操作 | 总结或翻译当前页可见正文，在对话里查看。 |
| 站点指引 | 按站点保存自己的搜索和筛选经验，下次浏览该站点时供模型参考。 |
| 带来源的 Markdown | 在侧栏预览按主题整理的内容，打开原文核对，在本地找到文件。 |
| 自选模型 | 连接 OpenAI、DeepSeek 或自定义兼容端点。可以配置多个模型 ID，在输入框切换。 |

首版只需安装 Chrome 扩展，可以使用当前 Chrome 会话访问已授权的页面。资料整理任务在侧栏打开时运行，关闭侧栏会暂停后续操作。文件和任务记录保存在本机。使用远程模型时，任务描述和整理所需的页面片段会发送给你配置的服务商。

## 本地加载

准备 Node.js 22.12+ 和 Chrome 116+。在仓库根目录运行：

```bash
npm ci
npm run build
```

1. 在 Chrome 打开 `chrome://extensions`，打开「开发者模式」，点「加载已解压的扩展程序」，选择构建输出 `.output/chrome-mv3`。
2. 点击工具栏的 TabErrand 图标打开侧栏。在「设置」里连接 OpenAI、DeepSeek 或自定义端点，填写 API 地址、密钥和模型 ID，再点「连接并测试」。模型 ID 每行一个，自定义本机兼容端点支持 HTTP。
3. 回到对话，在输入框选择模型。直接提问，或打开目标网页后交给 Agent 一个任务。当前页自动附上，也可以用 `@` 添加其他页面。
4. 在对应的助手消息中查看结果。明确要求保存时，Chrome 会尝试将完整结果下载到默认位置下的 `TabErrand/`。

API Key 仅保存在当前 Chrome 会话。任务需要登录或验证码时，打开任务页手动处理，再回侧栏点击「继续任务」。

## 开发

扩展使用 TypeScript、React 和 WXT，侧栏通过 LangGraph.js 的 `StateGraph` 编排模型、工具和回复，Service Worker 派发实际网页动作并把运行记录写入 IndexedDB。

`npm run typecheck` 检查类型，`npm run dev` 启动 WXT 开发环境。接入方式、任务状态与验收范围见 [技术方案](docs/technical-design.md)。

## 参考项目

- **Kaze** 的侧栏、任务标签组、页面翻译和站点技能启发了浏览交互。**DeepSeek** 的聊天和历史记录启发了对话布局。[Kaze 官网](https://kaze.build/) · [Kaze 项目说明](https://github.com/jackwener/Kaze#readme) · [DeepSeek](https://www.deepseek.com/en/download/)
- **Codex** 的对话轮次、任务进度和暂停入口用于参考侧栏的工作流程。[Codex App Server](https://learn.chatgpt.com/docs/app-server) · [长任务交互](https://learn.chatgpt.com/docs/long-running-work)
- **Browser Use** 的 README 用任务演示展示 Agent 实际做了什么，再给出入口。[Browser Use README](https://github.com/browser-use/browser-use#readme)
- **Nanobrowser** 展示了 Chrome 扩展与自备模型的组合，README 给出了模型配置和首条任务的路径。[Nanobrowser README](https://github.com/nanobrowser/nanobrowser#readme)
