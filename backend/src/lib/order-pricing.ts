import { Prisma } from "@prisma/client";

type Money = Prisma.Decimal | number | string;

export type PricingProduct = {
  id: string;
  name: string;
  price: Money;
  stock: number;
  activateWholesale: boolean;
  wholesaleMinQty: number;
  wholesaleDiscountPercent: number;
};

export type PricingVariant = {
  id: string;
  productId: string;
  name: string;
  price: Money;
  stock: number;
  active: boolean;
};

export type PricingCoupon = {
  code: string;
  type: string;
  value: Money;
  active: boolean;
  minimumSubtotal: Money | null;
  expiresAt: Date | null;
};

export type OrderPricingRepository = {
  findProduct: (id: string) => Promise<PricingProduct | null>;
  findVariant: (id: string) => Promise<PricingVariant | null>;
  findCoupon: (code: string) => Promise<PricingCoupon | null>;
};

type OrderLine = Record<string, unknown>;

export type OrderPricingInput = {
  items: unknown;
  couponCode?: unknown;
  clientShipping?: unknown;
  clientDiscountAmount?: unknown;
  clientTotal?: unknown;
  reservedItems?: unknown;
};

const FREE_SHIPPING_THRESHOLD = new Prisma.Decimal(460000);
const SHIPPING_AMOUNT = new Prisma.Decimal(15000);

const toDecimal = (value: Money | null | undefined, label: string) => {
  let decimal: Prisma.Decimal;
  try {
    decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value ?? 0));
  } catch {
    throw new Error(`${label} inválido`);
  }
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error(`${label} inválido`);
  return decimal;
};

const getLineKey = (item: OrderLine) => {
  const productId = String(item.productId ?? item.product_id ?? "").trim();
  const variantId = item.variantId ?? item.variant_id;
  return `${productId}\u0000${variantId == null || variantId === "" ? "" : String(variantId)}`;
};

const getReservedQuantities = (items: unknown) => {
  const quantities = new Map<string, number>();
  if (!Array.isArray(items)) return quantities;
  for (const item of items as OrderLine[]) {
    const key = getLineKey(item);
    const quantity = Number(item.quantity ?? 0);
    if (key.startsWith("\u0000") || !Number.isInteger(quantity) || quantity <= 0) continue;
    quantities.set(key, (quantities.get(key) ?? 0) + quantity);
  }
  return quantities;
};

export const hasSameOrderLines = (existingItems: unknown, nextItems: OrderLine[]) => {
  if (!Array.isArray(existingItems) || existingItems.length !== nextItems.length) return false;
  const lineCounts = (items: OrderLine[]) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const signature = `${getLineKey(item)}\u0000${Number(item.quantity ?? 0)}`;
      counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
    return counts;
  };
  const before = lineCounts(existingItems as OrderLine[]);
  const after = lineCounts(nextItems);
  return before.size === after.size && [...before].every(([key, count]) => after.get(key) === count);
};

const assertClientAmount = (value: unknown, expected: Prisma.Decimal, label: string) => {
  if (value === undefined) return;
  if (!toDecimal(value as Money, label).equals(expected)) {
    throw new Error(`${label} no coincide con el cálculo del servidor`);
  }
};

export const calculateOrderPricing = async (
  input: OrderPricingInput,
  repository: OrderPricingRepository,
  now = new Date(),
) => {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("El pedido debe incluir al menos un producto");
  }

  const reservedQuantities = getReservedQuantities(input.reservedItems);
  const items: OrderLine[] = [];
  let subtotal = new Prisma.Decimal(0);

  for (const rawItem of input.items as OrderLine[]) {
    const productId = String(rawItem.productId ?? rawItem.product_id ?? "").trim();
    const variantValue = rawItem.variantId ?? rawItem.variant_id;
    const variantId = variantValue == null || variantValue === "" ? null : String(variantValue);
    const quantity = Number(rawItem.quantity ?? 0);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) throw new Error("Línea de pedido inválida");

    const product = await repository.findProduct(productId);
    if (!product) throw new Error(`Producto no encontrado: ${productId}`);

    const variant = variantId ? await repository.findVariant(variantId) : null;
    if (variantId && (!variant || variant.productId !== productId || !variant.active)) throw new Error("Variante no disponible");

    const price = toDecimal(variant ? variant.price : product.price, "Precio del producto");
    const stock = variant ? variant.stock : product.stock;
    const stockKey = `${productId}\u0000${variantId ?? ""}`;
    const availableStock = stock + (reservedQuantities.get(stockKey) ?? 0);
    if (availableStock < quantity) throw new Error(`Stock insuficiente para ${variant?.name ?? product.name}`);

    const minQty = Number(product.wholesaleMinQty ?? 0);
    const discountPercent = Number(product.wholesaleDiscountPercent ?? 0);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      throw new Error("Configuración de descuento por mayor inválida");
    }
    const isWholesale = Boolean(product.activateWholesale) && minQty > 0 && discountPercent > 0 && quantity >= minQty;
    const finalUnitPrice = isWholesale
      ? price.mul(new Prisma.Decimal(100 - discountPercent)).div(100)
      : price;
    const lineTotal = finalUnitPrice.mul(quantity);
    subtotal = subtotal.add(lineTotal);

    items.push({
      ...rawItem,
      productId,
      variantId,
      title: variant ? `${product.name} - ${variant.name}` : product.name,
      unit_price: Number(finalUnitPrice),
      lineTotal: Number(lineTotal),
      wholesaleApplied: isWholesale,
      wholesaleMinQty: minQty,
      wholesaleDiscountPercent: discountPercent,
    });
  }

  const shipping = subtotal.isZero() || subtotal.gte(FREE_SHIPPING_THRESHOLD)
    ? new Prisma.Decimal(0)
    : SHIPPING_AMOUNT;

  const rawCouponCode = input.couponCode == null ? "" : String(input.couponCode).trim().toUpperCase();
  const couponCode = rawCouponCode || null;
  let discountAmount = new Prisma.Decimal(0);
  if (couponCode) {
    const coupon = await repository.findCoupon(couponCode);
    if (!coupon) throw new Error("Cupón no encontrado");
    if (!coupon.active) throw new Error("El cupón ya no está activo");
    if (coupon.expiresAt && coupon.expiresAt.getTime() < now.getTime()) throw new Error("El cupón ha expirado");
    if (coupon.minimumSubtotal !== null && subtotal.lt(toDecimal(coupon.minimumSubtotal, "Subtotal mínimo del cupón"))) {
      throw new Error("El pedido no cumple el subtotal mínimo del cupón");
    }

    const couponValue = toDecimal(coupon.value, "Valor del cupón");
    discountAmount = coupon.type === "percent"
      ? subtotal.add(shipping).mul(couponValue).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      : couponValue;
    if (discountAmount.isNegative()) discountAmount = new Prisma.Decimal(0);
    const maximumDiscount = subtotal.add(shipping);
    if (discountAmount.gt(maximumDiscount)) discountAmount = maximumDiscount;
  }

  const total = subtotal.add(shipping).sub(discountAmount);
  assertClientAmount(input.clientShipping, shipping, "El envío");
  assertClientAmount(input.clientDiscountAmount, discountAmount, "El descuento");
  assertClientAmount(input.clientTotal, total, "El total");

  return { items, subtotal, shipping, discountAmount, total, couponCode };
};