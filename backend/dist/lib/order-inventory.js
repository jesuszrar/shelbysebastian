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
