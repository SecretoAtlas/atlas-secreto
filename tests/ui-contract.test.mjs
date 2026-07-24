import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [html, css, app] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "assets/css/app.css"), "utf8"),
  readFile(resolve(root, "assets/js/app.js"), "utf8")
]);

test("conserva la dirección visual y el texto aprobados", () => {
  assert.ok(html.includes("Compara antes de comprar. <span>Decide mejor.</span>"));
  assert.ok(html.includes("Busca productos, marcas o categorías"));
  assert.ok(html.includes("Podemos recibir una comisión por algunas compras, sin coste adicional para ti."));
  assert.ok(css.includes("--primary: #0b6d75"));
  assert.ok(css.includes("--sand: #efe2c8"));
});

test("incluye la estructura funcional definitiva", () => {
  for (const marker of [
    "data-search-input",
    "data-category-grid",
    "data-deals-carousel",
    "data-catalog-grid",
    "data-compare-tray",
    "product-dialog",
    "saved-dialog",
    "filters-dialog",
    "score-dialog"
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.ok(app.includes("secretshop:favorites:v1"));
  assert.ok(app.includes("secretshop:recent:v1"));
  assert.ok(app.includes("secretshop:searches:v1"));
  assert.ok(app.includes("const MAX_COMPARE = 4"));
  assert.ok(app.includes("./data/catalog/aliexpress-es.json"));
});

test("incluye modo oscuro, foco, reducción de movimiento y diseño adaptable", () => {
  assert.ok(css.includes(':root[data-theme="dark"]'));
  assert.ok(css.includes("--action-bg: #0b6d75"));
  assert.ok(css.includes(":focus-visible"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(css.includes("@media (max-width: 560px)"));
  assert.ok(css.includes(".comparison-cards"));
  assert.ok(app.includes('class="comparison-cards"'));
  assert.equal(css.includes("fonts.googleapis.com"), false);
});

test("no conserva la aplicación antigua ni menciones públicas indebidas", () => {
  for (const value of [
    "SecretShop V2.0",
    "styles-v2.css",
    "secretshop-v2.js",
    "catalog-base.js",
    "catalog-aliexpress-mx.js",
    "catalog-aliexpress-co.js",
    "Atlas Secreto",
    "Awin"
  ]) {
    assert.equal(html.includes(value), false, value);
  }
});

test("todos los diálogos tienen nombre accesible", () => {
  const dialogs = [...html.matchAll(/<dialog\b([^>]*)>/g)].map((match) => match[1]);
  assert.ok(dialogs.length >= 5);
  assert.ok(dialogs.every((attributes) => /aria-(?:label|labelledby)=/.test(attributes)));
});
