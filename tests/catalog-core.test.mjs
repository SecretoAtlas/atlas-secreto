import test from "node:test";
import assert from "node:assert/strict";
import {
  bestOffer,
  categoryGroup,
  discountPercent,
  displayOfferPrice,
  filterAndSortFamilies,
  getSuggestions,
  isRealImage,
  mergeCatalogPayloads,
  normalizeText,
  offerTotal,
  smartSearchScore
} from "../assets/js/catalog-core.js";

const payload = {
  schemaVersion: 3,
  generatedAt: "2026-07-23T10:00:00Z",
  families: [
    {
      id: "phone",
      title: "Teléfono móvil Nova 256 GB",
      brand: "Nova",
      category: "Tecnología",
      categories: ["Tecnología"],
      description: "Teléfono inteligente con almacenamiento de 256 GB y varias opciones disponibles.",
      image: "https://example.com/phone.jpg",
      images: ["https://example.com/phone.jpg"],
      secretScore: 9.1,
      variants: [
        {
          id: "phone-black",
          label: "Negro · 256 GB",
          images: ["https://example.com/phone.jpg"],
          offers: [
            {
              id: "shop-a:phone",
              merchantName: "Tienda A",
              country: "ES",
              currency: "EUR",
              price: 420,
              previousPrice: 500,
              shippingCost: 0,
              totalPrice: 420,
              availability: "in_stock"
            },
            {
              id: "shop-b:phone",
              merchantName: "Tienda B",
              country: "ES",
              currency: "EUR",
              price: 430,
              shippingCost: 10,
              totalPrice: 440,
              availability: "in_stock"
            }
          ]
        }
      ]
    },
    {
      id: "sofa",
      title: "Sofá modular Siena",
      brand: "Casa",
      category: "Sofás",
      categories: ["Hogar", "Sofás"],
      description: "Sofá modular disponible con orientación izquierda o derecha y distintos tejidos.",
      image: "https://example.com/sofa.jpg",
      images: ["https://example.com/sofa.jpg"],
      variants: [
        {
          id: "sofa-left",
          label: "Izquierda · Beige",
          images: ["https://example.com/sofa.jpg"],
          offers: [
            {
              id: "shop-a:sofa",
              merchantName: "Tienda A",
              country: "ES",
              currency: "EUR",
              price: 900,
              shippingCost: 0,
              availability: "in_stock"
            }
          ]
        },
        {
          id: "sofa-right",
          label: "Derecha · Gris",
          images: ["https://example.com/sofa.jpg"],
          offers: [
            {
              id: "shop-a:sofa-right",
              merchantName: "Tienda A",
              country: "ES",
              currency: "EUR",
              price: 950,
              shippingCost: 0,
              availability: "in_stock"
            }
          ]
        }
      ]
    }
  ]
};

const { families, warnings } = mergeCatalogPayloads([
  { id: "fixture", payload }
]);

test("normaliza tildes y grupos de categoría", () => {
  assert.equal(normalizeText("Tecnología y Sofás"), "tecnologia y sofas");
  assert.equal(categoryGroup("Sillas y sillones").name, "Hogar");
});

test("conserva la jerarquía familia → variante → oferta", () => {
  assert.equal(warnings.length, 0);
  assert.equal(families.length, 2);
  assert.equal(families[0].offers.length + families[1].offers.length, 4);
  assert.ok(families.every((family) => family.variants.every((variant) => variant.offers.length > 0)));
});

test("la búsqueda inteligente entiende sinónimos y pequeños errores", () => {
  const phone = families.find((family) => family.id === "phone");
  assert.ok(smartSearchScore(phone, "celular") >= 0);
  assert.ok(smartSearchScore(phone, "telefono movl") >= 0);
  assert.equal(smartSearchScore(phone, "sofá modular"), -1);
});

test("filtra por categoría, mercado, tienda y variantes", () => {
  assert.deepEqual(
    filterAndSortFamilies(families, { category: "Hogar" }).map((family) => family.id),
    ["sofa"]
  );
  assert.equal(filterAndSortFamilies(families, { country: "CO" }).length, 0);
  assert.equal(filterAndSortFamilies(families, { store: "Tienda B" }).length, 1);
  assert.equal(filterAndSortFamilies(families, { multipleVariants: true }).length, 1);
});

test("ordena precios y calcula descuentos sobre la mejor oferta", () => {
  const phone = families.find((family) => family.id === "phone");
  assert.equal(bestOffer(phone).id, "shop-a:phone");
  assert.equal(discountPercent(bestOffer(phone)), 16);
  assert.equal(
    filterAndSortFamilies(families, { sort: "price-asc" })[0].id,
    "phone"
  );
});

test("no convierte precios ausentes en 0,00 €", () => {
  const offer = {
    country: "ES",
    currency: "EUR",
    price: null,
    shippingCost: null,
    totalPrice: null,
    displayPrice: "Consultar precio en Amazon"
  };

  assert.equal(offerTotal(offer), null);
  assert.equal(displayOfferPrice(offer), "Consultar precio en Amazon");
  assert.equal(offerTotal({ price: "", totalPrice: "" }), null);
});

test("permite solo la ficha provisional oficial de Amazon", () => {
  assert.equal(
    isRealImage("https://secretshops.github.io/assets/brand/amazon-placeholder.svg"),
    true
  );
  assert.equal(isRealImage("https://example.com/placeholder.svg"), false);
  assert.equal(isRealImage("https://placehold.co/900x900"), false);
  assert.equal(isRealImage("https://example.com/no-image.jpg"), false);
});

test("genera sugerencias de producto y categoría", () => {
  const productSuggestions = getSuggestions(families, "Nova");
  assert.ok(productSuggestions.some((item) => item.type === "product" && item.value === "phone"));
  const categorySuggestions = getSuggestions(families, "Hogar");
  assert.ok(categorySuggestions.some((item) => item.type === "category"));
});
