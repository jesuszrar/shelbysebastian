import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";
import { calculateOrderPricing, hasSameOrderLines, type OrderPricingRepository, type PricingCoupon, type PricingProduct, type PricingVariant } from "./order-pricing.js";

const product: PricingProduct = {
  id: "p1",
  name: "Producto",
  price: new Prisma.Decimal(25000),
  stock: 20,
  activateWholesale: false,
  wholesaleMinQty: 0,
  wholesaleDiscountPercent: 0,
};

const repository = (overrides: Partial<OrderPricingRepository> = {}): OrderPricingRepository => ({
  findProduct: async (id) => id === product.id ? product : null,
  findVariant: async () => null,
  findCoupon: async () => null,
  ...overrides,
});

const coupon: PricingCoupon = {
  code: "SAVE10",
  type: "percent",
  value: new Prisma.Decimal(10),
  active: true,
  minimumSubtotal: new Prisma.Decimal(200000),
  expiresAt: null,
};

test("uses database product price and computes the subtotal from validated lines", async () => {
  const pricing = await calculateOrderPricing({
    items: [{ productId: "p1", quantity: 2, unit_price: 1, lineTotal: 2 }],
    clientShipping: 15000,
    clientDiscountAmount: null,
    clientTotal: 65000,
  }, repository());

  assert.equal(Number(pricing.subtotal), 50000);
  assert.equal(pricing.items[0].unit_price, 25000);
  assert.equal(Number(pricing.total), 65000);
});

test("keeps wholesale pricing in the backend calculation", async () => {
  const wholesaleProduct = { ...product, price: new Prisma.Decimal(100000), activateWholesale: true, wholesaleMinQty: 5, wholesaleDiscountPercent: 10 };
  const pricing = await calculateOrderPricing({
    items: [{ productId: "p1", quantity: 5 }],
    clientShipping: 15000,
    clientDiscountAmount: null,
    clientTotal: 465000,
  }, repository({ findProduct: async () => wholesaleProduct }));

  assert.equal(pricing.items[0].wholesaleApplied, true);
  assert.equal(pricing.items[0].unit_price, 90000);
  assert.equal(Number(pricing.subtotal), 450000);
  assert.equal(Number(pricing.total), 465000);
});

test("rejects a client-supplied discount not supported by a coupon", async () => {
  await assert.rejects(() => calculateOrderPricing({
    items: [{ productId: "p1", quantity: 2 }],
    clientDiscountAmount: 10000,
    clientTotal: 55000,
  }, repository()), /descuento no coincide/i);
});

test("rejects client-supplied shipping that differs from the current policy", async () => {
  await assert.rejects(() => calculateOrderPricing({
    items: [{ productId: "p1", quantity: 2 }],
    clientShipping: 0,
    clientDiscountAmount: 0,
    clientTotal: 50000,
  }, repository()), /envío no coincide/i);
});

test("rejects a client-supplied total that differs from the backend total", async () => {
  await assert.rejects(() => calculateOrderPricing({
    items: [{ productId: "p1", quantity: 2 }],
    clientShipping: 15000,
    clientDiscountAmount: 0,
    clientTotal: 1,
  }, repository()), /total no coincide/i);
});

test("recalculates an active coupon from the database coupon and real subtotal", async () => {
  const pricing = await calculateOrderPricing({
    items: [{ productId: "p1", quantity: 8 }],
    couponCode: "save10",
    clientShipping: 15000,
    clientDiscountAmount: 21500,
    clientTotal: 193500,
  }, repository({
    findProduct: async () => ({ ...product, price: new Prisma.Decimal(25000) }),
    findCoupon: async (code) => code === coupon.code ? coupon : null,
  }));

  assert.equal(Number(pricing.subtotal), 200000);
  assert.equal(Number(pricing.discountAmount), 21500);
  assert.equal(Number(pricing.total), 193500);
  assert.equal(pricing.couponCode, "SAVE10");
});

test("rejects a coupon discount amount manipulated by the client", async () => {
  await assert.rejects(() => calculateOrderPricing({
    items: [{ productId: "p1", quantity: 8 }],
    couponCode: "SAVE10",
    clientShipping: 15000,
    clientDiscountAmount: 1,
    clientTotal: 193500,
  }, repository({
    findProduct: async () => ({ ...product, price: new Prisma.Decimal(25000) }),
    findCoupon: async () => coupon,
  })), /descuento no coincide/i);
});

test("rejects orders without lines", async () => {
  await assert.rejects(() => calculateOrderPricing({ items: [] }, repository()), /al menos un producto/i);
});

test("uses a variant's database price and stock with the parent wholesale rule", async () => {
  const parent = { ...product, stock: 0, activateWholesale: true, wholesaleMinQty: 5, wholesaleDiscountPercent: 10 };
  const variant: PricingVariant = {
    id: "v1",
    productId: "p1",
    name: "Variante",
    price: new Prisma.Decimal(30000),
    stock: 5,
    active: true,
  };
  const pricingRepository = repository({
    findProduct: async () => parent,
    findVariant: async (id) => id === variant.id ? variant : null,
  });
  const pricing = await calculateOrderPricing({ items: [{ productId: "p1", variantId: "v1", quantity: 5 }] }, pricingRepository);

  assert.equal(pricing.items[0].unit_price, 27000);
  assert.equal(Number(pricing.subtotal), 135000);
  await assert.rejects(() => calculateOrderPricing({ items: [{ productId: "p1", variantId: "v1", quantity: 6 }] }, pricingRepository), /stock insuficiente/i);
});

test("waives shipping at the existing free-shipping threshold", async () => {
  const pricing = await calculateOrderPricing({
    items: [{ productId: "p1", quantity: 20 }],
  }, repository({ findProduct: async () => ({ ...product, price: new Prisma.Decimal(23000) }) }));

  assert.equal(Number(pricing.subtotal), 460000);
  assert.equal(Number(pricing.shipping), 0);
});

test("only accepts an existing-order retry with the exact same lines", () => {
  const previous = [{ productId: "p1", variantId: "v1", quantity: 2 }];
  assert.equal(hasSameOrderLines(previous, [{ productId: "p1", variantId: "v1", quantity: 2 }]), true);
  assert.equal(hasSameOrderLines(previous, [{ productId: "p1", variantId: "v1", quantity: 3 }]), false);
});