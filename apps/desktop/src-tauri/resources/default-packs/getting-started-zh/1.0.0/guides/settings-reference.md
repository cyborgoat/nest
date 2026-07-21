# 设置说明

本页说明每个设置项的作用以及何时需要调整.

| 设置项 | 用途 | 常见值 |
|---|---|---|
| LLM Base URL | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| API key | 模型服务鉴权密钥 | 服务提供方密钥 |
| Chat model | 用于生成回答的模型 | `gpt-4o-mini` |
| Hub URL | 远程目录/下载服务地址 | `http://127.0.0.1:8787` |
| Font size | 全局界面字体大小 | 默认 `10pt` |
| User name | 可选显示名称 | 你的名称 |
| Knowledge directory | 知识包本地存储位置 | 留空 = 应用默认 |

## Knowledge directory 提示

- 留空时使用应用默认位置.
- 如果手动填写, 请使用绝对路径.
- 修改后 Library 会切换到新目录并刷新显示.

## Hub URL 提示

- 需要使用 `http` 或 `https`.
- 地址末尾是否有 `/` 都可以, 应用会自动处理.
- 留空时会禁用 Hub 功能, 但本地浏览与聊天仍可使用.
