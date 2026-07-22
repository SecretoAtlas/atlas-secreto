import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  atomicWriteJson,
  canonicalGtin,
  chooseNewestIso,
  cleanDescription,
  cleanText,
  isHttpsUrl,
  normalizeBrand,
  normalizeGtin,
  normalizeMpn,
  normalizeSearchText,
  parseBoolean,
  parseDecimal,
  parseInteger,
  readAwinFeed,
  readJson,
  slugify,
  uniqueHttpsUrls
} from "./awin-feed-utils.mjs";

export const DEFAULT_CATALOG_DIR = resolve(process.cwd(), "data/catalog");

export const FIELD_ALIASES = Object.freeze({
  affiliateUrl: ["aw_deep_link", "affiliate_url", "deep_link"],
  title: ["product_name", "name", "title"],
  awProductId: ["aw_product_id", "awin_product_id"],
  merchantProductId: ["merchant_product_id", "merchant_sku", "sku"],
  merchantAdvertiserId: ["merchant_id", "advertiser_id", "awin_advertiser_id"],
  merchantName: ["merchant_name", "advertiser_name"],
  merchantImage: ["merchant_image_url", "image_url"],
  largeImage: ["large_image", "large_image_url"],
  awImage: ["aw_image_url"],
  alternateImage1: ["alternate_image"],
  alternateImage2: ["alternate_image_two"],
  alternateImage3: ["alternate_image_three"],
  alternateImage4: ["alternate_image_four"],
  merchantThumb: ["merchant_thumb_url"],
  awThumb: ["aw_thumb_url"],
  description: ["description", "product_description"],
  shortDescription: ["product_short_description", "short_description"],
  merchantCategory: ["merchant_category", "merchant_product_category_path"],
  categoryName: ["category_name", "awin_category_name"],
  categoryId: ["category_id", "awin_category_id"],
  productType: ["product_type", "merchant_product_category"],
  price: ["search_price", "store_price", "price"],
  storePrice: ["store_price", "search_price", "price"],
  oldPrice: ["product_price_old", "rrp_price", "old_price"],
  rrpPrice: ["rrp_price", "product_price_old"],
  deliveryCost: ["delivery_cost", "shipping_cost"],
  landingUrl: ["merchant_deep_link", "product_url", "landing_url"],
  currency: ["currency", "currency_code"],
  lastUpdated: ["last_updated", "updated_at"],
  displayPrice: ["display_price"],
  dataFeedId: ["data_feed_id", "feed_id"],
  brand: ["brand_name", "brand"],
  gtin: ["product_GTIN", "gtin"],
  ean: ["ean"],
  upc: ["upc"],
  mpn: ["mpn", "manufacturer_part_number"],
  condition: ["condition", "product_condition"],
  model: ["product_model", "model_number", "model"],
  color: ["colour", "color"],
  size: ["size", "product_size"],
  capacity: ["capacity"],
  dimensions: ["dimensions"],
  keywords: ["keywords", "search_terms"],
  specifications: ["specifications"],
  warranty: ["warranty"],
  commissionGroup: ["commission_group"],
  deliveryTime: ["delivery_time"],
  inStock: ["in_stock"],
  stockQuantity: ["stock_quantity", "number_available"],
  isForSale: ["is_for_sale"],
  preOrder: ["pre_order"],
  stockStatus: ["stock_status"],
  promotionalText: ["promotional_text"]
});

const REQUIRED_LOGICAL_FIELDS = [
  "affiliateUrl",
  "title",
  "merchantProductId",
  "merchantAdvertiserId",
  "price",
  "currency"
];

function field(row, logicalName) {
  for (const alias of FIELD_ALIASES[logicalName] ?? [logicalName]) {
    const value = row?.[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}

function firstHeader(headers, logicalName) {
  return (FIELD_ALIASES[logicalName] ?? [logicalName]).find((name) => headers.includes(name)) ?? null;
}

export function inspectFieldMapping(headers) {
  return Object.fromEntries(
    Object.keys(FIELD_ALIASES).map((logicalName) => [
      logicalName,
      firstHeader(headers, logicalName)
    ])
  );
}

function assertSchema(payload, name, arrayName) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload[arrayName])) {
    throw new Error(`${name}: estructura no compatible`);
  }
}

function assertRequiredLogicalFields(headers) {
  const mapping = inspectFieldMapping(headers);
  const missing = REQUIRED_LOGICAL_FIELDS.filter((logicalName) => !mapping[logicalName]);
  if (missing.length > 0) {
    throw new Error(
      `El feed no contiene campos Awin obligatorios compatibles: ${missing.join(", ")}`
    );
  }
  return mapping;
}

function cleanOptional(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = normalizeSearchText(text);
  if (["0", "n a", "na", "null", "undefined", "sin datos", "no aplica"].includes(normalized)) {
    return null;
  }
  return text;
}

function normalizeCondition(value, fallback = null) {
  const normalized = normalizeSearchText(value);
  if (["nuevo", "new"].includes(normalized)) return "new";
  if (["reacondicionado", "refurbished", "renewed"].includes(normalized)) return "refurbished";
  if (["usado", "used"].includes(normalized)) return "used";
  if (
    normalized.includes("segunda oportunidad") ||
    normalized.includes("second chance") ||
    normalized.includes("outlet")
  ) {
    return "second_chance";
  }
  return fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function normalizedPhraseMatch(source, term) {
  const normalizedSource = ` ${normalizeSearchText(source)} `;
  const normalizedTerm = normalizeSearchText(term);
  return Boolean(normalizedTerm) && normalizedSource.includes(` ${normalizedTerm} `);
}

function matchesAny(source, terms = []) {
  return terms.some((term) => normalizedPhraseMatch(source, term));
}

function buildCategorySource(row) {
  return [
    field(row, "merchantCategory"),
    field(row, "productType"),
    field(row, "categoryName"),
    field(row, "title"),
    field(row, "keywords")
  ].join(" ");
}

export function classifyCategory(row, profile, taxonomy) {
  const source = buildCategorySource(row);
  const department = profile.department || profile.fallbackDepartment || "Hogar";

  for (const rule of profile.categoryRules ?? []) {
    if (matchesAny(source, rule.includeAny)) {
      const ruleDepartment = rule.department || department;
      return {
        department: ruleDepartment,
        category: rule.category,
        categories: uniqueStrings([ruleDepartment, rule.category])
      };
    }
  }

  for (const rule of taxonomy.genericRules ?? []) {
    if (matchesAny(source, rule.includeAny)) {
      return {
        department: rule.department,
        category: rule.category,
        categories: uniqueStrings([rule.department, rule.category])
      };
    }
  }

  const fallbackCategory = profile.fallbackCategory || department;
  return {
    department,
    category: fallbackCategory,
    categories: uniqueStrings([department, fallbackCategory])
  };
}

function getIdentifiers(row) {
  const rawGtin = normalizeGtin(field(row, "gtin"));
  const rawEan = normalizeGtin(field(row, "ean"));
  const rawUpc = normalizeGtin(field(row, "upc"));
  const canonicalCodes = [rawGtin, rawEan, rawUpc]
    .map((value) => canonicalGtin(value))
    .filter(Boolean);

  return {
    gtin: rawGtin && canonicalGtin(rawGtin) ? rawGtin : null,
    ean: rawEan && canonicalGtin(rawEan) ? rawEan : null,
    upc: rawUpc && canonicalGtin(rawUpc) ? rawUpc : null,
    mpn: cleanOptional(field(row, "mpn")),
    canonicalCodes: [...new Set(canonicalCodes)]
  };
}

function buildVariant(row) {
  return {
    color: cleanOptional(field(row, "color")),
    size: cleanOptional(field(row, "size")),
    capacity: cleanOptional(field(row, "capacity")),
    configuration: cleanOptional(field(row, "dimensions"))
  };
}

function getVariantSignature(variant = {}) {
  const values = [variant.color, variant.size, variant.capacity, variant.configuration]
    .map(normalizeSearchText)
    .filter(Boolean);
  return values.length > 0 ? values.join("|") : null;
}

function buildModelVariantKey(brand, model, variant) {
  const normalizedBrand = normalizeBrand(brand);
  const normalizedModel = normalizeSearchText(model);
  const signature = getVariantSignature(variant);
  if (!normalizedBrand || !normalizedModel || !signature) return null;
  return `${normalizedBrand}|${normalizedModel}|${signature}`;
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 18);
}

function buildProductId({ identifiers, brand, modelVariantKey }) {
  if (identifiers.canonicalCodes[0]) return `gtin-${identifiers.canonicalCodes[0]}`;
  if (identifiers.mpn && brand) {
    return `mpn-${slugify(brand)}-${slugify(identifiers.mpn)}`;
  }
  if (modelVariantKey) {
    return `model-${slugify(brand)}-${shortHash(modelVariantKey)}`;
  }
  return null;
}

function normalizeAvailability(row) {
  const inStock = parseBoolean(field(row, "inStock"));
  const stockQuantity = parseInteger(field(row, "stockQuantity"));
  const isForSale = parseBoolean(field(row, "isForSale"));
  const preOrder = parseBoolean(field(row, "preOrder"));
  const status = normalizeSearchText(field(row, "stockStatus"));

  if (preOrder === true) return "preorder";
  if (isForSale === false) return "unavailable";
  if (status.includes("discontinued") || status.includes("descatalogado")) return "discontinued";
  if (status.includes("out of stock") || status.includes("agotado")) return "out_of_stock";
  if (stockQuantity !== null && stockQuantity <= 0) return "out_of_stock";
  if (inStock === false) return "out_of_stock";
  if (inStock === true || (stockQuantity !== null && stockQuantity > 0)) return "in_stock";
  return "unknown";
}

function getPrice(row) {
  return parseDecimal(field(row, "price")) ?? parseDecimal(field(row, "storePrice"));
}

function getPreviousPrice(row, price) {
  const candidates = [field(row, "oldPrice"), field(row, "rrpPrice")]
    .map(parseDecimal)
    .filter((candidate) => Number.isFinite(candidate) && candidate > price);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function makeDescription(row, title, merchantName, profile) {
  const maximumLength = Number(profile.descriptionMaxLength ?? 900);
  const source = field(row, "description") || field(row, "shortDescription");
  const cleaned = cleanDescription(source, maximumLength);
  if (cleaned.length >= 20) return cleaned;
  return `Consulta los detalles, medidas y disponibilidad de ${title} en ${merchantName}.`;
}

function isExcludedBrand(brand, merchant) {
  const exclusions = Array.isArray(merchant.excludeBrands) ? merchant.excludeBrands : [];
  const normalizedBrand = normalizeBrand(brand);
  return exclusions.some((item) => normalizeBrand(item) === normalizedBrand);
}

export function buildCandidate({ row, merchant, profile, taxonomy, generatedAt }) {
  const brand = cleanOptional(field(row, "brand")) || "Sin marca";
  const identifiers = getIdentifiers(row);
  const variant = buildVariant(row);
  const model = cleanOptional(field(row, "model"));
  const modelVariantKey = buildModelVariantKey(brand, model, variant);
  const condition = normalizeCondition(field(row, "condition"), profile.defaultCondition ?? null);
  const price = getPrice(row);
  const shippingCost = parseDecimal(field(row, "deliveryCost"));
  const affiliateUrl = cleanText(field(row, "affiliateUrl"));
  const landingUrl = cleanText(field(row, "landingUrl"));
  const merchantProductId = cleanText(field(row, "merchantProductId"));
  const title = cleanText(field(row, "title"));
  const currency = cleanText(field(row, "currency")).toUpperCase();
  const advertiserId = cleanText(field(row, "merchantAdvertiserId"));
  const sourceUpdatedAt = Number.isFinite(Date.parse(field(row, "lastUpdated")))
    ? new Date(field(row, "lastUpdated")).toISOString()
    : generatedAt;
  const isForSale = parseBoolean(field(row, "isForSale"));

  const problems = [];
  if (advertiserId !== String(merchant.awinAdvertiserId ?? "")) problems.push("wrong_merchant");
  if (!title) problems.push("missing_title");
  if (!merchantProductId) problems.push("missing_merchant_product_id");
  if (identifiers.canonicalCodes.length > 1) problems.push("conflicting_global_identifiers");
  if (
    profile.requireGlobalIdentifier === true &&
    identifiers.canonicalCodes.length === 0 &&
    !identifiers.mpn
  ) {
    problems.push("missing_exact_identifier");
  } else if (
    profile.requireExactIdentifier !== false &&
    identifiers.canonicalCodes.length === 0 &&
    !identifiers.mpn &&
    !modelVariantKey
  ) {
    problems.push("missing_exact_identifier");
  }
  if (!Number.isFinite(price) || price < 0) problems.push("invalid_price");
  if (currency !== String(profile.currency || merchant.currency || "EUR").toUpperCase()) {
    problems.push("invalid_currency");
  }
  if (!condition) problems.push("unknown_condition");
  if (!isHttpsUrl(affiliateUrl)) problems.push("invalid_affiliate_url");
  if (isExcludedBrand(brand, merchant)) problems.push("excluded_brand");
  if (
    isForSale === false &&
    (profile.excludeNonCommissionable !== false || merchant.excludeNonCommissionable === true)
  ) {
    problems.push("not_commissionable");
  }

  const productId = buildProductId({ identifiers, brand, modelVariantKey });
  if (!productId) problems.push("missing_product_id");

  if (problems.length > 0) {
    return {
      problems: [...new Set(problems)],
      rowNumber: row.__rowNumber,
      merchantProductId,
      title
    };
  }

  const category = classifyCategory(row, profile, taxonomy);
  const maximumImages = Number(profile.maximumImages ?? 6);
  const images = uniqueHttpsUrls([
    field(row, "largeImage"),
    field(row, "merchantImage"),
    field(row, "awImage"),
    field(row, "alternateImage1"),
    field(row, "alternateImage2"),
    field(row, "alternateImage3"),
    field(row, "alternateImage4"),
    field(row, "merchantThumb"),
    field(row, "awThumb")
  ], maximumImages);

  if (images.length === 0) {
    return {
      problems: ["missing_image"],
      rowNumber: row.__rowNumber,
      merchantProductId,
      title
    };
  }

  const previousPrice = getPreviousPrice(row, price);
  const totalPrice = shippingCost === null ? price : price + shippingCost;
  const shortDescription = cleanDescription(
    field(row, "shortDescription"),
    Number(profile.shortDescriptionMaxLength ?? 320)
  );

  return {
    problems: [],
    rowNumber: row.__rowNumber,
    match: {
      canonicalCodes: identifiers.canonicalCodes,
      mpnKey:
        identifiers.mpn && brand
          ? `${normalizeBrand(brand)}|${normalizeMpn(identifiers.mpn)}`
          : null,
      modelVariantKey
    },
    product: {
      id: productId,
      title,
      brand,
      model,
      department: category.department,
      category: category.category,
      categories: category.categories,
      categoryPath: category.categories,
      description: makeDescription(row, title, merchant.name, profile),
      shortDescription,
      identifiers: {
        gtin: identifiers.gtin,
        ean: identifiers.ean,
        upc: identifiers.upc,
        mpn: identifiers.mpn
      },
      variant,
      condition,
      images,
      attributes: {
        merchantCategory: cleanOptional(field(row, "merchantCategory")),
        awinCategory: cleanOptional(field(row, "categoryName")),
        awinCategoryId: cleanOptional(field(row, "categoryId")),
        productType: cleanOptional(field(row, "productType")),
        dimensions: cleanOptional(field(row, "dimensions")),
        specifications: cleanDescription(field(row, "specifications"), 800) || null,
        warranty: cleanOptional(field(row, "warranty")),
        keywords: cleanOptional(field(row, "keywords")),
        promotionalText: cleanDescription(field(row, "promotionalText"), 300) || null
      },
      sourceMerchants: [merchant.id],
      sourceReferences: {
        [merchant.id]: merchantProductId
      },
      sourceUpdatedAt
    },
    offer: {
      id: `${merchant.id}:${merchantProductId}`,
      productId,
      merchantId: merchant.id,
      merchantProductId,
      country: String(profile.country || merchant.country || "ES").toUpperCase(),
      currency,
      price,
      previousPrice,
      shippingCost,
      totalPrice,
      availability: normalizeAvailability(row),
      condition,
      affiliateUrl,
      landingUrl: isHttpsUrl(landingUrl) ? landingUrl : null,
      commissionGroup: cleanOptional(field(row, "commissionGroup")),
      isCommissionable: isForSale !== false,
      stockQuantity: parseInteger(field(row, "stockQuantity")),
      deliveryTime: cleanOptional(field(row, "deliveryTime")),
      displayPrice: cleanOptional(field(row, "displayPrice")),
      source: {
        awProductId: cleanOptional(field(row, "awProductId")),
        dataFeedId: cleanOptional(field(row, "dataFeedId")),
        awinMerchantId: String(merchant.awinAdvertiserId)
      },
      lastUpdatedAt: sourceUpdatedAt
    }
  };
}

function addStrictIndex(index, key, productId, label) {
  if (!key) return;
  const existing = index.get(key);
  if (existing && existing !== productId) {
    throw new Error(
      `Catálogo existente inconsistente: ${label} ${key} pertenece a ${existing} y ${productId}`
    );
  }
  index.set(key, productId);
}

function addAmbiguousIndex(index, key, productId) {
  if (!key) return;
  if (!index.has(key)) {
    index.set(key, productId);
    return;
  }
  const existing = index.get(key);
  if (existing !== productId) index.set(key, null);
}

function productModelVariantKey(product) {
  return buildModelVariantKey(product.brand, product.model, product.variant ?? {});
}

export function buildProductIndexes(products) {
  const gtinIndex = new Map();
  const mpnIndex = new Map();
  const modelVariantIndex = new Map();

  for (const product of products) {
    const identifiers = product.identifiers ?? {};
    for (const value of [identifiers.gtin, identifiers.ean, identifiers.upc]) {
      addStrictIndex(gtinIndex, canonicalGtin(value), product.id, "GTIN");
    }
    if (identifiers.mpn && product.brand) {
      addAmbiguousIndex(
        mpnIndex,
        `${normalizeBrand(product.brand)}|${normalizeMpn(identifiers.mpn)}`,
        product.id
      );
    }
    addAmbiguousIndex(modelVariantIndex, productModelVariantKey(product), product.id);
  }

  return { gtinIndex, mpnIndex, modelVariantIndex };
}

export function resolveExistingProductId(candidate, indexes) {
  if (candidate.match.canonicalCodes.length > 0) {
    const matches = new Set();
    for (const code of candidate.match.canonicalCodes) {
      const productId = indexes.gtinIndex.get(code);
      if (productId) matches.add(productId);
    }
    if (matches.size > 1) return { conflict: [...matches] };
    return {
      productId: [...matches][0] ?? null,
      matchedBy: matches.size === 1 ? "gtin" : null
    };
  }

  if (candidate.match.mpnKey) {
    const productId = indexes.mpnIndex.get(candidate.match.mpnKey);
    return {
      productId: productId || null,
      matchedBy: productId ? "mpn" : null
    };
  }

  if (candidate.match.modelVariantKey) {
    const productId = indexes.modelVariantIndex.get(candidate.match.modelVariantKey);
    return {
      productId: productId || null,
      matchedBy: productId ? "brand_model_variant" : null
    };
  }

  return { productId: null, matchedBy: null };
}

function mergeIdentifiers(current = {}, incoming = {}) {
  return {
    gtin: current.gtin || incoming.gtin || null,
    ean: current.ean || incoming.ean || null,
    upc: current.upc || incoming.upc || null,
    mpn: current.mpn || incoming.mpn || null
  };
}

function mergeObjectPreferCurrent(current = {}, incoming = {}) {
  const result = { ...incoming };
  for (const [key, value] of Object.entries(current)) {
    const meaningful = value !== null && value !== undefined && value !== "";
    if (meaningful || !(key in result)) result[key] = value;
  }
  return result;
}

function mergeProduct(current, incoming, merchantId) {
  const currentSources = Array.isArray(current.sourceMerchants) ? current.sourceMerchants : [];
  const onlyCurrentMerchant = currentSources.length === 0 || currentSources.every((id) => id === merchantId);
  const preferIncoming = (currentValue, incomingValue, fallback = null) => {
    if (onlyCurrentMerchant && incomingValue !== null && incomingValue !== undefined && incomingValue !== "") {
      return incomingValue;
    }
    return currentValue || incomingValue || fallback;
  };

  return {
    ...current,
    title: preferIncoming(current.title, incoming.title, ""),
    brand:
      !current.brand || current.brand === "Sin marca" || onlyCurrentMerchant
        ? incoming.brand || current.brand
        : current.brand,
    model: preferIncoming(current.model, incoming.model),
    department: preferIncoming(current.department, incoming.department),
    category: preferIncoming(current.category, incoming.category),
    categories: uniqueStrings([...(current.categories ?? []), ...(incoming.categories ?? [])]),
    categoryPath: uniqueStrings([...(current.categoryPath ?? []), ...(incoming.categoryPath ?? [])]),
    description: preferIncoming(current.description, incoming.description, ""),
    shortDescription: preferIncoming(current.shortDescription, incoming.shortDescription, ""),
    identifiers: mergeIdentifiers(current.identifiers, incoming.identifiers),
    variant: onlyCurrentMerchant
      ? { ...(current.variant ?? {}), ...(incoming.variant ?? {}) }
      : mergeObjectPreferCurrent(current.variant, incoming.variant),
    condition: preferIncoming(current.condition, incoming.condition),
    images: uniqueHttpsUrls([...(incoming.images ?? []), ...(current.images ?? [])]),
    attributes: onlyCurrentMerchant
      ? { ...(current.attributes ?? {}), ...(incoming.attributes ?? {}) }
      : mergeObjectPreferCurrent(current.attributes, incoming.attributes),
    sourceMerchants: uniqueStrings([...currentSources, ...(incoming.sourceMerchants ?? [])]).sort(),
    sourceReferences: {
      ...(current.sourceReferences ?? {}),
      ...(incoming.sourceReferences ?? {})
    },
    sourceUpdatedAt: chooseNewestIso(current.sourceUpdatedAt, incoming.sourceUpdatedAt)
  };
}

function registerProductIndexes(product, indexes) {
  const identifiers = product.identifiers ?? {};
  for (const value of [identifiers.gtin, identifiers.ean, identifiers.upc]) {
    addStrictIndex(indexes.gtinIndex, canonicalGtin(value), product.id, "GTIN");
  }
  if (identifiers.mpn && product.brand) {
    addAmbiguousIndex(
      indexes.mpnIndex,
      `${normalizeBrand(product.brand)}|${normalizeMpn(identifiers.mpn)}`,
      product.id
    );
  }
  addAmbiguousIndex(indexes.modelVariantIndex, productModelVariantKey(product), product.id);
}

function chooseOffer(current, incoming) {
  if (!current) return incoming;
  const currentTimestamp = Date.parse(current.lastUpdatedAt);
  const incomingTimestamp = Date.parse(incoming.lastUpdatedAt);
  if (Number.isFinite(incomingTimestamp) && Number.isFinite(currentTimestamp)) {
    if (incomingTimestamp > currentTimestamp) return incoming;
    if (incomingTimestamp < currentTimestamp) return current;
  }
  const currentTotal = Number.isFinite(current.totalPrice) ? current.totalPrice : current.price;
  const incomingTotal = Number.isFinite(incoming.totalPrice) ? incoming.totalPrice : incoming.price;
  return incomingTotal < currentTotal ? incoming : current;
}

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1;
}

function resolveMerchant(feed, merchantsPayload, requestedMerchantId) {
  const advertiserIds = uniqueStrings(
    feed.records.map((row) => field(row, "merchantAdvertiserId"))
  );

  if (advertiserIds.length !== 1) {
    throw new Error(
      `El feed debe contener un único merchant_id de Awin. Encontrados: ${advertiserIds.join(", ") || "ninguno"}`
    );
  }

  const advertiserId = advertiserIds[0];
  const candidates = merchantsPayload.merchants.filter(
    (merchant) => String(merchant.awinAdvertiserId ?? "") === advertiserId
  );

  let merchant;
  if (requestedMerchantId) {
    merchant = merchantsPayload.merchants.find((item) => item.id === requestedMerchantId);
    if (!merchant) throw new Error(`merchants.json no contiene ${requestedMerchantId}`);
    if (String(merchant.awinAdvertiserId ?? "") !== advertiserId) {
      throw new Error(
        `${requestedMerchantId} tiene awinAdvertiserId ${merchant.awinAdvertiserId ?? "sin configurar"}, pero el feed contiene ${advertiserId}`
      );
    }
  } else if (candidates.length === 1) {
    [merchant] = candidates;
  } else if (candidates.length === 0) {
    throw new Error(
      `No existe un merchant en merchants.json con awinAdvertiserId ${advertiserId}`
    );
  } else {
    throw new Error(
      `Hay varios merchants con awinAdvertiserId ${advertiserId}; utiliza --merchant <id>`
    );
  }

  if (merchant.status !== "approved") {
    throw new Error(`${merchant.id} debe estar aprobado antes de importar el feed`);
  }

  return merchant;
}

function removeMerchantSource(product, merchantId) {
  const sourceMerchants = (product.sourceMerchants ?? []).filter((id) => id !== merchantId);
  const sourceReferences = { ...(product.sourceReferences ?? {}) };
  delete sourceReferences[merchantId];
  return { ...product, sourceMerchants, sourceReferences };
}

export async function importAwinFeed(options) {
  if (!options?.inputPath) throw new Error("Falta la ruta del feed de Awin");

  const catalogDir = resolve(options.catalogDir ?? DEFAULT_CATALOG_DIR);
  const productsPath = resolve(catalogDir, "products.json");
  const offersPath = resolve(catalogDir, "offers.json");
  const merchantsPath = resolve(catalogDir, "merchants.json");
  const profilesPath = resolve(options.profilesPath ?? resolve(catalogDir, "awin-import-profiles.json"));
  const taxonomyPath = resolve(options.taxonomyPath ?? resolve(catalogDir, "category-taxonomy.json"));

  const [feed, productsPayload, offersPayload, merchantsPayload, profilesPayload, taxonomyPayload] =
    await Promise.all([
      readAwinFeed(options.inputPath),
      readJson(productsPath, { schemaVersion: 1, generatedAt: null, products: [] }),
      readJson(offersPath, { schemaVersion: 1, generatedAt: null, offers: [] }),
      readJson(merchantsPath),
      readJson(profilesPath),
      readJson(taxonomyPath)
    ]);

  const fieldMapping = assertRequiredLogicalFields(feed.headers);
  assertSchema(productsPayload, "products.json", "products");
  assertSchema(offersPayload, "offers.json", "offers");
  assertSchema(merchantsPayload, "merchants.json", "merchants");
  if (profilesPayload?.schemaVersion !== 1 || typeof profilesPayload.default !== "object") {
    throw new Error("awin-import-profiles.json: estructura no compatible");
  }
  if (taxonomyPayload?.schemaVersion !== 1 || !Array.isArray(taxonomyPayload.categories)) {
    throw new Error("category-taxonomy.json: estructura no compatible");
  }

  const merchant = resolveMerchant(feed, merchantsPayload, options.merchantId);
  const profile = {
    ...(profilesPayload.default ?? {}),
    ...(profilesPayload.merchants?.[merchant.id] ?? {}),
    country: profilesPayload.merchants?.[merchant.id]?.country || merchant.country || profilesPayload.default?.country,
    currency: profilesPayload.merchants?.[merchant.id]?.currency || merchant.currency || profilesPayload.default?.currency
  };

  const generatedAt = options.generatedAt || new Date().toISOString();
  const reportPath = resolve(
    options.reportPath ?? resolve(catalogDir, `import-reports/${merchant.id}-last.json`)
  );

  const existingMerchantOffers = offersPayload.offers.filter(
    (offer) => offer.merchantId === merchant.id
  );
  if (options.limit && existingMerchantOffers.length > 0 && options.allowPartialReplace !== true) {
    throw new Error(
      `Importación parcial bloqueada: ya existen ofertas de ${merchant.id}. Usa el feed completo o --allow-partial-replace.`
    );
  }

  const productsById = new Map(
    productsPayload.products.map((product) => [product.id, structuredClone(product)])
  );
  const indexes = buildProductIndexes([...productsById.values()]);
  const otherOffers = offersPayload.offers.filter((offer) => offer.merchantId !== merchant.id);
  const importedOffersById = new Map();
  const importedProductIds = new Set();

  const report = {
    schemaVersion: 1,
    merchantId: merchant.id,
    merchantName: merchant.name,
    awinMerchantId: String(merchant.awinAdvertiserId),
    importedAt: generatedAt,
    sourceArchive: feed.sourceArchive,
    sourceFile: feed.sourceFile,
    sourceColumns: feed.headers.length,
    fieldMapping,
    mode: options.dryRun ? "dry_run" : options.limit ? "pilot" : "full",
    limit: options.limit ?? null,
    totals: {
      feedRows: feed.records.length,
      examinedRows: 0,
      acceptedRows: 0,
      skippedRows: 0,
      productsCreated: 0,
      productsMatched: 0,
      productsUpdated: 0,
      offersWritten: 0,
      duplicateRowsCollapsed: 0,
      orphanProductsRemoved: 0
    },
    matching: {
      gtin: 0,
      mpn: 0,
      brand_model_variant: 0
    },
    categories: {},
    skipReasons: {},
    conflictRows: [],
    skippedExamples: [],
    notes: [
      "La coincidencia exacta usa GTIN/EAN/UPC, marca + MPN y, como último respaldo, marca + modelo + variante completa.",
      "Las filas sin identificador exacto se omiten salvo que el perfil del merchant permita lo contrario.",
      "La importación completa reemplaza únicamente las ofertas del merchant procesado."
    ]
  };

  for (const row of feed.records) {
    if (options.limit && report.totals.acceptedRows >= options.limit) break;
    report.totals.examinedRows += 1;

    const candidate = buildCandidate({
      row,
      merchant,
      profile,
      taxonomy: taxonomyPayload,
      generatedAt
    });

    if (candidate.problems.length > 0) {
      report.totals.skippedRows += 1;
      for (const problem of candidate.problems) increment(report.skipReasons, problem);
      if (report.skippedExamples.length < 25) {
        report.skippedExamples.push({
          rowNumber: candidate.rowNumber,
          merchantProductId: candidate.merchantProductId || null,
          title: candidate.title || null,
          reasons: candidate.problems
        });
      }
      continue;
    }

    const resolution = resolveExistingProductId(candidate, indexes);
    if (resolution.conflict) {
      report.totals.skippedRows += 1;
      increment(report.skipReasons, "identifier_conflict");
      report.conflictRows.push({
        rowNumber: candidate.rowNumber,
        merchantProductId: candidate.offer.merchantProductId,
        productIds: resolution.conflict
      });
      continue;
    }

    let productId = resolution.productId;
    if (productId) {
      const current = productsById.get(productId);
      const merged = mergeProduct(current, { ...candidate.product, id: productId }, merchant.id);
      productsById.set(productId, merged);
      registerProductIndexes(merged, indexes);
      report.totals.productsMatched += 1;
      report.totals.productsUpdated += 1;
      increment(report.matching, resolution.matchedBy);
    } else {
      productId = candidate.product.id;
      if (productsById.has(productId)) {
        throw new Error(`Colisión de productId generado: ${productId}`);
      }
      productsById.set(productId, candidate.product);
      registerProductIndexes(candidate.product, indexes);
      report.totals.productsCreated += 1;
    }

    const offer = { ...candidate.offer, productId };
    const previousOffer = importedOffersById.get(offer.id);
    if (previousOffer) report.totals.duplicateRowsCollapsed += 1;
    importedOffersById.set(offer.id, chooseOffer(previousOffer, offer));
    importedProductIds.add(productId);
    increment(report.categories, candidate.product.category);
    report.totals.acceptedRows += 1;
  }

  const importedOffers = [...importedOffersById.values()];
  const allOffers = [...otherOffers, ...importedOffers].sort((a, b) =>
    String(a.id).localeCompare(String(b.id), "en")
  );

  for (const [productId, product] of productsById) {
    if ((product.sourceMerchants ?? []).includes(merchant.id) && !importedProductIds.has(productId)) {
      productsById.set(productId, removeMerchantSource(product, merchant.id));
    }
  }

  if (options.pruneOrphans !== false) {
    const referencedProductIds = new Set(allOffers.map((offer) => offer.productId));
    for (const productId of [...productsById.keys()]) {
      if (!referencedProductIds.has(productId)) {
        productsById.delete(productId);
        report.totals.orphanProductsRemoved += 1;
      }
    }
  }

  const allProducts = [...productsById.values()].sort((a, b) =>
    String(a.id).localeCompare(String(b.id), "en")
  );

  report.totals.offersWritten = importedOffers.length;
  report.output = {
    products: allProducts.length,
    offers: allOffers.length,
    merchantOffersReplaced: existingMerchantOffers.length
  };

  report.categories = Object.fromEntries(
    Object.entries(report.categories).sort((a, b) => b[1] - a[1])
  );

  const nextProductsPayload = {
    schemaVersion: 1,
    generatedAt,
    products: allProducts
  };
  const nextOffersPayload = {
    schemaVersion: 1,
    generatedAt,
    offers: allOffers
  };

  if (!options.dryRun) {
    await atomicWriteJson(productsPath, nextProductsPayload);
    await atomicWriteJson(offersPath, nextOffersPayload);
  }
  await atomicWriteJson(reportPath, report);

  return {
    report,
    products: nextProductsPayload,
    offers: nextOffersPayload,
    merchant,
    profile
  };
}
