import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

/** Reserialize markdown text through remark's plain-default stringify
 * options (no detected-style overrides), independent of the live Milkdown/
 * ProseMirror editor instance — used only for the explicit, user-triggered
 * "Format document" action, never as a side effect of editing. */
export async function formatMarkdown(source: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStringify)
    .process(source);
  return String(file);
}
