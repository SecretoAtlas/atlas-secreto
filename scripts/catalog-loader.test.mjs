import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog } from "./catalog-loader.js";

const now = Date.parse("2026-07-21T20:00:00Z");

const runtime = {
  schemaVersion: 1,
  enabled: true,
  country: "ES",
  allowPendingMerchants: false,
  includeStaleOffers: true
};

const config = {
  schemaVersion: 1,
  defaultCountry: "ES",
  supportedCountries: [
    { code: "ES", name: "España", currency: "EUR", enabled: true }
  ],
  freshness: {
    staleWarningHours: 36,
    removeUnavailableAfterHours: 168
  }
};

const merchants = {
  schemaVersion: 1,
  merchants: [
    { id: "approved", name: "Tienda aprobada", country: "ES", status: "approved" },
    { id: "pending", name: "Tienda pendiente", country: "ES", status: "pending" }
  ]
};

const products = {
  schemaVersion: 1,
  generatedAt: "2026-07-21T19:00:00Z",
  products: [
    {
      id: "product-1",
      title: "Producto exacto",
      brand: "Marca",
      identifiers: { ean: "1234567890123" }
    }
  ]
};

const offers = {
  schemaVersion: 1,
  generatedAt: "2026-07-21T19:00:00Z",
  offers: [
    {
      id: "approved:1",
      productId: "product-1",
      merchantId: "approved",
      country: "ES",
      currency: "EUR",
      price: 100,
      shippingCost: 5,
      availability: "in_stock",
      condition: "new",
      affiliateUrl: "https://example.com/approved",
      isCommissionable: true,
      lastUpdatedAt: "2026-07-21T19:00:00Z"
    },
    {
      id: "pending:1",
      productId: "product-1",
      merchantId: "pending",
      country: "ES",
      currency: "EUR",
      price: 90,
      availability: "in_stock",
      condition: "new",
      affiliateUrl: "https://example.com/pending",
      isCommissionable: true,
      lastUpdatedAt: "2026-07-21T19:00:00Z"
    }
  ]
};

test("solo publica merchants aprobados y calcula el precio total", () => {
  const catalog = buildCatalog({
    runtime,
    config,
    merchants,
    products,
    offers,
    now
  });

  assert.equal(catalog.stats.merchants, 1);
  assert.equal(catalog.stats.products, 1);
  assert.equal(catalog.stats.offers, 1);
  assert.equal(catalog.products[0].bestOffer.totalPrice, 105);
  assert.equal(catalog.products[0].bestOffer.merchantId, "approved");
});

test("excluye por defecto las ofertas no disponibles", () => {
  const unavailableOffers = structuredClone(offers);
  unavailableOffers.offers[0].availability = "out_of_stock";

  const catalog = buildCatalog({
    runtime,
    config,
    merchants,
    products,
    offers: unavailableOffers,
    now
  });

  assert.equal(catalog.stats.products, 0);
  assert.equal(catalog.stats.offers, 0);
});
