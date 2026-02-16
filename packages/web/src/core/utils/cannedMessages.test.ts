import { describe, expect, it, vi } from "vitest";
import { fetchCannedMessages } from "./cannedMessages.ts";

type Handler = (packet: { data: string }) => void;

const createConnectionMock = () => {
  let handler: Handler | undefined;

  return {
    connection: {
      events: {
        onCannedMessageModulePacket: {
          subscribe: vi.fn((cb: Handler) => {
            handler = cb;
          }),
          unsubscribe: vi.fn(() => {
            handler = undefined;
          }),
        },
      },
      sendPacket: vi.fn(async () => {
        return 1;
      }),
    },
    emitResponse: (data: string) => {
      handler?.({ data });
    },
  };
};

describe("fetchCannedMessages", () => {
  it("returns empty string when connection is missing", async () => {
    await expect(fetchCannedMessages(undefined)).resolves.toBe("");
  });

  it("resolves with canned messages when response arrives", async () => {
    const { connection, emitResponse } = createConnectionMock();

    const promise = fetchCannedMessages(connection as never, 2000);
    emitResponse("Hi|Bye|Yes");

    await expect(promise).resolves.toBe("Hi|Bye|Yes");
  });

  it("returns empty string when request times out", async () => {
    vi.useFakeTimers();
    const { connection } = createConnectionMock();

    const promise = fetchCannedMessages(connection as never, 20);
    vi.advanceTimersByTime(25);

    await expect(promise).resolves.toBe("");
    vi.useRealTimers();
  });
});
