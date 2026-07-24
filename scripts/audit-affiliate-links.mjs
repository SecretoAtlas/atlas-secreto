#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAmazonAffiliateUrl } from "./lib/amazon-associates-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = resolve(root, "data/catalog");
const outputPath = resolve(catalogDir, "affiliate-audit.json");

async function readJson(name) {
  return JSON.parse(await readFile(resolve(catalogDir, name), "utf8"));
}

function publicOfferIds(payload) {
  return new Set(
    (payload.families || []).flatMap((family) =>
      (family.variants || []).flatMap((variant) =>
        (variant.offers || []).map((offer) => offer.id)
      )
    )
  );
}

function validateAwin(value, expectedAdvertiserId) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /(^|\.)awin1\.com$/i.test(url.hostname) &&
      ["/pclick.php", "/cread.php"].includes(url.pathname) &&
      Boolean(url.searchParams.get("a")) &&
      Boolean(url.searchParams.get("p")) &&
      url.searchParams.get("m") === String(expectedAdvertiserId || "")
    );
  } catch {
    return false;
  }
}

function validateAliExpress(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^s\.click\.aliexpress\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

const [offersPayload, merchantsPayload, linksPayload, families, spainAliExpress, mexico, colombia] = await Promise.all([
  readJson("offers.json"),
  readJson("merchants.json"),
  readJson("affiliate-links.json"),
  readJson("families.json"),
  readJson("aliexpress-es.json"),
  readJson("aliexpress-mx.json"),
  readJson("aliexpress-co.json")
]);

const merchants = new Map(
  merchantsPayload.merchants.map((merchant) => [merchant.id, merchant])
);
const findings = [];
const canonicalCounts = { awin: 0, amazon: 0 };
const validCanonicalCounts = { awin: 0, amazon: 0 };

for (const offer of offersPayload.offers) {
  const merchant = merchants.get(offer.merchantId);
  const network = merchant?.network || (offer.source?.awinMerchantId || merchant?.awinAdvertiserId ? "awin" : null);
  if (network === "awin") {
    canonicalCounts.awin += 1;
    const expectedAdvertiserId = offer.source?.awinMerchantId || merchant?.awinAdvertiserId;
    if (validateAwin(offer.affiliateUrl, expectedAdvertiserId)) validCanonicalCounts.awin += 1;
    else findings.push({ offerId: offer.id, reason: "invalid_canonical_awin_link" });
  } else if (network === "amazon-associates") {
    canonicalCounts.amazon += 1;
    if (validateAmazonAffiliateUrl(offer.affiliateUrl, merchant?.associateTag)) validCanonicalCounts.amazon += 1;
    else findings.push({ offerId: offer.id, reason: "invalid_canonical_amazon_link" });
  } else {
    findings.push({ offerId: offer.id, reason: "unknown_canonical_network" });
  }
}

const publishedIds = new Set([
  ...publicOfferIds(families),
  ...publicOfferIds(spainAliExpress),
  ...publicOfferIds(mexico),
  ...publicOfferIds(colombia)
]);
const linkEntries = Object.entries(linksPayload.links || {});

for (const offerId of publishedIds) {
  if (!linksPayload.links?.[offerId]) {
    findings.push({ offerId, reason: "published_offer_without_link" });
  }
}

for (const [offerId, entry] of linkEntries) {
  if (!publishedIds.has(offerId)) {
    findings.push({ offerId, reason: "orphan_public_link" });
    continue;
  }
  const merchant = merchants.get(entry.merchantId);
  const valid = merchant?.network === "amazon-associates"
    ? Boolean(validateAmazonAffiliateUrl(entry.url, merchant.associateTag))
    : validateAwin(entry.url, merchant?.awinAdvertiserId) || validateAliExpress(entry.url);
  if (!valid) findings.push({ offerId, reason: "invalid_public_destination" });
}

const hostCount = (hostnamePattern) => linkEntries.filter(([, entry]) => {
  try {
    return hostnamePattern.test(new URL(entry.url).hostname);
  } catch {
    return false;
  }
}).length;

const report = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  summary: {
    canonicalOffers: offersPayload.offers.length,
    canonicalByNetwork: canonicalCounts,
    validCanonicalByNetwork: validCanonicalCounts,
    publishedOffers: publishedIds.size,
    publishedLinks: linkEntries.length,
    awinPublishedLinks: hostCount(/(^|\.)awin1\.com$/i),
    aliexpressPublishedLinks: hostCount(/^s\.click\.aliexpress\.com$/i),
    amazonPublishedLinks: hostCount(/(^|\.)amazon\.es$/i),
    findings: findings.length,
    allPublishedOffersTracked:
      findings.length === 0 &&
      publishedIds.size === linkEntries.length
  },
  findings
};

const temporary = `${outputPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await rename(temporary, outputPath);

console.log(
  `Auditoría de afiliación: ${report.summary.publishedLinks}/${report.summary.publishedOffers} ofertas publicadas con enlace válido; ${findings.length} incidencias.`
);

if (findings.length > 0) process.exitCode = 1;
