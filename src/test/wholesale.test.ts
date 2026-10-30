import { describe, expect, it } from "vitest";
import { getWholesalePricing } from "@/lib/wholesale";

describe("getWholesalePricing", () => {
  it("applies the wholesale discount only when the minimum quantity is reached", () => {
    const normal = getWholesalePricing({
      basePrice: 100000,
      quantity: 3,
      activateWholesale: true,
      wholesaleMinQty: 5,
      wholesaleDiscountPercent: 10,
    });

    const wholesale = getWholesalePricing({
      basePrice: 100000,
      quantity: 5,
      activateWholesale: true,
      wholesaleMinQty: 5,
      wholesaleDiscountPercent: 10,
    });

    expect(normal.isWholesale).toBe(false);
    expect(normal.finalUnitPrice).toBe(100000);
    expect(wholesale.isWholesale).toBe(true);
    expect(wholesale.finalUnitPrice).toBe(90000);
    expect(wholesale.lineTotal).toBe(450000);
  });
});
