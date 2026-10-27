import { Prisma } from "@prisma/client";
const FREE_SHIPPING_THRESHOLD = new Prisma.Decimal(460000);
const SHIPPING_AMOUNT = new Prisma.Decimal(15000);
const toDecimal = (value, label) => {
    let decimal;
    try {
        decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value ?? 0));
    }
    catch {
        throw new Error(`${label} inválido`);
    }
    if (!decimal.isFinite() || decimal.isNegative())
        throw new Error(`${label} inválido`);
    return decimal;
};
const getLineKey = (item) => {
    const productId = String(item.productId ?? item.product_id ?? "").trim();
    const variantId = item.variantId ?? item.variant_id;
    return `${productId}\u0000${variantId == null || variantId === "" ? "" : String(variantId)}`;
};
const getReservedQuantities = (items) => {
    const quantities = new Map();
    if (!Array.isArray(items))
        return quantities;
    for (const item of items) {
        const key = getLineKey(item);
        const quantity = Number(item.quantity ?? 0);
        if (key.startsWith("\u0000") || !Number.isInteger(quantity) || quantity <= 0)
            continue;
        quantities.set(key, (quantities.get(key) ?? 0) + quantity);
    }
    return quantities;
};
export const hasSameOrderLines = (existingItems, nextItems) => {
    if (!Array.isArray(existingItems) || existingItems.length !== nextItems.length)
        return false;
    const lineCounts = (items) => {
        const counts = new Map();
        for (const item of items) {
            const signature = `${getLineKey(item)}\u0000${Number(item.quantity ?? 0)}`;
            counts.set(signature, (counts.get(signature) ?? 0) + 1);
        }
        return counts;
    };
    const before = lineCounts(existingItems);
    const after = lineCounts(nextItems);
    return before.size === after.size && [...before].every(([key, count]) => after.get(key) === count);
};
const assertClientAmount = (value, expected, label) => {
    if (value === undefined)
        return;
    if (!toDecimal(value, label).equals(expected)) {
        throw new Error(`${label} no coincide con el cálculo del servidor`);
    }
};
export const calculateOrderPricing = async (input, repository, now = new Date()) => {
    if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new Error("El pedido debe incluir al menos un producto");
    }
    const reservedQuantities = getReservedQuantities(input.reservedItems);
    const items = [];
    let subtotal = new Prisma.Decimal(0);
    for (const rawItem of input.items) {
        const productId = String(rawItem.productId ?? rawItem.product_id ?? "").trim();
        const variantValue = rawItem.variantId ?? rawItem.variant_id;
        const variantId = variantValue == null || variantValue === "" ? null : String(variantValue);
        const quantity = Number(rawItem.quantity ?? 0);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0)
            throw new Error("Línea de pedido inválida");
        const product = await repository.findProduct(productId);
        if (!product)
            throw new Error(`Producto no encontrado: ${productId}`);
        const variant = variantId ? await repository.findVariant(variantId) : null;
        if (variantId && (!variant || variant.productId !== productId || !variant.active))
            throw new Error("Variante no disponible");
        const price = toDecimal(variant ? variant.price : product.price, "Precio del producto");
        const stock = variant ? variant.stock : product.stock;
        const stockKey = `${productId}\u0000${variantId ?? ""}`;
        const availableStock = stock + (reservedQuantities.get(stockKey) ?? 0);
        if (availableStock < quantity)
            throw new Error(`Stock insuficiente para ${variant?.name ?? product.name}`);
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
        if (!coupon)
            throw new Error("Cupón no encontrado");
        if (!coupon.active)
            throw new Error("El cupón ya no está activo");
        if (coupon.expiresAt && coupon.expiresAt.getTime() < now.getTime())
            throw new Error("El cupón ha expirado");
        if (coupon.minimumSubtotal !== null && subtotal.lt(toDecimal(coupon.minimumSubtotal, "Subtotal mínimo del cupón"))) {
            throw new Error("El pedido no cumple el subtotal mínimo del cupón");
        }
        const couponValue = toDecimal(coupon.value, "Valor del cupón");
        discountAmount = coupon.type === "percent"
            ? subtotal.add(shipping).mul(couponValue).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
            : couponValue;
        if (discountAmount.isNegative())
            discountAmount = new Prisma.Decimal(0);
        const maximumDiscount = subtotal.add(shipping);
        if (discountAmount.gt(maximumDiscount))
            discountAmount = maximumDiscount;
    }
    const total = subtotal.add(shipping).sub(discountAmount);
    assertClientAmount(input.clientShipping, shipping, "El envío");
    assertClientAmount(input.clientDiscountAmount, discountAmount, "El descuento");
    assertClientAmount(input.clientTotal, total, "El total");
    return { items, subtotal, shipping, discountAmount, total, couponCode };
};
