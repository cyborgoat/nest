import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Only the two classic hooks rules — not eslint-plugin-react-hooks
      // v7's full "recommended", which bundles an entire React Compiler
      // rule family (set-state-in-effect, refs, static-components, ...)
      // that flags this codebase's established, deliberate patterns (e.g.
      // the stable-callback-ref idiom used throughout MarkdownEditor.tsx)
      // as errors. Hook-call-order violations are real bugs, kept as
      // errors. Dependency-array completeness (exhaustive-deps) is left at
      // its default "warn": retrofitting this onto a 116-file codebase
      // that's never been linted surfaces many pre-existing, mostly-
      // intentional omissions that need case-by-case review, not a
      // blanket fix.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Vite's Fast Refresh needs a component file to only export
      // components; this catches files (like a hook or util) that mix in
      // a non-component export, which silently degrades to a full reload.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // This codebase relies on Tauri's `invoke()` and Radix/shadcn
      // primitives extensively without a `no-explicit-any` policy in place
      // historically — not tightening that here to keep this pass additive.
      "@typescript-eslint/no-explicit-any": "off",
      // Matches tsc's own noUnusedParameters behavior (which already
      // ignores `_`-prefixed names by default) — this codebase already
      // uses `_`-prefixed placeholders for required-but-unused positional
      // params/destructured values throughout (e.g. `(_data, packId) =>`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
