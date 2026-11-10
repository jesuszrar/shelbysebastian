import {
  readMetaPurchaseToken,
  removeMetaPurchaseToken,
  storeMetaPurchaseToken,
} from "./metaPixelPurchase";

describe("Meta Purchase claim token storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("stores tokens in session storage scoped to an order and removes them after use", () => {
    expect(storeMetaPurchaseToken("order-1", "opaque-claim-token")).toBe(true);
    expect(readMetaPurchaseToken("order-1")).toBe("opaque-claim-token");
    expect(window.localStorage.length).toBe(0);

    removeMetaPurchaseToken("order-1");
    expect(readMetaPurchaseToken("order-1")).toBeNull();
  });
});
