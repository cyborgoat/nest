# 接入 Agents 开始对话

Nest 的聊天由 **Agent**（生成回答、调用工具的后端）驱动。应用内置两个
Agent，每个会话固定使用它开始时的那一个。

## 两个 Agent

| | Nest Agent | Claude Agent |
|---|---|---|
| 运行在 | 你配置的任意 OpenAI 兼容 API 模型上 | 本机 Claude CLI 上 |
| 配置 | 在 Settings 填 API 基础 URL、密钥和模型名 | 在 Settings 开启并 **Save and connect** |
| 知识工具 | 内置（搜索、读取、列出、暂存编辑） | 同样的工具，由 Nest 提供 |
| 引用 | 来自自身的检索 | 来自实际调用的知识工具 |
| 聊天模式 | Ask（只读）和 Agent（可审阅提案） | 同样两种模式 |

## 选择 Agent

聊天框左侧依次是 **Agent**、**Model**、**Mode** 三个选择器。

- 新会话在发出第一条消息前是**未绑定**的：发送那一刻你所选的 Agent
  生效，之后该会话一直使用它。
- 在已有消息的会话中切换 Agent，会**新建一个聊天**并把未发送的草稿
  带过去；原会话原样保留在历史里。
- 新建会话默认沿用最近一个会话的 Agent 和模型选择。
- 在 Settings 里停用某个 Agent 只影响新会话；已绑定它的会话保持绑定，
  Claude 会话会等待 Claude 重新启用后继续。

## Nest Agent 配置

聊天需要一个 OpenAI 兼容的 API。在 **Settings → LLM** 中填写基础 URL
（例如 `https://api.openai.com/v1`、OpenRouter 或自建端点）、API 密钥
和模型名即可，无需其他配置。该模型同时用于生成会话标题。

## Claude Agent 配置

Claude Agent 通过你电脑上已安装并登录的 Claude CLI 进行对话。

1. 在 **Settings → Claude Agent** 中开启 **Enable Claude Agent**。
2. 填写 CLI 路径，或留空点击 **Auto-detect** —— Nest 会自动识别
   `claude.exe`、npm wrapper 或 `claude` shim。检测失败时输入框提示
   会变为 `Auto-detect Not Found`。
3. 点击 **Save and connect**。Nest 会验证 CLI 可运行、发送一条真实
   测试消息，并在临时知识包中逐一试用全部六个知识工具，结束后自动
   清理。每一步都通过才算连接成功。

### 模型

Claude Agent 的模型来自两处：

- CLI 当前使用的模型，在聊天框中带 `(default)` 标记。
- 你在 Settings **Custom models** 里列出的模型（一行一个）。成功测试
  和对话中实际用过的模型也会自动出现在聊天的模型列表中，无需手动抄录。

模型按消息生效，可以在对话中途切换。

## 知识工具与提案

在 **Agent** 模式下，两个 Agent 使用同一套 Nest 工具修改启用知识包中
的 Markdown：编辑先暂存为提案，在查看器中预览，只有你在编辑器里批准
后才会写入磁盘。两者遵循相同的限制：仅限可编辑的启用知识包、仅限
Markdown、每轮最多 32 个文件和 2 MiB、编辑器中打开的文件和审核中的
知识包受保护。

Claude Agent 在 **Agent** 模式下同时保留 Claude 的原生工具（Bash、
Edit、Write 等）。用这些工具做出的修改会**直接写入磁盘，不会作为提案
暂存** —— Nest 会在工具活动列表中把它们标为直接修改，便于区分。

**Ask** 模式对两个 Agent 都是只读的。

## 工具活动与引用

Agent 工作时，聊天里每个工具调用显示为一行实时状态（运行中转圈、
完成后打勾）。回复结束后，可折叠的 **“Thought for N seconds · N tool
calls”** 区块保留完整列表。

回复底部的引用列出 Agent 实际读取或搜索过的文件。重要论断请对照引用
核实。
