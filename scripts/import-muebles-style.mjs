#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
} from "./lib/awin-feed-utils.mjs";

const MERCHANT_ID = "muebles-style-spain";
const EXPECTED_AWIN_MERCHANT_ID = "122118";
const DEFAULT_CATALOG_DIR = resolve(process.cwd(), "data/catalog");
const REQUIRED_COLUMNS = [
  "aw_deep_link",
  "product_name",
  "aw_product_id",
  "merchant_product_id",
  "search_price",
  "merchant_id",
  "currency",
  "condition",
  "ean"
];

function printHelp() {
  console.log(`Uso:
  node scripts/import-muebles-style.mjs <feed.csv|feed.zip> [opciones]

Opciones:
  --catalog-dir <ruta>       Carpeta del catálogo. Por defecto: data/catalog
  --limit <n>                Importa solo los primeros n productos válidos.
  --dry-run                  Valida y genera el informe sin modificar el catálogo.
  --keep-orphans             No elimina productos que se queden sin ofertas.
  --allow-partial-replace    Permite usar --limit aunque ya existan ofertas del merchant.
  --generated-at <ISO>       Fecha ISO utilizada como actualización del feed.
  --report <ruta>            Ruta del informe JSON.
  --help                     Muestra esta ayuda.

El importador no necesita dependencias externas y acepta directamente el ZIP de Awin.`);
}

export function parseArguments(argv) {
  const options = {
    inputPath: null,
    catalogDir: DEFAULT_CATALOG_DIR,
    limit: null,
    dryRun: false,
    pruneOrphans: true,
    allowPartialReplace: false,
    generatedAt: new Date().toISOString(),
    reportPath: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--keep-orphans") {
      options.pruneOrphans = false;
    } else if (argument === "--allow-partial-replace") {
      options.allowPartialReplace = true;
    } else if (argument === "--catalog-dir") {
      options.catalogDir = resolve(argv[++index] ?? "");
    } else if (argument === "--limit") {
      const limit = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit debe ser un entero positivo");
      options.limit = limit;
    } else if (argument === "--generated-at") {
      const generatedAt = argv[++index] ?? "";
      if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("--generated-at debe ser una fecha ISO válida");
      options.generatedAt = new Date(generatedAt).toISOString();
    } else if (argument === "--report") {
      options.reportPath = resolve(argv[++index] ?? "");
    } else if (argument.startsWith("--")) {
      throw new Error(`Opción desconocida: ${argument}`);
    } else if (!options.inputPath) {
      options.inputPath = resolve(argument);
    } else {
      throw new Error(`Argumento inesperado: ${argument}`);
    }
  }

  options.catalogDir = resolve(options.catalogDir);
  options.reportPath ||= resolve(
    options.catalogDir,
    "import-reports/muebles-style-last.json"
  );

  return options;
}

function assertSchema(payload, name, arrayName) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload[arrayName])) {
    throw new Error(`${name}: estructura no compatible`);
  }
}

function assertRequiredColumns(headers) {
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`El feed no contiene las columnas obligatorias: ${missing.join(", ")}`);
  }
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

function normalizeCondition(value) {
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
  return null;
}

function mapCategory(row) {
  const source = normalizeSearchText(
    [row.merchant_category, row.product_type, row.category_name, row.product_name].join(" ")
  );

  const rules = [
    ["sofa", "sofas"],
    ["sillon", "sillas-y-sillones"],
    ["silla", "sillas-y-sillones"],
    ["taburete", "sillas-y-sillones"],
    ["banco", "sillas-y-sillones"],
    ["divan", "sillas-y-sillones"],
    ["cama", "dormitorio"],
    ["colchon", "dormitorio"],
    ["mesita", "mesas"],
    ["mesa", "mesas"],
    ["armario", "almacenaje"],
    ["estanteria", "almacenaje"],
    ["aparador", "almacenaje"],
    ["comoda", "almacenaje"],
    ["storage", "almacenaje"],
    ["lampara", "iluminacion"],
    ["lighting", "iluminacion"],
    ["jardin", "jardin"],
    ["garden", "jardin"],
    ["alfombra", "textiles-del-hogar"],
    ["cojin", "textiles-del-hogar"],
    ["textile", "textiles-del-hogar"],
    ["cubiertos", "cocina"],
    ["cutlery", "cocina"]
  ];

  return rules.find(([needle]) => source.includes(needle))?.[1] ?? "hogar-y-muebles";
}

function getIdentifiers(row) {
  const rawGtin = normalizeGtin(row.product_GTIN);
  const rawEan = normalizeGtin(row.ean);
  const rawUpc = normalizeGtin(row.upc);
  const validCodes = [rawGtin, rawEan, rawUpc]
    .map((value) => canonicalGtin(value))
    .filter(Boolean);

  return {
    gtin: rawGtin && canonicalGtin(rawGtin) ? rawGtin : null,
    ean: rawEan && canonicalGtin(rawEan) ? rawEan : null,
    upc: rawUpc && canonicalGtin(rawUpc) ? rawUpc : null,
    mpn: cleanText(row.mpn) || null,
    canonicalCodes: [...new Set(validCodes)]
  };
}

function buildProductId(identifiers, brand) {
  if (identifiers.canonicalCodes[0]) return `gtin-${identifiers.canonicalCodes[0]}`;
  if (identifiers.mpn && brand) {
    return `mpn-${slugify(brand)}-${slugify(identifiers.mpn)}`;
  }
  return null;
}

function normalizeAvailability(row) {
  const inStock = parseBoolean(row.in_stock);
  const stockQuantity = parseInteger(row.stock_quantity);
  const isForSale = parseBoolean(row.is_for_sale);
  const preOrder = parseBoolean(row.pre_order);
  const status = normalizeSearchText(row.stock_status);

  if (preOrder === true) return "preorder";
  if (isForSale === false) return "unavailable";
  if (status.includes("discontinued")) return "discontinued";
  if (status.includes("out of stock") || status.includes("agotado")) return "out_of_stock";
  if (stockQuantity !== null && stockQuantity <= 0) return "out_of_stock";
  if (inStock === false) return "out_of_stock";
  if (inStock === true || (stockQuantity !== null && stockQuantity > 0)) return "in_stock";
  return "unknown";
}

function getPrice(row) {
  return parseDecimal(row.search_price) ?? parseDecimal(row.store_price);
}

function getPreviousPrice(row, price) {
  const candidates = [row.product_price_old, row.rrp_price]
    .map(parseDecimal)
    .filter((candidate) => Number.isFinite(candidate) && candidate > price);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function buildCandidate(row, generatedAt) {
  const brand = cleanText(row.brand_name) || "Sin marca";
  const identifiers = getIdentifiers(row);
  const condition = normalizeCondition(row.condition);
  const price = getPrice(row);
  const shippingCost = parseDecimal(row.delivery_cost);
  const affiliateUrl = cleanText(row.aw_deep_link);
  const landingUrl = cleanText(row.merchant_deep_link);
  const merchantProductId = cleanText(row.merchant_product_id);
  const title = cleanText(row.product_name);
  const currency = cleanText(row.currency).toUpperCase();
  const sourceUpdatedAt = Number.isFinite(Date.parse(row.last_updated))
    ? new Date(row.last_updated).toISOString()
    : generatedAt;

  const problems = [];
  if (cleanText(row.merchant_id) !== EXPECTED_AWIN_MERCHANT_ID) problems.push("wrong_merchant");
  if (!title) problems.push("missing_title");
  if (!merchantProductId) problems.push("missing_merchant_product_id");
  if (identifiers.canonicalCodes.length > 1) problems.push("conflicting_global_identifiers");
  if (!identifiers.canonicalCodes.length && !identifiers.mpn) problems.push("missing_exact_identifier");
  if (!Number.isFinite(price) || price < 0) problems.push("invalid_price");
  if (currency !== "EUR") problems.push("invalid_currency");
  if (!condition) problems.push("unknown_condition");
  if (!isHttpsUrl(affiliateUrl)) problems.push("invalid_affiliate_url");

  const productId = buildProductId(identifiers, brand);
  if (!productId) problems.push("missing_product_id");

  if (problems.length > 0) {
    return {
      problems: [...new Set(problems)],
      rowNumber: row.__rowNumber,
      merchantProductId,
      title
    };
  }

  const images = uniqueHttpsUrls([
    row.large_image,
    row.merchant_image_url,
    row.aw_image_url,
    row.alternate_image,
    row.alternate_image_two,
    row.alternate_image_three,
    row.alternate_image_four,
    row.merchant_thumb_url,
    row.aw_thumb_url
  ]);

  const previousPrice = getPreviousPrice(row, price);
  const totalPrice = shippingCost === null ? price : price + shippingCost;

  return {
    problems: [],
    rowNumber: row.__rowNumber,
    match: {
      canonicalCodes: identifiers.canonicalCodes,
      mpnKey:
        identifiers.mpn && brand
          ? `${normalizeBrand(brand)}|${normalizeMpn(identifiers.mpn)}`
          : null
    },
    product: {
      id: productId,
      title,
      brand,
      model: cleanOptional(row.product_model) || cleanOptional(row.model_number),
      category: mapCategory(row),
      description: cleanDescription(row.description),
      shortDescription: cleanDescription(row.product_short_description, 400),
      identifiers: {
        gtin: identifiers.gtin,
        ean: identifiers.ean,
        upc: identifiers.upc,
        mpn: identifiers.mpn
      },
      variant: {
        color: cleanOptional(row.colour),
        size: null,
        capacity: null,
        configuration: cleanOptional(row.dimensions)
      },
      condition,
      images,
      attributes: {
        merchantCategory: cleanOptional(row.merchant_category),
        awinCategory: cleanOptional(row.category_name),
        awinCategoryId: cleanOptional(row.category_id),
        productType: cleanOptional(row.product_type),
        dimensions: cleanOptional(row.dimensions),
        specifications: cleanDescription(row.specifications, 1_000) || null,
        warranty: cleanOptional(row.warranty),
        keywords: cleanOptional(row.keywords)
      },
      sourceMerchants: [MERCHANT_ID],
      sourceReferences: {
        [MERCHANT_ID]: merchantProductId
      },
      sourceUpdatedAt
    },
    offer: {
      id: `${MERCHANT_ID}:${merchantProductId}`,
      productId,
      merchantId: MERCHANT_ID,
      merchantProductId,
      country: "ES",
      currency,
      price,
      previousPrice,
      shippingCost,
      totalPrice,
      availability: normalizeAvailability(row),
      condition,
      affiliateUrl,
      landingUrl: isHttpsUrl(landingUrl) ? landingUrl : null,
      commissionGroup: cleanText(row.commission_group) || null,
      isCommissionable: parseBoolean(row.is_for_sale) !== false,
      stockQuantity: parseInteger(row.stock_quantity),
      deliveryTime: cleanText(row.delivery_time) || null,
      displayPrice: cleanText(row.display_price) || null,
      source: {
        awProductId: cleanText(row.aw_product_id) || null,
        dataFeedId: cleanText(row.data_feed_id) || null,
        awinMerchantId: EXPECTED_AWIN_MERCHANT_ID
      },
      lastUpdatedAt: sourceUpdatedAt
    }
  };
}

function addIndex(index, key, productId, label) {
  if (!key) return;
  const existing = index.get(key);
  if (existing && existing !== productId) {
    throw new Error(`Catálogo existente inconsistente: ${label} ${key} pertenece a ${existing} y ${productId}`);
  }
  index.set(key, productId);
}

function buildProductIndexes(products) {
  const gtinIndex = new Map();
  const mpnIndex = new Map();

  for (const product of products) {
    const identifiers = product.identifiers ?? {};
    for (const value of [identifiers.gtin, identifiers.ean, identifiers.upc]) {
      addIndex(gtinIndex, canonicalGtin(value), product.id, "GTIN");
    }
    if (identifiers.mpn && product.brand) {
      addIndex(
        mpnIndex,
        `${normalizeBrand(product.brand)}|${normalizeMpn(identifiers.mpn)}`,
        product.id,
        "MPN"
      );
    }
  }

  return { gtinIndex, mpnIndex };
}

function resolveExistingProductId(candidate, indexes) {
  const matches = new Set();
  for (const code of candidate.match.canonicalCodes) {
    const productId = indexes.gtinIndex.get(code);
    if (productId) matches.add(productId);
  }
  if (candidate.match.mpnKey) {
    const productId = indexes.mpnIndex.get(candidate.match.mpnKey);
    if (productId) matches.add(productId);
  }

  if (matches.size > 1) {
    return { conflict: [...matches] };
  }
  return { productId: [...matches][0] ?? null };
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
    const hasMeaningfulValue = value !== null && value !== undefined && value !== "";
    if (hasMeaningfulValue || !(key in result)) result[key] = value;
  }
  return result;
}

function mergeProduct(current, incoming) {
  return {
    ...current,
    title: current.title || incoming.title,
    brand:
      !current.brand || current.brand === "Sin marca"
        ? incoming.brand
        : current.brand,
    model: current.model || incoming.model || null,
    category: current.category || incoming.category,
    description: current.description || incoming.description || "",
    shortDescription: current.shortDescription || incoming.shortDescription || "",
    identifiers: mergeIdentifiers(current.identifiers, incoming.identifiers),
    variant: mergeObjectPreferCurrent(current.variant, incoming.variant),
    condition: current.condition || incoming.condition,
    images: uniqueHttpsUrls([...(current.images ?? []), ...(incoming.images ?? [])]),
    attributes: mergeObjectPreferCurrent(current.attributes, incoming.attributes),
    sourceMerchants: [
      ...new Set([...(current.sourceMerchants ?? []), ...(incoming.sourceMerchants ?? [])])
    ].sort(),
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
    addIndex(indexes.gtinIndex, canonicalGtin(value), product.id, "GTIN");
  }
  if (identifiers.mpn && product.brand) {
    addIndex(
      indexes.mpnIndex,
      `${normalizeBrand(product.brand)}|${normalizeMpn(identifiers.mpn)}`,
      product.id,
      "MPN"
    );
  }
}

function chooseOffer(current, incoming) {
  if (!current) return incoming;
  const currentTotal = Number.isFinite(current.totalPrice) ? current.totalPrice : current.price;
  const incomingTotal = Number.isFinite(incoming.totalPrice) ? incoming.totalPrice : incoming.price;
  if (incomingTotal < currentTotal) return incoming;
  if (incomingTotal > currentTotal) return current;
  return String(incoming.id).localeCompare(String(current.id), "en") < 0 ? incoming : current;
}

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1;
}

export async function importMueblesStyle(options) {
  if (!options.inputPath) throw new Error("Falta la ruta del feed de Muebles Style");

  const catalogDir = resolve(options.catalogDir ?? DEFAULT_CATALOG_DIR);
  const productsPath = resolve(catalogDir, "products.json");
  const offersPath = resolve(catalogDir, "offers.json");
  const merchantsPath = resolve(catalogDir, "merchants.json");
  const reportPath = resolve(
    options.reportPath ?? resolve(catalogDir, "import-reports/muebles-style-last.json")
  );

  const [feed, productsPayload, offersPayload, merchantsPayload] = await Promise.all([
    readAwinFeed(options.inputPath),
    readJson(productsPath, { schemaVersion: 1, generatedAt: null, products: [] }),
    readJson(offersPath, { schemaVersion: 1, generatedAt: null, offers: [] }),
    readJson(merchantsPath)
  ]);

  assertRequiredColumns(feed.headers);
  assertSchema(productsPayload, "products.json", "products");
  assertSchema(offersPayload, "offers.json", "offers");
  assertSchema(merchantsPayload, "merchants.json", "merchants");

  const merchant = merchantsPayload.merchants.find((item) => item.id === MERCHANT_ID);
  if (!merchant) throw new Error(`merchants.json no contiene ${MERCHANT_ID}`);
  if (merchant.status !== "approved") {
    throw new Error(`${MERCHANT_ID} debe estar aprobado antes de importar el feed`);
  }

  const existingMerchantOffers = offersPayload.offers.filter(
    (offer) => offer.merchantId === MERCHANT_ID
  );
  if (
    options.limit &&
    existingMerchantOffers.length > 0 &&
    options.allowPartialReplace !== true
  ) {
    throw new Error(
      "Importación parcial bloqueada: ya existen ofertas de Muebles Style. Usa el feed completo o --allow-partial-replace."
    );
  }

  const productsById = new Map(
    productsPayload.products.map((product) => [product.id, structuredClone(product)])
  );
  const indexes = buildProductIndexes([...productsById.values()]);
  const otherOffers = offersPayload.offers.filter((offer) => offer.merchantId !== MERCHANT_ID);
  const importedOffersByProduct = new Map();

  const report = {
    schemaVersion: 1,
    merchantId: MERCHANT_ID,
    awinMerchantId: EXPECTED_AWIN_MERCHANT_ID,
    importedAt: options.generatedAt,
    sourceArchive: feed.sourceArchive,
    sourceFile: feed.sourceFile,
    sourceColumns: feed.headers.length,
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
    skipReasons: {},
    conflictRows: [],
    skippedExamples: [],
    notes: [
      "La coincidencia exacta usa GTIN/EAN/UPC normalizado y, como respaldo, marca + MPN.",
      "Las filas sin identificador exacto se omiten para evitar comparaciones incorrectas."
    ]
  };

  for (const row of feed.records) {
    if (options.limit && report.totals.acceptedRows >= options.limit) break;
    report.totals.examinedRows += 1;

    const candidate = buildCandidate(row, options.generatedAt);
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
      const merged = mergeProduct(current, { ...candidate.product, id: productId });
      productsById.set(productId, merged);
      registerProductIndexes(merged, indexes);
      report.totals.productsMatched += 1;
      report.totals.productsUpdated += 1;
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
    const previousOffer = importedOffersByProduct.get(productId);
    if (previousOffer) report.totals.duplicateRowsCollapsed += 1;
    importedOffersByProduct.set(productId, chooseOffer(previousOffer, offer));
    report.totals.acceptedRows += 1;
  }

  const importedOffers = [...importedOffersByProduct.values()];
  const allOffers = [...otherOffers, ...importedOffers].sort((a, b) =>
    String(a.id).localeCompare(String(b.id), "en")
  );

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

  const nextProductsPayload = {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    products: allProducts
  };
  const nextOffersPayload = {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    offers: allOffers
  };

  if (!options.dryRun) {
    await atomicWriteJson(productsPath, nextProductsPayload);
    await atomicWriteJson(offersPath, nextOffersPayload);
  }
  await atomicWriteJson(reportPath, report);

  return { report, products: nextProductsPayload, offers: nextOffersPayload };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.inputPath) {
    printHelp();
    throw new Error("Falta la ruta del feed");
  }

  const { report } = await importMueblesStyle(options);
  console.log(
    [
      `Feed: ${report.sourceFile}`,
      `Modo: ${report.mode}`,
      `Filas: ${report.totals.feedRows}`,
      `Aceptadas: ${report.totals.acceptedRows}`,
      `Omitidas: ${report.totals.skippedRows}`,
      `Productos creados: ${report.totals.productsCreated}`,
      `Ofertas escritas: ${report.totals.offersWritten}`,
      `Informe: ${options.reportPath}`
    ].join("\n")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[SecretShop] ${error.message}`);
    process.exitCode = 1;
  });
}
