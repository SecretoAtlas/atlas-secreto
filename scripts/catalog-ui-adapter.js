function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
}

function isVisibleAvailability(value) {
  return !["out_of_stock", "unavailable", "discontinued"].includes(value);
}

function formatMoney(amount, currency, country = "ES") {
  const locales = {
    ES: "es-ES",
    PT: "pt-PT",
    MX: "es-MX",
    CO: "es-CO",
    CL: "es-CL",
    PE: "es-PE",
    AR: "es-AR",
    BR: "pt-BR"
  };

  try {
    return new Intl.NumberFormat(locales[country] || "es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

function normalizeDescription(product, merchantName) {
  const description = String(
    product.description || product.shortDescription || ""
  ).trim();

  if (description.length >= 20) return description;
  return `Consulta los detalles y la disponibilidad de ${product.title} en ${merchantName}.`;
}

function adaptOffer(offer, product, catalog) {
  const amount = Number(offer.price);
  const shippingAmount = Number.isFinite(offer.shippingCost)
    ? Number(offer.shippingCost)
    : null;
  const totalAmount = Number.isFinite(offer.totalPrice)
    ? Number(offer.totalPrice)
    : shippingAmount === null
      ? amount
      : amount + shippingAmount;

  if (!Number.isFinite(amount) || !Number.isFinite(totalAmount)) return null;
  if (!isVisibleAvailability(offer.availability)) return null;

  const country = String(offer.country || catalog.country || "ES").toUpperCase();
  const currency = String(offer.currency || catalog.currency || "EUR").toUpperCase();

  return {
    store: offer.merchantName || offer.merchantId,
    country,
    price: formatMoney(totalAmount, currency, country),
    url: offer.affiliateUrl,
    amount,
    shippingAmount,
    totalAmount,
    currency,
    priceCheckedAt: offer.lastUpdatedAt || catalog.generatedAt || catalog.loadedAt,
    freeShipping: shippingAmount === 0,
    shippingIncluded: shippingAmount !== null,
    shipsTo: uniqueStrings([country]),
    availability: offer.availability,
    condition: offer.condition || product.condition,
    previousAmount: Number.isFinite(offer.previousPrice)
      ? Number(offer.previousPrice)
      : null,
    deliveryTime: offer.deliveryTime || null,
    merchantProductId: offer.merchantProductId,
    source: offer.source || null,
    isStale: offer.isStale === true
  };
}

export function adaptAwinCatalogToSecretShop(catalog) {
  if (!catalog || catalog.enabled !== true) return [];

  return asArray(catalog.products)
    .map((product) => {
      const offers = asArray(product.offers)
        .map((offer) => adaptOffer(offer, product, catalog))
        .filter(Boolean);

      if (offers.length === 0) return null;

      offers.sort((a, b) => a.totalAmount - b.totalAmount);
      const images = uniqueStrings(product.images || []);
      if (images.length === 0) return null;

      const categories = uniqueStrings([
        product.department,
        ...(product.categories || []),
        ...(product.categoryPath || []),
        product.category,
        offers[0].totalAmount < 10 ? "Menos de 10" : null
      ]);

      const attributes = product.attributes || {};
      const merchantNames = uniqueStrings(
        asArray(product.offers).map((offer) => offer.merchantName || offer.merchantId)
      );

      return {
        id: `awin-${product.id}`,
        sourceProductId: product.id,
        name: product.title,
        description: normalizeDescription(product, merchantNames[0] || "la tienda"),
        image: images[0],
        gallery: images,
        category: product.category || product.department || "Hogar",
        categories,
        department: product.department || null,
        brand: product.brand || null,
        model: product.model || null,
        condition: product.condition || null,
        createdAt: product.sourceUpdatedAt || catalog.generatedAt || "1970-01-01",
        metadataUpdatedAt: product.sourceUpdatedAt || catalog.generatedAt || catalog.loadedAt,
        searchAliases: uniqueStrings([
          product.brand,
          product.model,
          attributes.merchantCategory,
          attributes.awinCategory,
          attributes.productType,
          attributes.keywords,
          attributes.dimensions
        ]),
        identifiers: product.identifiers || null,
        variant: product.variant || null,
        sourceMerchants: product.sourceMerchants || [],
        offers
      };
    })
    .filter(Boolean);
}
