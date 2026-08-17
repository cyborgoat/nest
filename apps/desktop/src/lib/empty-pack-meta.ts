import type { KnowledgePackMeta } from "@nest/shared";

/** Default blank metadata for create/import pack dialogs. */
export const EMPTY_PACK_META: KnowledgePackMeta = {
  id: "",
  name: "",
  description: "",
  version: "0.1.0",
};
