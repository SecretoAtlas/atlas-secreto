const DEFAULT_RUNTIME_URL = "./data/catalog/catalog-runtime.json";
const REQUIRED_FILES = {
  config: "catalog-config.json",
  merchants: "merchants.json",
  products: "products.json",
  offers: "offers.json"
};

export class CatalogLoaderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CatalogLoaderError";
    this.details = details;
  }
}

function assert(condition, message, details = {}) {
  if (!condition) {
    throw new CatalogLoaderError(message, details);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanBasePath(value) {
  return String(value || "./data/catalog").replace(/\/+$/, "");
}

function resolveUrl(path, baseUrl = globalThis.location?.href || "http://localhost/") {
  return new URL(path, baseUrl).href;
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new CatalogLoaderError(`No se pudo cargar ${url}`, {
      status: response.status,
      statusText: response.statusText,
      url
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw new CatalogLoaderError(`JSON inválido en ${url}`, {
      url,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

function validateSchema(payload, name) {
  assert(payload && typeof payload === "object", `${name}: contenido inválido`);
  assert(payload.schemaVersion === 1, `${name}: schemaVersion no compatible`);
}

function normalizeCountry(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function ageInHours(timestamp, now) {
  if (timestamp === null) return null;
  return Math.max(0, (now - timestamp) / 3_600_000);
}

function hasExactIdentifier(product) {
  const identifiers = product?.identifiers || {};
  return Boolean(
    identifiers.gtin ||
    identifiers.ean ||
    identifiers.upc ||
    identifiers.mpn ||
    product?.manualMatchApproved === true
  );
}

function isHttpsUrl(value) {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function calculateTotalPrice(offer) {
  if (Number.isFinite(offer.totalPrice) && offer.totalPrice >= 0) {
    return Number(offer.totalPrice);
  }

  const price = Number(offer.price);
  const shipping = Number.isFinite(offer.shippingCost)
    ? Number(offer.shippingCost)
    : 0;

  return price + shipping;
}

function compareOffers(a, b) {
  if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
  if (a.isStale !== b.isStale) return Number(a.isStale) - Number(b.isStale);
  return String(a.merchantName).localeCompare(String(b.merchantName), "es");
}

export function buildCatalog({
  runtime,
  config,
  merchants,
  products,
  offers,
  country,
  now = Date.now()
}) {
  validateSchema(runtime, "catalog-runtime.json");
  validateSchema(config, "catalog-config.json");
  validateSchema(merchants, "merchants.json");
  validateSchema(products, "products.json");
  validateSchema(offers, "offers.json");

  const selectedCountry = normalizeCountry(
    country || runtime.country || config.defaultCountry
  );

  const countryConfig = asArray(config.supportedCountries).find(
    (item) => normalizeCountry(item.code) === selectedCountry
  );

  assert(countryConfig, `País no configurado: ${selectedCountry}`);
  assert(
    countryConfig.enabled === true,
    `País desactivado en catalog-config.json: ${selectedCountry}`
  );

  const allowPending = runtime.allowPendingMerchants === true;
  const merchantMap = new Map();

  for (const merchant of asArray(merchants.merchants)) {
    if (!merchant?.id) continue;
    if (normalizeCountry(merchant.country) !== selectedCountry) continue;
    if (!allowPending && merchant.status !== "approved") continue;
    if (["rejected", "paused"].includes(merchant.status)) continue;
    merchantMap.set(merchant.id, merchant);
  }

  const productMap = new Map();
  for (const product of asArray(products.products)) {
    if (!product?.id || !product?.title || !product?.brand) continue;
    if (!hasExactIdentifier(product)) continue;
    productMap.set(product.id, product);
  }

  const freshness = config.freshness || {};
  const staleWarningHours = Number(freshness.staleWarningHours ?? 36);
  const unavailableRemovalHours = Number(
    freshness.removeUnavailableAfterHours ?? 168
  );
  const includeStaleOffers = runtime.includeStaleOffers !== false;

  const normalizedOffers = [];

  for (const offer of asArray(offers.offers)) {
    if (!offer?.id || !productMap.has(offer.productId)) continue;
    const merchant = merchantMap.get(offer.merchantId);
    if (!merchant) continue;
    if (normalizeCountry(offer.country) !== selectedCountry) continue;
    if (offer.isCommissionable === false) continue;
    if (!Number.isFinite(offer.price) || offer.price < 0) continue;
    if (!isHttpsUrl(offer.affiliateUrl)) continue;

    const currency = normalizeCurrency(offer.currency);
    if (currency !== normalizeCurrency(countryConfig.currency)) continue;

    const updatedTimestamp = parseTimestamp(offer.lastUpdatedAt);
    const ageHours = ageInHours(updatedTimestamp, now);
    const isStale = ageHours === null || ageHours >= staleWarningHours;
    const isUnavailable = ["out_of_stock", "unavailable", "discontinued"].includes(
      offer.availability
    );

    if (isUnavailable && runtime.includeUnavailableOffers !== true) {
      continue;
    }

    if (
      isUnavailable &&
      ageHours !== null &&
      ageHours >= unavailableRemovalHours
    ) {
      continue;
    }

    if (!includeStaleOffers && isStale) continue;

    normalizedOffers.push({
      ...offer,
      merchantName: merchant.name,
      merchantStatus: merchant.status,
      currency,
      totalPrice: calculateTotalPrice(offer),
      ageHours,
      isStale,
      updatedTimestamp
    });
  }

  const offersByProduct = new Map();
  for (const offer of normalizedOffers) {
    const group = offersByProduct.get(offer.productId) || [];
    group.push(offer);
    offersByProduct.set(offer.productId, group);
  }

  const catalogProducts = [];
  let exactComparisons = 0;

  for (const [productId, product] of productMap) {
    const productOffers = offersByProduct.get(productId) || [];
    if (productOffers.length === 0) continue;
    productOffers.sort(compareOffers);

    if (productOffers.length > 1) exactComparisons += 1;

    catalogProducts.push({
      ...product,
      comparisonType: "exact",
      offerCount: productOffers.length,
      bestOffer: productOffers[0],
      offers: productOffers
    });
  }

  catalogProducts.sort((a, b) => {
    const priceDifference = a.bestOffer.totalPrice - b.bestOffer.totalPrice;
    if (priceDifference !== 0) return priceDifference;
    return String(a.title).localeCompare(String(b.title), "es");
  });

  return {
    status: "ready",
    enabled: true,
    schemaVersion: 1,
    country: selectedCountry,
    currency: normalizeCurrency(countryConfig.currency),
    generatedAt: offers.generatedAt || products.generatedAt || null,
    loadedAt: new Date(now).toISOString(),
    config,
    runtime,
    merchants: [...merchantMap.values()],
    products: catalogProducts,
    stats: {
      merchants: merchantMap.size,
      products: catalogProducts.length,
      offers: normalizedOffers.length,
      exactComparisons,
      staleOffers: normalizedOffers.filter((offer) => offer.isStale).length
    }
  };
}

export async function loadSecretShopCatalog(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  assert(typeof fetchImpl === "function", "fetch no está disponible");

  const runtimeUrl = resolveUrl(
    options.runtimeUrl || DEFAULT_RUNTIME_URL,
    options.baseUrl
  );
  const runtime = await fetchJson(runtimeUrl, fetchImpl);
  validateSchema(runtime, "catalog-runtime.json");

  if (runtime.enabled !== true && options.force !== true) {
    return {
      status: "disabled",
      enabled: false,
      schemaVersion: 1,
      runtime,
      products: [],
      merchants: [],
      stats: {
        merchants: 0,
        products: 0,
        offers: 0,
        exactComparisons: 0,
        staleOffers: 0
      }
    };
  }

  const dataBasePath = cleanBasePath(runtime.dataBasePath);
  const dataBaseUrl = resolveUrl(`${dataBasePath}/`, options.baseUrl);

  const urls = Object.fromEntries(
    Object.entries(REQUIRED_FILES).map(([key, file]) => [
      key,
      resolveUrl(file, dataBaseUrl)
    ])
  );

  const [config, merchants, products, offers] = await Promise.all([
    fetchJson(urls.config, fetchImpl),
    fetchJson(urls.merchants, fetchImpl),
    fetchJson(urls.products, fetchImpl),
    fetchJson(urls.offers, fetchImpl)
  ]);

  return buildCatalog({
    runtime,
    config,
    merchants,
    products,
    offers,
    country: options.country,
    now: options.now
  });
}
