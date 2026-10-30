import { afterEach, describe, expect, it, vi } from "vitest";

describe("API client integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends order creation to the explicitly configured API without using a local server", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.test.invalid");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "order-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { postData } = await import("../integrations/api/client");

    const result = await postData<{ id: string }>("orders", { id: "order-test", items: [] });

    expect(result).toEqual({ data: { id: "order-test" }, error: null });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test.invalid/api/data/orders");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });
});
