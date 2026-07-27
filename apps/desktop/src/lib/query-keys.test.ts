import { describe, expect, it } from "vitest";
import { packMutationInvalidations, queryKeys } from "./query-keys";

describe("query keys", () => {
  it("keeps scoped and prefix keys compatible", () => {
    expect(queryKeys.messagesFor("unread").slice(0, 1)).toEqual(
      queryKeys.messages,
    );
    expect(queryKeys.sourceControlRejections.slice(0, 1)).toEqual(
      queryKeys.messages,
    );
    expect(queryKeys.chatMessages("session-1").slice(0, 1)).toEqual(
      queryKeys.allChatMessages,
    );
  });

  it("invalidates every pack-derived desktop view", () => {
    expect(packMutationInvalidations).toEqual(
      expect.arrayContaining([
        queryKeys.tree,
        queryKeys.index,
        queryKeys.installedPacks,
        queryKeys.allFiles,
        queryKeys.allChatMessages,
      ]),
    );
  });
});
