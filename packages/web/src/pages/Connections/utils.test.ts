import { afterEach, describe, expect, it, vi } from "vitest";
import { testHttpReachable } from "./utils";

describe("testHttpReachable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true on first probe using base URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null));

    const result = await testHttpReachable("http://meshtastic.local", 1000);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://meshtastic.local",
      expect.objectContaining({
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("falls back to /api/v1/toradio when base URL fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("base failed"))
      .mockResolvedValueOnce(new Response(null));

    const result = await testHttpReachable("http://meshtastic.local", 1000);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://meshtastic.local",
      expect.objectContaining({
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://meshtastic.local/api/v1/toradio",
      expect.objectContaining({
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns false when both probes fail", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("base failed"))
      .mockRejectedValueOnce(new Error("fallback failed"));

    const result = await testHttpReachable("http://meshtastic.local", 1000);

    expect(result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://meshtastic.local",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://meshtastic.local/api/v1/toradio",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
