export type WholesalePricingInput = {
  basePrice: number;
  quantity: number;
  activateWholesale?: boolean | null;
  wholesaleMinQty?: number | null;
  wholesaleDiscountPercent?: number | null;
};

export const getWholesalePricing = ({
  basePrice,
  quantity,
  activateWholesale,
  wholesaleMinQty,
  wholesaleDiscountPercent,
}: WholesalePricingInput) => {
  const normalizedQuantity = Number(quantity) || 0;
  const normalizedBasePrice = Number(basePrice) || 0;
  const minQty = Number(wholesaleMinQty ?? 0) || 0;
  const discountPercent = Number(wholesaleDiscountPercent ?? 0) || 0;
  const isWholesale = Boolean(activateWholesale) && minQty > 0 && discountPercent > 0 && normalizedQuantity >= minQty;
  const finalUnitPrice = isWholesale ? normalizedBasePrice * (1 - discountPercent / 100) : normalizedBasePrice;
  const lineTotal = finalUnitPrice * normalizedQuantity;

  return {
    isWholesale,
    minQty,
    discountPercent,
    finalUnitPrice,
    lineTotal,
    totalDiscount: normalizedBasePrice * normalizedQuantity - lineTotal,
  };
};
