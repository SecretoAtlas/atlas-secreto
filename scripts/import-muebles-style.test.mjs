import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseCsv, canonicalGtin, isValidGtin } from "./lib/awin-feed-utils.mjs";
import { importMueblesStyle } from "./import-muebles-style.mjs";

const HEADERS = [
  "aw_deep_link",
  "product_name",
  "aw_product_id",
  "merchant_product_id",
  "merchant_image_url",
  "description",
  "merchant_category",
  "search_price",
  "merchant_name",
  "merchant_id",
  "category_name",
  "category_id",
  "aw_image_url",
  "currency",
  "store_price",
  "delivery_cost",
  "merchant_deep_link",
  "language",
  "last_updated",
  "display_price",
  "data_feed_id",
  "brand_name",
  "condition",
  "product_model",
  "ean",
  "upc",
  "mpn",
  "product_GTIN",
  "in_stock",
  "stock_quantity",
  "is_for_sale",
  "pre_order",
  "stock_status",
  "large_image"
];

function csvRow(overrides = {}) {
  const base = {
    aw_deep_link: "https://www.awin1.com/pclick.php?p=1&a=2996453&m=122118",
    product_name: "Silla de prueba, modelo A",
    aw_product_id: "1",
    merchant_product_id: "SKU-1",
    merchant_image_url: "https://example.com/image.jpg",
    description: "<p>Descripción con, coma</p>",
    merchant_category: "Muebles > Sillas > Sillas de comedor",
    search_price: "100.50",
    merchant_name: "Muebles Style Spain",
    merchant_id: "122118",
    category_name: "Chairs",
    category_id: "448",
    aw_image_url: "https://example.com/image.jpg",
    currency: "EUR",
    store_price: "",
    delivery_cost: "5.00",
    merchant_deep_link: "https://example.com/product",
    language: "ES",
    last_updated: "",
    display_price: "100,50 €",
    data_feed_id: "112474",
    brand_name: "KAWOLA",
    condition: "Nuevo",
    product_model: "A",
    ean: "4006381333931",
    upc: "",
    mpn: "",
    product_GTIN: "",
    in_stock: "1",
    stock_quantity: "2",
    is_for_sale: "1",
    pre_order: "0",
    stock_status: "",
    large_image: "https://example.com/large.jpg",
    ...overrides
  };

  return HEADERS.map((header) => {
    const value = String(base[header] ?? "");
    return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(",");
}

async function createCatalog() {
  const directory = await mkdtemp(resolve(tmpdir(), "secretshop-muebles-"));
  await writeFile(
    resolve(directory, "products.json"),
    JSON.stringify({ schemaVersion: 1, generatedAt: null, products: [] }),
    "utf8"
  );
  await writeFile(
    resolve(directory, "offers.json"),
    JSON.stringify({ schemaVersion: 1, generatedAt: null, offers: [] }),
    "utf8"
  );
  await writeFile(
    resolve(directory, "merchants.json"),
    JSON.stringify({
      schemaVersion: 1,
      merchants: [
        {
          id: "muebles-style-spain",
          name: "Muebles Style Spain",
          country: "ES",
          status: "approved"
        }
      ]
    }),
    "utf8"
  );
  return directory;
}

test("parseCsv conserva comas, comillas y saltos de línea entrecomillados", () => {
  const parsed = parseCsv('a,b\n"uno, dos","línea 1\nlínea 2"\n');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].a, "uno, dos");
  assert.equal(parsed.records[0].b, "línea 1\nlínea 2");
});

test("valida y normaliza GTIN", () => {
  assert.equal(isValidGtin("4006381333931"), true);
  assert.equal(canonicalGtin("4006381333931"), "04006381333931");
  assert.equal(isValidGtin("4006381333932"), false);
});

test("importa una oferta exacta y omite una fila sin identificador", async () => {
  const catalogDir = await createCatalog();
  const feedPath = resolve(catalogDir, "feed.csv");
  await writeFile(
    feedPath,
    `${HEADERS.join(",")}\n${csvRow()}\n${csvRow({ merchant_product_id: "SKU-2", ean: "" })}\n`,
    "utf8"
  );

  const result = await importMueblesStyle({
    inputPath: feedPath,
    catalogDir,
    generatedAt: "2026-07-22T10:00:00.000Z",
    dryRun: false,
    pruneOrphans: true
  });

  assert.equal(result.report.totals.feedRows, 2);
  assert.equal(result.report.totals.acceptedRows, 1);
  assert.equal(result.report.skipReasons.missing_exact_identifier, 1);
  assert.equal(result.products.products.length, 1);
  assert.equal(result.offers.offers.length, 1);
  assert.equal(result.offers.offers[0].totalPrice, 105.5);
  assert.equal(result.products.products[0].category, "sillas-y-sillones");

  const written = JSON.parse(await readFile(resolve(catalogDir, "offers.json"), "utf8"));
  assert.equal(written.offers[0].affiliateUrl.includes("awin1.com"), true);
});

test("una importación completa reemplaza las ofertas anteriores del merchant", async () => {
  const catalogDir = await createCatalog();
  const firstFeed = resolve(catalogDir, "first.csv");
  const secondFeed = resolve(catalogDir, "second.csv");

  await writeFile(firstFeed, `${HEADERS.join(",")}\n${csvRow()}\n`, "utf8");
  await importMueblesStyle({
    inputPath: firstFeed,
    catalogDir,
    generatedAt: "2026-07-22T10:00:00.000Z",
    dryRun: false,
    pruneOrphans: true
  });

  await writeFile(
    secondFeed,
    `${HEADERS.join(",")}\n${csvRow({
      aw_product_id: "2",
      merchant_product_id: "SKU-2",
      ean: "5012345678900",
      product_name: "Mesa nueva",
      merchant_category: "Muebles > Mesas > Mesas de comedor",
      category_name: "Tables"
    })}\n`,
    "utf8"
  );

  const result = await importMueblesStyle({
    inputPath: secondFeed,
    catalogDir,
    generatedAt: "2026-07-22T11:00:00.000Z",
    dryRun: false,
    pruneOrphans: true
  });

  assert.equal(result.offers.offers.length, 1);
  assert.equal(result.offers.offers[0].merchantProductId, "SKU-2");
  assert.equal(result.products.products.length, 1);
  assert.equal(result.report.totals.orphanProductsRemoved, 1);
});
