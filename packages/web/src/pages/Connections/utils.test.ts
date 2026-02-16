import { afterEach, describe, expect, it, vi } from "vitest";
import { testHttpReachable } from "./utils.ts";

describe("testHttpReachable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the base URL is reachable", async () => {
    const fetchMock = vi
      .fn<[RequestInfo | URL, RequestInit?], Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(testHttpReachable("http://192.168.10.8:4403")).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.10.8:4403",
      expect.objectContaining({ method: "HEAD", mode: "no-cors" }),
    );
  });

  it("falls back to the Meshtastic API endpoint when base URL probe fails", async () => {
    const fetchMock = vi
      .fn<[RequestInfo | URL, RequestInit?], Promise<Response>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(testHttpReachable("http://192.168.10.8:4403/")).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://192.168.10.8:4403");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://192.168.10.8:4403/api/v1/toradio",
    );
  });

  it("returns false when all probe URLs fail", async () => {
    const fetchMock = vi
      .fn<[RequestInfo | URL, RequestInit?], Promise<Response>>()
      .mockRejectedValue(new Error("unreachable"));

    vi.stubGlobal("fetch", fetchMock);

    await expect(testHttpReachable("http://192.168.10.8:4403")).resolves.toBe(
      false,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://192.168.10.8:4403/api/v1/toradio",
    );
  });
});
