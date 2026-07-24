#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const definitions = [
  {
    code: "ES",
    source: "data/aliexpress-es-source.json",
    cache: "data/aliexpress-es-metadata-cache.json",
    output: "data/catalog/aliexpress-es.json"
  },
  {
    code: "MX",
    source: "data/aliexpress-mx-source.json",
    cache: "data/aliexpress-mx-metadata-cache.json",
    output: "data/catalog/aliexpress-mx.json"
  },
  {
    code: "CO",
    source: "data/aliexpress-co-source.json",
    cache: "data/aliexpress-co-metadata-cache.json",
    output: "data/catalog/aliexpress-co.json"
  }
];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function publicCopy(value) {
  return clean(value).replace(/Atlas Secreto/gi, "SecretShop");
}

function normalize(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 90);
}

function validTitle(value) {
  const title = clean(value);
  if (title.length < 8) return false;
  return !/(access denied|page not found|shopping online|^aliexpress(?:\.com)?$)/i.test(title);
}

function validDescription(value) {
  const description = clean(value);
  return description.length >= 20 &&
    !/(access denied|page not found|enable javascript)/i.test(description);
}

function realImage(value) {
  const image = clean(value);
  return /^(?:https:\/\/|\.{0,2}\/?images\/)/i.test(image) &&
    !/(placehold\.co|placeholder|no[-_ ]?image)/i.test(image);
}

function uniqueStrings(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function writeJsonAtomic(relativePath, value) {
  const path = resolve(root, relativePath);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporary, path);
}

function publicFamily(record, metadata, curated, code, generatedAt) {
  const productId = clean(record.product_id || curated?.productId);
  const titleCandidate = curated?.title || metadata?.title || record.fallback_name;
  const title = validTitle(titleCandidate) ? clean(titleCandidate) : "";
  const imageCandidate =
    curated?.images?.[0] ||
    metadata?.image ||
    record.fallback_image;
  const image = realImage(imageCandidate) ? clean(imageCandidate) : "";
  const descriptionCandidate =
    curated?.description ||
    metadata?.description ||
    record.fallback_description;
  const description = validDescription(descriptionCandidate)
    ? publicCopy(descriptionCandidate)
    : "";
  const affiliateUrl = clean(curated?.affiliateUrl || record.tracking_url);

  if (
    !productId ||
    !title ||
    !image ||
    !description ||
    !/^https:\/\/s\.click\.aliexpress\.com\//i.test(affiliateUrl)
  ) {
    return null;
  }

  const categories = uniqueStrings([
    ...(curated?.categories || []),
    ...(record.categories || [])
  ]);
  const images = uniqueStrings([
    ...(curated?.images || []),
    image
  ]).filter(realImage);
  const displayPrice = clean(record.priceSnapshot || record.price);
  const offerId = `aliexpress-${code.toLowerCase()}:${productId}`;
  const metadataComplete = validTitle(metadata?.title) && realImage(metadata?.image);
  const secretScore = Math.min(
    9.2,
    6.4 +
    (metadataComplete ? 0.8 : 0.35) +
    (description.length >= 100 ? 0.45 : 0.2) +
    Math.min(0.8, images.length * 0.16) +
    (displayPrice && displayPrice !== "Ver precio actual" ? 0.35 : 0) +
    (curated ? 0.35 : 0)
  );

  const variant = {
    id: `aliexpress-${productId}`,
    title,
    label: "Modelo disponible",
    color: null,
    size: null,
    orientation: null,
    dimensions: null,
    material: null,
    capacity: null,
    configuration: null,
    images,
    offers: [
      {
        id: offerId,
        merchantId: "aliexpress",
        merchantName: "AliExpress",
        country: code,
        currency: null,
        price: null,
        previousPrice: null,
        shippingCost: null,
        totalPrice: null,
        displayPrice: displayPrice || "Consultar precio",
        availability: "unknown",
        condition: "new",
        deliveryTime: null,
        updatedAt: metadata?._updated_at || generatedAt
      }
    ]
  };

  return {
    id: `market-${code.toLowerCase()}-${productId}`,
    slug: slug(title),
    title,
    brand: clean(curated?.brand || "Selección"),
    model: null,
    category: categories.find((category) => category !== "Menos de 10") || categories[0] || "Otros",
    categories,
    description,
    image,
    images,
    minPrice: null,
    maxPrice: null,
    variantCount: 1,
    secretScore: Number(secretScore.toFixed(1)),
    source: "marketplace",
    createdAt: record.createdAt || generatedAt,
    variants: [variant]
  };
}

async function buildDefinition(definition, curatedProducts) {
  const source = await readJson(definition.source);
  const cache = await readJson(definition.cache);
  const generatedAt = new Date().toISOString();
  const records = new Map(source.map((record) => [clean(record.product_id), record]));
  const curatedForCountry = curatedProducts.filter(
    (product) => product.country === definition.code
  );

  for (const product of curatedForCountry) {
    if (!records.has(product.productId)) {
      records.set(product.productId, {
        product_id: product.productId,
        fallback_name: product.title,
        fallback_description: product.description,
        fallback_image: product.images?.[0],
        categories: product.categories,
        tracking_url: product.affiliateUrl,
        createdAt: generatedAt
      });
    }
  }

  const curatedById = new Map(
    curatedForCountry.map((product) => [product.productId, product])
  );
  const families = [];
  const rejected = [];

  for (const [productId, record] of records) {
    const family = publicFamily(
      record,
      cache[productId],
      curatedById.get(productId),
      definition.code,
      generatedAt
    );
    if (family) families.push(family);
    else rejected.push(productId);
  }

  families.sort((left, right) =>
    left.title.localeCompare(right.title, "es", { sensitivity: "base" })
  );
  await writeJsonAtomic(definition.output, {
    schemaVersion: 3,
    generatedAt,
    country: definition.code,
    families
  });

  return {
    country: definition.code,
    sourceProducts: source.length,
    curatedProducts: curatedForCountry.length,
    publishedFamilies: families.length,
    rejectedProducts: rejected.length,
    rejectedIds: rejected
  };
}

const curatedPayload = await readJson("data/sources/curated-products.json");
const reports = [];
for (const definition of definitions) {
  reports.push(
    await buildDefinition(definition, curatedPayload.products || [])
  );
}

await writeJsonAtomic("data/catalog/marketplace-build-report.json", {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  reports
});

console.log(JSON.stringify({ marketplaceCatalogs: reports }, null, 2));
