#!/usr/bin/env node
/**
 * Validate PyPI-style knowledge pack registry under examples/knowledge-packs.
 * Usage: node scripts/validate-pack-registry.mjs [registryRoot]
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const rootArg = process.argv[2];
const registryRoot = rootArg
  ? rootArg
  : join(
      fileURLToPath(new URL("..", import.meta.url)),
      "examples",
      "knowledge-packs",
    );

let errors = 0;
let packs = 0;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  errors += 1;
}

function warn(msg) {
  console.warn(`WARN: ${msg}`);
}

function hasMarkdown(dir) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of readdirSync(cur)) {
      if (name.startsWith(".")) continue;
      const p = join(cur, name);
      const st = statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (name.toLowerCase().endsWith(".md")) return true;
    }
  }
  return false;
}

if (!existsSync(registryRoot)) {
  fail(`Registry root missing: ${registryRoot}`);
  process.exit(1);
}

for (const projectName of readdirSync(registryRoot).sort()) {
  if (projectName.startsWith(".") || projectName === "README.md") continue;
  const projectDir = join(registryRoot, projectName);
  if (!statSync(projectDir).isDirectory()) continue;

  if (!PACK_ID_RE.test(projectName)) {
    fail(`Invalid project id folder: ${projectName}`);
    continue;
  }

  let versions = 0;
  for (const verName of readdirSync(projectDir).sort()) {
    if (verName.startsWith(".")) continue;
    const verDir = join(projectDir, verName);
    if (!statSync(verDir).isDirectory()) {
      warn(`Ignoring non-version file ${relative(registryRoot, verDir)}`);
      continue;
    }
    if (!SEMVER_RE.test(verName)) {
      fail(`Non-SemVer version folder: ${projectName}/${verName}`);
      continue;
    }

    const metaPath = join(verDir, "pack.json");
    if (!existsSync(metaPath)) {
      fail(`Missing pack.json: ${projectName}/${verName}`);
      continue;
    }

    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch (e) {
      fail(`Invalid JSON ${projectName}/${verName}/pack.json: ${e.message}`);
      continue;
    }

    if (meta.id !== projectName) {
      fail(
        `${projectName}/${verName}: pack.json id "${meta.id}" ≠ folder "${projectName}"`,
      );
    }
    if (meta.version !== verName) {
      fail(
        `${projectName}/${verName}: pack.json version "${meta.version}" ≠ folder`,
      );
    }
    if (!meta.name?.trim()) {
      fail(`${projectName}/${verName}: pack.json name required`);
    }
    if (meta.path != null && meta.path !== meta.id) {
      fail(
        `${projectName}/${verName}: path must equal id or be omitted (got "${meta.path}")`,
      );
    }
    if (!SEMVER_RE.test(String(meta.version ?? ""))) {
      fail(`${projectName}/${verName}: invalid SemVer`);
    }
    if (!hasMarkdown(verDir)) {
      fail(`${projectName}/${verName}: no Markdown (.md) files`);
    }

    // Integrity hint: hash pack.json contents (artifact checksums are generated at download time).
    const digest = createHash("sha256")
      .update(readFileSync(metaPath))
      .digest("hex")
      .slice(0, 12);
    versions += 1;
    packs += 1;
    console.log(
      `OK  ${projectName}@${verName}${meta.yanked ? " (yanked)" : ""}  pack.json~${digest}`,
    );
  }

  if (versions === 0) {
    fail(`Project ${projectName} has no SemVer releases`);
  }
}

console.log(`\nChecked ${packs} release(s); ${errors} error(s)`);
process.exit(errors > 0 ? 1 : 0);
