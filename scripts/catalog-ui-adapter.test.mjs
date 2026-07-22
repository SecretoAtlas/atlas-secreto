import test from "node:test";
import assert from "node:assert/strict";
import { adaptAwinCatalogToSecretShop } from "./catalog-ui-adapter.js";

const catalog = {
  enabled: true,
  country: "ES",
  currency: "EUR",
  generatedAt: "2026-07-22T10:00:00Z",
  products: [
    {
      id: "gtin-04006381333931",
      title: "Silla de prueba",
      brand: "KAWOLA",
      department: "Hogar",
      category: "Sillas y sillones",
      categories: ["Hogar", "Sillas y sillones"],
      description: "Descripción completa y válida de la silla de prueba.",
      images: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      sourceUpdatedAt: "2026-07-22T09:00:00Z",
      attributes: { merchantCategory: "Muebles > Sillas" },
      offers: [
        {
          merchantName: "Muebles Style Spain",
          merchantId: "muebles-style-spain",
          merchantProductId: "SKU-1",
          country: "ES",
          currency: "EUR",
          price: 8,
          shippingCost: 0,
          totalPrice: 8,
          availability: "in_stock",
          affiliateUrl: "https://awin.example/product",
          condition: "new",
          lastUpdatedAt: "2026-07-22T09:00:00Z"
        }
      ]
    }
  ]
};

test("adapta el catálogo Awin al formato visual de SecretShop", () => {
  const products = adaptAwinCatalogToSecretShop(catalog);
  assert.equal(products.length, 1);
  assert.equal(products[0].name, "Silla de prueba");
  assert.deepEqual(products[0].categories, ["Hogar", "Sillas y sillones", "Menos de 10"]);
  assert.equal(products[0].offers[0].store, "Muebles Style Spain");
  assert.equal(products[0].offers[0].totalAmount, 8);
  assert.equal(products[0].offers[0].url, "https://awin.example/product");
});

test("descarta ofertas no disponibles", () => {
  const unavailable = structuredClone(catalog);
  unavailable.products[0].offers[0].availability = "out_of_stock";
  assert.equal(adaptAwinCatalogToSecretShop(unavailable).length, 0);
});
