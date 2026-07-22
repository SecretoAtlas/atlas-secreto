import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "data/catalog");

async function readJson(name) {
  const path = resolve(root, name);
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateRuntime(payload) {
  assert(payload.schemaVersion === 1, "catalog-runtime.json: schemaVersion inválido");
  assert(typeof payload.enabled === "boolean", "catalog-runtime.json: enabled debe ser boolean");
  assert(typeof payload.autoStart === "boolean", "catalog-runtime.json: autoStart debe ser boolean");
  assert(/^[A-Z]{2}$/.test(payload.country), "catalog-runtime.json: country inválido");
  assert(typeof payload.dataBasePath === "string" && payload.dataBasePath, "catalog-runtime.json: dataBasePath obligatorio");
}

function validateConfig(payload) {
  assert(payload.schemaVersion === 1, "catalog-config.json: schemaVersion inválido");
  assert(Array.isArray(payload.supportedCountries), "catalog-config.json: supportedCountries debe ser un array");
  const codes = new Set();
  for (const country of payload.supportedCountries) {
    assert(/^[A-Z]{2}$/.test(country.code), `Código de país inválido: ${country.code}`);
    assert(!codes.has(country.code), `País duplicado: ${country.code}`);
    codes.add(country.code);
    assert(/^[A-Z]{3}$/.test(country.currency), `${country.code}: moneda inválida`);
    assert(typeof country.enabled === "boolean", `${country.code}: enabled debe ser boolean`);
  }
  return codes;
}

function validateMerchants(payload) {
  assert(payload.schemaVersion === 1, "merchants.json: schemaVersion inválido");
  assert(Array.isArray(payload.merchants), "merchants.json: merchants debe ser un array");
  const ids = new Set();
  const byId = new Map();
  for (const merchant of payload.merchants) {
    assert(typeof merchant.id === "string" && merchant.id, "Merchant sin id");
    assert(!ids.has(merchant.id), `Merchant duplicado: ${merchant.id}`);
    ids.add(merchant.id);
    byId.set(merchant.id, merchant);
    assert(typeof merchant.name === "string" && merchant.name, `${merchant.id}: name obligatorio`);
    assert(/^[A-Z]{2}$/.test(merchant.country), `${merchant.id}: country inválido`);
    assert(["pending", "approved", "rejected", "paused"].includes(merchant.status), `${merchant.id}: status inválido`);
    if (merchant.status === "approved") {
      assert(String(merchant.awinAdvertiserId || "").trim(), `${merchant.id}: awinAdvertiserId obligatorio al estar aprobado`);
    }
  }
  return { ids, byId };
}

function validateTaxonomy(payload) {
  assert(payload.schemaVersion === 1, "category-taxonomy.json: schemaVersion inválido");
  assert(Array.isArray(payload.categories), "category-taxonomy.json: categories debe ser un array");
  const labels = new Set();
  const ids = new Set();
  for (const category of payload.categories) {
    assert(typeof category.id === "string" && category.id, "Categoría sin id");
    assert(!ids.has(category.id), `ID de categoría duplicado: ${category.id}`);
    ids.add(category.id);
    assert(typeof category.label === "string" && category.label, `${category.id}: label obligatorio`);
    assert(!labels.has(category.label), `Etiqueta de categoría duplicada: ${category.label}`);
    labels.add(category.label);
    assert(Number.isFinite(category.order), `${category.id}: order inválido`);
    assert(typeof category.showOnHome === "boolean", `${category.id}: showOnHome debe ser boolean`);
  }
  for (const category of payload.categories) {
    if (category.parent !== null) {
      assert(labels.has(category.parent), `${category.id}: parent inexistente: ${category.parent}`);
    }
  }
  return labels;
}

function validateProfiles(payload, merchantIds, categoryLabels) {
  assert(payload.schemaVersion === 1, "awin-import-profiles.json: schemaVersion inválido");
  assert(payload.default && typeof payload.default === "object", "awin-import-profiles.json: default obligatorio");
  assert(payload.merchants && typeof payload.merchants === "object", "awin-import-profiles.json: merchants obligatorio");
  for (const [merchantId, profile] of Object.entries(payload.merchants)) {
    assert(merchantIds.has(merchantId), `Perfil de merchant inexistente: ${merchantId}`);
    assert(/^[A-Z]{2}$/.test(profile.country), `${merchantId}: country de perfil inválido`);
    assert(/^[A-Z]{3}$/.test(profile.currency), `${merchantId}: currency de perfil inválida`);
    for (const rule of profile.categoryRules ?? []) {
      assert(categoryLabels.has(rule.category), `${merchantId}: categoría desconocida: ${rule.category}`);
      assert(Array.isArray(rule.includeAny) && rule.includeAny.length > 0, `${merchantId}: regla sin includeAny`);
    }
  }
}

function validateProducts(payload, categoryLabels) {
  assert(payload.schemaVersion === 1, "products.json: schemaVersion inválido");
  assert(Array.isArray(payload.products), "products.json: products debe ser un array");
  assert(isIsoDate(payload.generatedAt), "products.json: generatedAt inválido");
  const ids = new Set();
  for (const product of payload.products) {
    assert(typeof product.id === "string" && product.id, "Producto sin id");
    assert(!ids.has(product.id), `Producto duplicado: ${product.id}`);
    ids.add(product.id);
    assert(typeof product.title === "string" && product.title, `${product.id}: title obligatorio`);
    assert(typeof product.brand === "string" && product.brand, `${product.id}: brand obligatorio`);
    assert(typeof product.description === "string" && product.description.length >= 20, `${product.id}: description insuficiente`);
    assert(Array.isArray(product.images) && product.images.length > 0, `${product.id}: images obligatorio`);
    assert(product.images.every((url) => /^https:\/\//.test(url)), `${product.id}: imagen no HTTPS`);
    assert(Array.isArray(product.categories) && product.categories.length > 0, `${product.id}: categories obligatorio`);
    for (const category of product.categories) {
      assert(categoryLabels.has(category), `${product.id}: categoría desconocida: ${category}`);
    }
    assert(categoryLabels.has(product.category), `${product.id}: category desconocida: ${product.category}`);
    if (product.department) {
      assert(categoryLabels.has(product.department), `${product.id}: department desconocido: ${product.department}`);
    }
    const identifiers = product.identifiers ?? {};
    const hasExactId = [identifiers.gtin, identifiers.ean, identifiers.upc, identifiers.mpn].some(Boolean);
    const hasModelVariant = Boolean(
      product.brand &&
      product.model &&
      product.variant &&
      Object.values(product.variant).some(Boolean)
    );
    assert(hasExactId || hasModelVariant || product.manualMatchApproved === true, `${product.id}: falta identificador exacto o revisión manual`);
    assert(isIsoDate(product.sourceUpdatedAt), `${product.id}: sourceUpdatedAt inválido`);
  }
  return ids;
}

function validateOffers(payload, productIds, merchantData, countryCodes) {
  assert(payload.schemaVersion === 1, "offers.json: schemaVersion inválido");
  assert(Array.isArray(payload.offers), "offers.json: offers debe ser un array");
  assert(isIsoDate(payload.generatedAt), "offers.json: generatedAt inválido");
  const ids = new Set();
  for (const offer of payload.offers) {
    assert(typeof offer.id === "string" && offer.id, "Oferta sin id");
    assert(!ids.has(offer.id), `Oferta duplicada: ${offer.id}`);
    ids.add(offer.id);
    assert(productIds.has(offer.productId), `${offer.id}: productId inexistente`);
    assert(merchantData.ids.has(offer.merchantId), `${offer.id}: merchantId inexistente`);
    assert(merchantData.byId.get(offer.merchantId)?.status === "approved", `${offer.id}: merchant no aprobado`);
    assert(countryCodes.has(offer.country), `${offer.id}: country no configurado`);
    assert(Number.isFinite(offer.price) && offer.price >= 0, `${offer.id}: price inválido`);
    assert(Number.isFinite(offer.totalPrice) && offer.totalPrice >= offer.price, `${offer.id}: totalPrice inválido`);
    assert(/^[A-Z]{3}$/.test(offer.currency), `${offer.id}: currency inválida`);
    assert(/^https:\/\//.test(offer.affiliateUrl), `${offer.id}: affiliateUrl debe usar HTTPS`);
    const merchant = merchantData.byId.get(offer.merchantId);
    if (offer.source?.awinMerchantId || merchant?.awinAdvertiserId) {
      const url = new URL(offer.affiliateUrl);
      assert(/(^|\.)awin1\.com$/i.test(url.hostname), `${offer.id}: affiliateUrl no pertenece a Awin`);
      assert(["/pclick.php", "/cread.php"].includes(url.pathname), `${offer.id}: ruta de tracking Awin no reconocida`);
      assert(Boolean(url.searchParams.get("a")), `${offer.id}: falta publisher/affiliate ID de Awin`);
      assert(Boolean(url.searchParams.get("p")), `${offer.id}: falta product ID de Awin`);
      const expectedAdvertiserId = String(offer.source?.awinMerchantId || merchant?.awinAdvertiserId || "");
      assert(url.searchParams.get("m") === expectedAdvertiserId, `${offer.id}: advertiser ID de Awin no coincide`);
    }
    assert(["new", "refurbished", "used", "second_chance"].includes(offer.condition), `${offer.id}: condition inválida`);
    assert(["in_stock", "out_of_stock", "preorder", "unknown", "unavailable", "discontinued"].includes(offer.availability), `${offer.id}: availability inválida`);
    assert(isIsoDate(offer.lastUpdatedAt), `${offer.id}: lastUpdatedAt inválido`);
  }
}

const runtime = await readJson("catalog-runtime.json");
const config = await readJson("catalog-config.json");
const merchants = await readJson("merchants.json");
const taxonomy = await readJson("category-taxonomy.json");
const profiles = await readJson("awin-import-profiles.json");
const products = await readJson("products.json");
const offers = await readJson("offers.json");

validateRuntime(runtime);
const countryCodes = validateConfig(config);
assert(countryCodes.has(runtime.country), `catalog-runtime.json: país no configurado: ${runtime.country}`);
const merchantData = validateMerchants(merchants);
const categoryLabels = validateTaxonomy(taxonomy);
validateProfiles(profiles, merchantData.ids, categoryLabels);
const productIds = validateProducts(products, categoryLabels);
validateOffers(offers, productIds, merchantData, countryCodes);

console.log(
  `Catálogo válido: ${merchantData.ids.size} merchants, ${productIds.size} productos, ${offers.offers.length} ofertas y ${categoryLabels.size} categorías. Loader enabled=${runtime.enabled}.`
);
