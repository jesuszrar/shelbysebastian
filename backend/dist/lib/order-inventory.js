import { lockProductCatalogIds } from "./productCatalogLock.js";
export const decrementOrderInventory = async (transaction, items) => {
    await lockProductCatalogIds(transaction, items.map((item) => item.productId));
    for (const item of items) {
        if (item.variantId) {
            const updated = await transaction.productVariant.updateMany({
                where: {
                    id: item.variantId,
                    productId: item.productId,
                    stock: { gte: item.quantity },
                    active: true,
                },
                data: { stock: { decrement: item.quantity } },
            });
            if (updated.count !== 1)
                throw new Error("Stock insuficiente para la variante");
        }
        else {
            const updated = await transaction.product.updateMany({
                where: { id: item.productId, stock: { gte: item.quantity } },
                data: { stock: { decrement: item.quantity } },
            });
            if (updated.count !== 1)
                throw new Error("Stock insuficiente para el producto");
        }
    }
};
const toStoredOrderLine = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const row = value;
    const rawProductId = row.productId ?? row.product_id;
    const rawVariantId = row.variantId ?? row.variant_id;
    const rawQuantity = row.quantity;
    const productId = typeof rawProductId === "string" ? rawProductId.trim() : "";
    const variantId = rawVariantId == null || rawVariantId === ""
        ? null
        : typeof rawVariantId === "string" ? rawVariantId : null;
    const quantity = typeof rawQuantity === "number" ? rawQuantity : Number.NaN;
    if (!productId || !Number.isSafeInteger(quantity) || quantity <= 0)
        return null;
    if (rawVariantId != null && rawVariantId !== "" && variantId === null)
        return null;
    return { productId, variantId, quantity };
};
export const recordOrderInventoryReservation = async (transaction, orderId, items) => {
    const reservations = items.map((item, lineIndex) => {
        const productId = item.productId.trim();
        if (!productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
            throw new Error("No se puede registrar una reserva de inventario invalida");
        }
        return {
            orderId,
            lineIndex,
            productId,
            variantId: item.variantId,
            quantity: item.quantity,
        };
    });
    if (reservations.length === 0)
        throw new Error("No se puede registrar una reserva sin lineas de pedido");
    for (const reservation of reservations) {
        await transaction.orderInventoryReservation.create({ data: reservation });
    }
};
const lockOrderForInventory = async (transaction, orderId) => transaction.$queryRaw `
  SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
`;
const setReservationReview = async (transaction, reservationId, reason) => {
    await transaction.orderInventoryReservation.updateMany({
        where: { id: reservationId, status: "RESERVED" },
        data: { status: "REVIEW", reviewReason: reason },
    });
};
const restoreInventoryForOrder = async (transaction, order) => {
    const reservations = await transaction.orderInventoryReservation.findMany({
        where: { orderId: order.id },
        orderBy: { lineIndex: "asc" },
    });
    const reviewReasons = [];
    if (reservations.length === 0) {
        const reason = "No existe evidencia persistente del descuento de inventario; requiere revision manual.";
        await transaction.order.update({ where: { id: order.id }, data: { inventoryReviewReason: reason } });
        return { found: true, restored: 0, reviewReasons: [reason] };
    }
    const orderLines = Array.isArray(order.items) ? order.items : [];
    const reservationIndexes = new Set(reservations.map((reservation) => reservation.lineIndex));
    for (let lineIndex = 0; lineIndex < orderLines.length; lineIndex += 1) {
        if (!reservationIndexes.has(lineIndex)) {
            reviewReasons.push(`Falta evidencia del descuento para la linea ${lineIndex + 1}.`);
        }
    }
    const pendingReservations = reservations.filter((reservation) => reservation.status === "RESERVED");
    await lockProductCatalogIds(transaction, pendingReservations.map((reservation) => reservation.productId));
    let restored = 0;
    for (const reservation of pendingReservations) {
        const expectedLine = toStoredOrderLine(orderLines[reservation.lineIndex]);
        if (!expectedLine ||
            expectedLine.productId !== reservation.productId ||
            expectedLine.variantId !== reservation.variantId ||
            expectedLine.quantity !== reservation.quantity) {
            const reason = `La reserva de inventario no coincide con la linea ${reservation.lineIndex + 1}; requiere revision manual.`;
            await setReservationReview(transaction, reservation.id, reason);
            reviewReasons.push(reason);
            continue;
        }
        const productExclusion = await transaction.productExclusion.findUnique({
            where: { productId: reservation.productId },
            select: { productId: true },
        });
        if (productExclusion) {
            const reason = `El producto de la linea ${reservation.lineIndex + 1} esta excluido del catalogo; requiere revision manual.`;
            await setReservationReview(transaction, reservation.id, reason);
            reviewReasons.push(reason);
            continue;
        }
        const product = await transaction.product.findUnique({
            where: { id: reservation.productId },
            select: { id: true },
        });
        if (!product) {
            const reason = `No existe el producto de la linea ${reservation.lineIndex + 1}; requiere revision manual.`;
            await setReservationReview(transaction, reservation.id, reason);
            reviewReasons.push(reason);
            continue;
        }
        let updated;
        if (reservation.variantId) {
            const variantExclusion = await transaction.productVariantExclusion.findUnique({
                where: { variantId: reservation.variantId },
                select: { variantId: true, productId: true },
            });
            if (variantExclusion) {
                const reason = `La variante de la linea ${reservation.lineIndex + 1} esta excluida del catalogo; requiere revision manual.`;
                await setReservationReview(transaction, reservation.id, reason);
                reviewReasons.push(reason);
                continue;
            }
            const variant = await transaction.productVariant.findUnique({
                where: { id: reservation.variantId },
                select: { id: true, productId: true },
            });
            if (!variant || variant.productId !== reservation.productId) {
                const reason = `La variante de la linea ${reservation.lineIndex + 1} no existe o no pertenece al producto; requiere revision manual.`;
                await setReservationReview(transaction, reservation.id, reason);
                reviewReasons.push(reason);
                continue;
            }
            updated = await transaction.productVariant.updateMany({
                where: {
                    id: reservation.variantId,
                    productId: reservation.productId,
                    stock: { lte: 2_147_483_647 - reservation.quantity },
                },
                data: { stock: { increment: reservation.quantity } },
            });
        }
        else {
            updated = await transaction.product.updateMany({
                where: {
                    id: reservation.productId,
                    stock: { lte: 2_147_483_647 - reservation.quantity },
                },
                data: { stock: { increment: reservation.quantity } },
            });
        }
        if (updated.count !== 1) {
            const reason = `No se pudo reponer el stock de la linea ${reservation.lineIndex + 1}; requiere revision manual.`;
            await setReservationReview(transaction, reservation.id, reason);
            reviewReasons.push(reason);
            continue;
        }
        const markedRestored = await transaction.orderInventoryReservation.updateMany({
            where: { id: reservation.id, status: "RESERVED" },
            data: { status: "RESTORED", restoredAt: new Date(), reviewReason: null },
        });
        if (markedRestored.count !== 1) {
            throw new Error("No se pudo confirmar la devolucion de inventario; se requiere revertir la transaccion");
        }
        restored += 1;
    }
    for (const reservation of reservations) {
        if (reservation.status === "REVIEW" && reservation.reviewReason) {
            reviewReasons.push(reservation.reviewReason);
        }
    }
    await transaction.order.update({
        where: { id: order.id },
        data: { inventoryReviewReason: reviewReasons.length ? [...new Set(reviewReasons)].join("\n") : null },
    });
    return { found: true, restored, reviewReasons: [...new Set(reviewReasons)] };
};
const deferInventoryRestorationForReview = async (transaction, orderId) => {
    const reason = "El pedido ya tiene pago aprobado o fue despachado; no se devuelve inventario automaticamente y requiere revision manual.";
    const reservations = await transaction.orderInventoryReservation.findMany({
        where: { orderId },
        orderBy: { lineIndex: "asc" },
    });
    for (const reservation of reservations) {
        if (reservation.status === "RESERVED")
            await setReservationReview(transaction, reservation.id, reason);
    }
    await transaction.order.update({ where: { id: orderId }, data: { inventoryReviewReason: reason } });
    return { found: true, restored: 0, reviewReasons: [reason] };
};
const requiresManualInventoryReview = (order) => {
    const status = order.status.toLowerCase();
    const paymentStatus = order.paymentStatus?.toLowerCase();
    const isPendingContraentregaApproval = status === "approved" &&
        order.paymentMethod?.trim().toLowerCase() === "contraentrega" &&
        paymentStatus !== "approved";
    return (["payment_approved", "paid", "completed", "shipped", "delivered"].includes(status) ||
        (status === "approved" && !isPendingContraentregaApproval) ||
        ["approved", "paid", "completed"].includes(paymentStatus ?? ""));
};
export const cancelOrderAndRestoreInventory = async (transaction, orderId) => {
    await lockOrderForInventory(transaction, orderId);
    const existing = await transaction.order.findUnique({ where: { id: orderId } });
    if (!existing)
        return null;
    const inventory = requiresManualInventoryReview(existing)
        ? await deferInventoryRestorationForReview(transaction, orderId)
        : await restoreInventoryForOrder(transaction, existing);
    const next = await transaction.order.update({ where: { id: orderId }, data: { status: "cancelled" } });
    return { existing, next, inventory };
};
