# LLM Agents

Notes on structuring LLM agent workflows: perception, planning, tool use, and memory.

## Workflow overview

![Agent workflow diagram](./agent-workflow.png)

## Control flow

```mermaid
graph TD
    A[User request] --> B[Planner]
    B --> C{Needs a tool?}
    C -->|Yes| D[Call tool]
    D --> B
    C -->|No| E[Respond]
```

## Example tool call

```ts
async function callTool(name: string, args: Record<string, unknown>) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(args);
}
```

## Reference

![Placeholder reference image](./exmaple-placeholder.jpeg)
