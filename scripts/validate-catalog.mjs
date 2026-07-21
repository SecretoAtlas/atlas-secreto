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

function validateMerchants(payload) {
  assert(payload.schemaVersion === 1, "merchants.json: schemaVersion inválido");
  assert(Array.isArray(payload.merchants), "merchants.json: merchants debe ser un array");
  const ids = new Set();
  for (const merchant of payload.merchants) {
    assert(typeof merchant.id === "string" && merchant.id, "Merchant sin id");
    assert(!ids.has(merchant.id), `Merchant duplicado: ${merchant.id}`);
    ids.add(merchant.id);
    assert(typeof merchant.name === "string" && merchant.name, `${merchant.id}: name obligatorio`);
    assert(/^[A-Z]{2}$/.test(merchant.country), `${merchant.id}: country inválido`);
    assert(["pending", "approved", "rejected", "paused"].includes(merchant.status), `${merchant.id}: status inválido`);
  }
  return ids;
}

function validateProducts(payload) {
  assert(payload.schemaVersion === 1, "products.json: schemaVersion inválido");
  assert(Array.isArray(payload.products), "products.json: products debe ser un array");
  const ids = new Set();
  for (const product of payload.products) {
    assert(typeof product.id === "string" && product.id, "Producto sin id");
    assert(!ids.has(product.id), `Producto duplicado: ${product.id}`);
    ids.add(product.id);
    assert(typeof product.title === "string" && product.title, `${product.id}: title obligatorio`);
    assert(typeof product.brand === "string" && product.brand, `${product.id}: brand obligatorio`);
    const identifiers = product.identifiers ?? {};
    const hasGlobalId = [identifiers.gtin, identifiers.ean, identifiers.upc, identifiers.mpn].some(Boolean);
    assert(hasGlobalId || product.manualMatchApproved === true, `${product.id}: falta identificador global o revisión manual`);
  }
  return ids;
}

function validateOffers(payload, productIds, merchantIds) {
  assert(payload.schemaVersion === 1, "offers.json: schemaVersion inválido");
  assert(Array.isArray(payload.offers), "offers.json: offers debe ser un array");
  const ids = new Set();
  for (const offer of payload.offers) {
    assert(typeof offer.id === "string" && offer.id, "Oferta sin id");
    assert(!ids.has(offer.id), `Oferta duplicada: ${offer.id}`);
    ids.add(offer.id);
    assert(productIds.has(offer.productId), `${offer.id}: productId inexistente`);
    assert(merchantIds.has(offer.merchantId), `${offer.id}: merchantId inexistente`);
    assert(Number.isFinite(offer.price) && offer.price >= 0, `${offer.id}: price inválido`);
    assert(/^[A-Z]{3}$/.test(offer.currency), `${offer.id}: currency inválida`);
    assert(/^https:\/\//.test(offer.affiliateUrl), `${offer.id}: affiliateUrl debe usar HTTPS`);
    assert(["new", "refurbished", "used", "second_chance"].includes(offer.condition), `${offer.id}: condition inválida`);
  }
}

const merchants = await readJson("merchants.json");
const products = await readJson("products.json");
const offers = await readJson("offers.json");

const merchantIds = validateMerchants(merchants);
const productIds = validateProducts(products);
validateOffers(offers, productIds, merchantIds);

console.log(`Catálogo válido: ${merchantIds.size} merchants, ${productIds.size} productos y ${offers.offers.length} ofertas.`);
