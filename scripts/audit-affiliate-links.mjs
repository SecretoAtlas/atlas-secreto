import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "data/catalog");
const outputPath = resolve(root, "affiliate-audit.json");

const offersPayload = JSON.parse(await readFile(resolve(root, "offers.json"), "utf8"));
const merchantsPayload = JSON.parse(await readFile(resolve(root, "merchants.json"), "utf8"));
const merchants = new Map(merchantsPayload.merchants.map((merchant) => [merchant.id, merchant]));

const findings = [];
const hosts = new Map();
const affiliateIds = new Set();
const advertiserIds = new Set();
let validAwinLinks = 0;
let invalidLinks = 0;

for (const offer of offersPayload.offers) {
  const merchant = merchants.get(offer.merchantId);
  try {
    const url = new URL(offer.affiliateUrl);
    hosts.set(url.hostname, (hosts.get(url.hostname) ?? 0) + 1);

    const sourceAdvertiserId = String(offer.source?.awinMerchantId ?? "");
    const configuredAdvertiserId = String(merchant?.awinAdvertiserId ?? "");
    const affiliateId = url.searchParams.get("a");
    const advertiserId = url.searchParams.get("m");
    const productId = url.searchParams.get("p");

    if (affiliateId) affiliateIds.add(affiliateId);
    if (advertiserId) advertiserIds.add(advertiserId);

    const isAwinHost = /(^|\.)awin1\.com$/i.test(url.hostname);
    const isAwinClickPath = ["/pclick.php", "/cread.php"].includes(url.pathname);
    const advertiserMatches = Boolean(advertiserId) && advertiserId === sourceAdvertiserId && advertiserId === configuredAdvertiserId;
    const valid = url.protocol === "https:" && isAwinHost && isAwinClickPath && Boolean(affiliateId) && Boolean(productId) && advertiserMatches;

    if (valid) {
      validAwinLinks += 1;
    } else {
      invalidLinks += 1;
      findings.push({
        offerId: offer.id,
        reason: "invalid_awin_tracking_link",
        affiliateUrl: offer.affiliateUrl,
        checks: {
          https: url.protocol === "https:",
          awinHost: isAwinHost,
          awinClickPath: isAwinClickPath,
          affiliateIdPresent: Boolean(affiliateId),
          productIdPresent: Boolean(productId),
          advertiserMatches
        }
      });
    }
  } catch {
    invalidLinks += 1;
    findings.push({
      offerId: offer.id,
      reason: "malformed_affiliate_url",
      affiliateUrl: offer.affiliateUrl
    });
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  summary: {
    totalOffers: offersPayload.offers.length,
    validAwinTrackingLinks: validAwinLinks,
    invalidAffiliateLinks: invalidLinks,
    allOffersCommissionTracked: invalidLinks === 0 && validAwinLinks === offersPayload.offers.length,
    affiliateIds: [...affiliateIds].sort(),
    advertiserIds: [...advertiserIds].sort(),
    hosts: Object.fromEntries([...hosts.entries()].sort(([a], [b]) => a.localeCompare(b)))
  },
  findings
};

await mkdir(root, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `Auditoría de afiliación: ${validAwinLinks}/${offersPayload.offers.length} enlaces Awin válidos; ${invalidLinks} incidencias.`
);

if (invalidLinks > 0) process.exitCode = 1;
