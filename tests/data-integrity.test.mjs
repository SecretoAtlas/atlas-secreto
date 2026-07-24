import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

const [
  spain,
  spainAliExpress,
  mexico,
  colombia,
  links,
  products,
  offers,
  curated
] = await Promise.all([
  readJson("data/catalog/families.json"),
  readJson("data/catalog/aliexpress-es.json"),
  readJson("data/catalog/aliexpress-mx.json"),
  readJson("data/catalog/aliexpress-co.json"),
  readJson("data/catalog/affiliate-links.json"),
  readJson("data/catalog/products.json"),
  readJson("data/catalog/offers.json"),
  readJson("data/sources/curated-products.json")
]);

const catalogs = [spain, spainAliExpress, mexico, colombia];
const families = catalogs.flatMap((catalog) => catalog.families);
const publicOffers = families.flatMap((family) =>
  family.variants.flatMap((variant) => variant.offers)
);

test("los catálogos públicos usan el esquema definitivo", () => {
  assert.ok(catalogs.every((catalog) => catalog.schemaVersion === 3));
  assert.ok(spain.families.length > 0);
  assert.equal(
    spain.families.reduce((sum, family) => sum + family.variantCount, 0),
    products.products.length
  );
  assert.equal(
    spain.families.flatMap((family) => family.variants.flatMap((variant) => variant.offers)).length,
    offers.offers.length
  );
  assert.ok(mexico.families.length > 0);
  assert.ok(colombia.families.length > 0);
  assert.equal(spainAliExpress.families.length, 411);
});

test("familias, variantes y ofertas tienen IDs únicos", () => {
  const familyIds = families.map((family) => family.id);
  const variantIds = families.flatMap((family) => family.variants.map((variant) => `${family.id}:${variant.id}`));
  const offerIds = publicOffers.map((offer) => offer.id);
  assert.equal(new Set(familyIds).size, familyIds.length);
  assert.equal(new Set(variantIds).size, variantIds.length);
  assert.equal(new Set(offerIds).size, offerIds.length);
});

test("ningún catálogo público contiene enlaces afiliados directos o placeholders", () => {
  const serialized = JSON.stringify(catalogs);
  assert.equal(/affiliateUrl|tracking_url|placehold\.co|PON_AQUI|TU_ENLACE|Atlas Secreto/i.test(serialized), false);
  for (const family of families) {
    assert.ok(family.id && family.title && family.description && family.image);
    assert.equal(family.variantCount, family.variants.length);
    assert.ok(family.variants.length > 0);
    assert.ok(family.variants.every((variant) => variant.offers.length > 0));
  }
});

test("cada oferta publicada tiene exactamente un enlace seguro", () => {
  const referenced = new Set(publicOffers.map((offer) => offer.id));
  const linked = new Set(Object.keys(links.links));
  assert.deepEqual(linked, referenced);
  for (const [offerId, entry] of Object.entries(links.links)) {
    const url = new URL(entry.url);
    assert.equal(url.protocol, "https:", offerId);
    assert.ok(
      /(^|\.)awin1\.com$/i.test(url.hostname) ||
      /^s\.click\.aliexpress\.com$/i.test(url.hostname) ||
      /(^|\.)amazon\.es$/i.test(url.hostname),
      offerId
    );
  }
});

test("los cuatro productos curados de Colombia están publicados", () => {
  const colombiaIds = new Set(colombia.families.map((family) => family.id));
  for (const product of curated.products) {
    assert.ok(colombiaIds.has(`market-co-${product.productId}`), product.productId);
  }
});

test("todas las imágenes locales publicadas existen", async () => {
  const localImages = new Set(
    families
      .flatMap((family) => [family.image, ...family.images, ...family.variants.flatMap((variant) => variant.images)])
      .filter((image) => /^\.\/images\//.test(image))
  );
  for (const image of localImages) {
    await access(resolve(root, image.replace(/^\.\//, "")));
  }
  assert.ok(localImages.size >= 15);
});
