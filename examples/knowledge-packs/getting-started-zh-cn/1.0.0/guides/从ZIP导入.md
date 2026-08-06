# 从 ZIP 导入

当他人分享了可移植 Nest 知识包，或在电脑之间迁移知识包时使用 ZIP。

## 步骤

1. 点击右上角 **Hub → Import → Import pack ZIP**。
2. 拖入 ZIP 或浏览选择文件。
3. 如果没有 `pack.json`，检查自动填写的信息后选择 **Create pack**；否则选择
   **Import ZIP**。
4. 如果相同知识包已安装，确认替换。

Nest 每个知识包 ID 只保留一个版本，原始 ZIP 保持不变。使用 **Export ZIP** 生成的
文件已包含 `pack.json`；普通 ZIP 只需至少一个 Markdown 文件，其余由 Nest 自动
补全。
