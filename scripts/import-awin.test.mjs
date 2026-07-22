import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseCsv, canonicalGtin, isValidGtin } from "./lib/awin-feed-utils.mjs";
import { importAwinFeed } from "./lib/awin-catalog-core.mjs";

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
  "last_updated",
  "display_price",
  "data_feed_id",
  "brand_name",
  "condition",
  "product_model",
  "dimensions",
  "colour",
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
    description: "<p>Descripción suficientemente extensa, con coma y datos del producto.</p>",
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
    last_updated: "2026-07-22T09:00:00Z",
    display_price: "100,50 €",
    data_feed_id: "112474",
    brand_name: "KAWOLA",
    condition: "Nuevo",
    product_model: "A",
    dimensions: "80 x 60 x 90 cm",
    colour: "Negro",
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
  const directory = await mkdtemp(resolve(tmpdir(), "secretshop-awin-"));
  const writeJson = (name, value) =>
    writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

  await Promise.all([
    writeJson("products.json", { schemaVersion: 1, generatedAt: null, products: [] }),
    writeJson("offers.json", { schemaVersion: 1, generatedAt: null, offers: [] }),
    writeJson("merchants.json", {
      schemaVersion: 1,
      merchants: [
        {
          id: "muebles-style-spain",
          name: "Muebles Style Spain",
          country: "ES",
          status: "approved",
          awinAdvertiserId: "122118"
        }
      ]
    }),
    writeJson("category-taxonomy.json", {
      schemaVersion: 1,
      categories: [
        { id: "home", label: "Hogar", parent: null, showOnHome: true, order: 1 },
        { id: "chairs", label: "Sillas y sillones", parent: "Hogar", showOnHome: false, order: 2 },
        { id: "tables", label: "Mesas y escritorios", parent: "Hogar", showOnHome: false, order: 3 }
      ],
      genericRules: []
    }),
    writeJson("awin-import-profiles.json", {
      schemaVersion: 1,
      default: {
        country: "ES",
        currency: "EUR",
        fallbackDepartment: "Hogar",
        fallbackCategory: "Hogar",
        requireExactIdentifier: true,
        excludeNonCommissionable: true
      },
      merchants: {
        "muebles-style-spain": {
          country: "ES",
          currency: "EUR",
          department: "Hogar",
          fallbackCategory: "Hogar",
          requireGlobalIdentifier: true,
          categoryRules: [
            { category: "Sillas y sillones", includeAny: ["silla", "chairs"] },
            { category: "Mesas y escritorios", includeAny: ["mesa", "tables"] }
          ]
        }
      }
    })
  ]);

  return directory;
}

async function runImport(catalogDir, feedPath, overrides = {}) {
  return importAwinFeed({
    inputPath: feedPath,
    catalogDir,
    merchantId: "muebles-style-spain",
    generatedAt: "2026-07-22T10:00:00.000Z",
    dryRun: false,
    pruneOrphans: true,
    ...overrides
  });
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

test("importa una oferta exacta, clasifica la categoría y omite una fila sin identificador global", async () => {
  const catalogDir = await createCatalog();
  const feedPath = resolve(catalogDir, "feed.csv");
  await writeFile(
    feedPath,
    `${HEADERS.join(",")}\n${csvRow()}\n${csvRow({ merchant_product_id: "SKU-2", ean: "" })}\n`,
    "utf8"
  );

  const result = await runImport(catalogDir, feedPath);

  assert.equal(result.report.totals.feedRows, 2);
  assert.equal(result.report.totals.acceptedRows, 1);
  assert.equal(result.report.skipReasons.missing_exact_identifier, 1);
  assert.equal(result.products.products.length, 1);
  assert.equal(result.offers.offers.length, 1);
  assert.equal(result.offers.offers[0].totalPrice, 105.5);
  assert.deepEqual(result.products.products[0].categories, ["Hogar", "Sillas y sillones"]);

  const written = JSON.parse(await readFile(resolve(catalogDir, "offers.json"), "utf8"));
  assert.equal(written.offers[0].affiliateUrl.includes("awin1.com"), true);
});

test("un GTIN nuevo no se fusiona por coincidencia más débil de marca, modelo y variante", async () => {
  const catalogDir = await createCatalog();
  const firstFeed = resolve(catalogDir, "first.csv");
  const secondFeed = resolve(catalogDir, "second.csv");

  await writeFile(firstFeed, `${HEADERS.join(",")}\n${csvRow()}\n`, "utf8");
  await runImport(catalogDir, firstFeed);

  await writeFile(
    secondFeed,
    `${HEADERS.join(",")}\n${csvRow({
      aw_product_id: "2",
      merchant_product_id: "SKU-2",
      ean: "5012345678900",
      product_name: "Silla distinta con el mismo modelo comercial"
    })}\n`,
    "utf8"
  );

  const result = await runImport(catalogDir, secondFeed, { pruneOrphans: false });
  assert.equal(result.products.products.length, 2);
  assert.equal(result.report.totals.productsCreated, 1);
  assert.equal(result.report.totals.productsMatched, 0);
});

test("una importación completa reemplaza solo las ofertas anteriores del merchant", async () => {
  const catalogDir = await createCatalog();
  const firstFeed = resolve(catalogDir, "first.csv");
  const secondFeed = resolve(catalogDir, "second.csv");

  await writeFile(firstFeed, `${HEADERS.join(",")}\n${csvRow()}\n`, "utf8");
  await runImport(catalogDir, firstFeed);

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

  const result = await runImport(catalogDir, secondFeed, {
    generatedAt: "2026-07-22T11:00:00.000Z"
  });

  assert.equal(result.offers.offers.length, 1);
  assert.equal(result.offers.offers[0].merchantProductId, "SKU-2");
  assert.equal(result.products.products.length, 1);
  assert.equal(result.report.totals.orphanProductsRemoved, 1);
});
