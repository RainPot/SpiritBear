<div align="center">

<img src="public/icon/128.png" width="76" height="76" alt="Spirit Bear logo">

# Spirit Bear

A browser agent in your Chrome side panel. Bring your own model.

[简体中文](README.zh-CN.md) · [Quick start](#quick-start) · [Try a task](#try-a-task) · [Technical design](docs/technical-design.md)

</div>

Open a page and give Spirit Bear a task. It can read the current tab, search a site, compare pages, and organize Chrome tabs. Reference tabs with `@` or attach a screenshot or file. Ask for Markdown when you want a copy on disk.

<p align="center">
  <img src="docs/assets/task-preview.png" width="460" alt="Spirit Bear reads two browser tabs, shows the activity, and summarizes with source links">
  <br>
  <sub>Example run in Chrome on two local test pages.</sub>
</p>

## Quick start

You need **Chrome 116+**, **Node.js 22.12+**, and an API key for a hosted model or access to a compatible local endpoint.

```bash
git clone https://github.com/RainPot/SpiritBear.git
cd SpiritBear
npm ci
npm run build
```

1. Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**. Select `.output/chrome-mv3` in the project directory.
2. Open **Spirit Bear** from the Chrome toolbar. Go to **Settings → Model connections** and choose OpenAI, DeepSeek, or a custom OpenAI-compatible endpoint.
3. Enter the endpoint and key, then click **Connect and test**. Grant Chrome access if prompted. The model list loads automatically. To change the default later, open **Manage** and pick a model from the dropdown.
4. Return to chat. Choose a model and, where available, its reasoning effort beside the message box. Open a page and send a task.

## Try a task

| What you want | What to ask |
| --- | --- |
| Compare pages | “Compare `@Navigation guide` and `@Permissions guide`. Keep the source links.” |
| Research a topic | “Use this site's search box to find three frontend interview notes. Group the questions by topic and save the summary as Markdown.” |
| Organize tabs | “Group the V2EX tabs in this window into a group named Forums.” |
| Read an account page | “Check the balance for this account.” From a help page, Spirit Bear can follow a visible link to the account portal. |
| Read a file | Attach a screenshot, PDF, spreadsheet, or text file and ask for the points you need. |

The current HTTPS tab is included by default. Use `@` to add more tabs, or remove the current tab from the message. **History** opens a dedicated view for returning to earlier chats. **Summarize this page** and **Translate this page** are available when a supported page is active.

## Model connections

OpenAI and DeepSeek have built-in connections. For a custom endpoint, use a base URL that supports Chat Completions and a `GET /models` catalog. The list loads from the configured endpoint. The side panel refreshes connected providers' catalogs when it opens. DeepSeek Pro appears in the chat picker when the endpoint returns `deepseek-v4-pro`. [OpenAI model list](https://developers.openai.com/api/reference/resources/models/methods/list) · [DeepSeek model list](https://api-docs.deepseek.com/api/list-models/)

The connection test checks tool calling with the selected default model. You can switch models in chat. Reasoning effort is saved per model.

## Browser access and data

- Task tabs open in the background. You can pause, open the active task page, and resume. Handle sign-in or verification on the page when the task asks for your help.
- Chrome grants access to sites as the task needs them. Your prompt and the page or file content used for the task go to the model endpoint you select.
- Chat history and attachments are stored locally. API keys are kept for the current Chrome session. Markdown exports use Chrome's downloads.

## Development

```bash
npm ci
npm run typecheck
npm run dev
```

Spirit Bear uses **TypeScript**, **React**, **WXT**, and **LangGraph.js**. The side panel runs the agent loop. The Chrome service worker executes browser actions and records their results. Run `npm run build` for a production unpacked extension. See the [technical design](docs/technical-design.md) for the page observation protocol, permissions, and report validation.

Browser interaction and setup flows take inspiration from [Kaze](https://kaze.build/), [Nanobrowser](https://github.com/nanobrowser/nanobrowser), and [Browser Use](https://github.com/browser-use/browser-use). Provider icons are from the [OpenAI developer site](https://developers.openai.com/) and [DeepSeek API docs](https://api-docs.deepseek.com/).
