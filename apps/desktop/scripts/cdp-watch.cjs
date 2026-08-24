const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");

const args = process.argv.slice(2);
const portFlag = args.findIndex((a) => a === "--port");
const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 9222;
const secondsFlag = args.findIndex((a) => a === "--seconds");
const seconds = secondsFlag >= 0 ? Number(args[secondsFlag + 1]) : 60;
const evalFlag = args.findIndex((a) => a === "--eval");
const evalExpression = evalFlag >= 0 ? args[evalFlag + 1] : null;

const USAGE = `Usage: node scripts/cdp-watch.cjs [--port 9222] [--seconds 60] [--eval "<js>"]

Attaches to the running Nest webview via the Chrome DevTools Protocol and
prints console output and uncaught exceptions in real time.

Prerequisites: start the app with the devtools port enabled first:

  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
  .\\tauri-dev.cmd

Options:
  --port <n>      CDP port (default 9222)
  --seconds <n>   listen duration before exiting (default 60)
  --eval "<js>"   evaluate an expression in the page after attaching
                  (default: dump a #root innerHTML preview)
`;

async function main() {
  let list;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    list = await response.json();
  } catch (error) {
    console.error(
      `[error] cannot reach CDP port ${port}: ${error.message}\n` +
        `Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${port}" (see usage below).`,
    );
    console.error(USAGE);
    process.exit(1);
  }
  const page = list.find((p) => p.type === "page" && p.url.includes("localhost"));
  if (!page) {
    console.error("[error] no Nest page found in CDP targets");
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl, {
    perMessageDeflate: false,
    maxPayload: 256 * 1024 * 1024,
  });
  const pending = new Map();
  let nextId = 1;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args ?? [])
        .map((a) => a.value ?? a.description ?? "")
        .join(" ");
      console.log(`[console.${message.params.type}] ${text}`);
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      console.log(
        `[exception] ${details.text} ${details.exception?.description ?? ""}`,
      );
    }
  });

  ws.on("open", async () => {
    await send("Runtime.enable");
    await send("Page.enable");
    const expression =
      evalExpression ??
      `document.querySelector('#root')?.innerHTML.slice(0, 200) ?? 'no #root element'`;
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    console.log("[eval]", JSON.stringify(result.result?.value));
    console.log(`[ready] listening on port ${port} for ${seconds}s`);
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, seconds * 1000);
  });

  ws.on("error", (error) => {
    console.error(`[error] websocket: ${error.message}`);
    process.exit(1);
  });
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

if (!fs.existsSync(path.join(__dirname, "..", "node_modules", "ws"))) {
  console.error(
    "[error] ws is not installed. Run: npm install -D ws --no-save",
  );
  process.exit(1);
}

main();
