import { loadSecretShopCatalog } from "./catalog-loader.js";
import { adaptAwinCatalogToSecretShop } from "./catalog-ui-adapter.js";

const RUNTIME_URL = "./data/catalog/catalog-runtime.json";

function dispatchCatalogEvent(prefix, suffix, detail) {
  document.dispatchEvent(
    new CustomEvent(`${prefix}-${suffix}`, { detail })
  );
}

export async function bootSecretShopAwinCatalog(options = {}) {
  const baseUrl = options.baseUrl || document.baseURI;

  try {
    const catalog = await loadSecretShopCatalog({
      baseUrl,
      runtimeUrl: options.runtimeUrl || RUNTIME_URL,
      country: options.country,
      force: options.force
    });

    const prefix = catalog.runtime?.eventPrefix || "secretshop:awin-catalog";
    const uiProducts = adaptAwinCatalogToSecretShop(catalog);
    const publishedCatalog = { ...catalog, uiProducts };

    if (catalog.runtime?.publishToWindow !== false) {
      window.SecretShopAwinCatalog = publishedCatalog;
      window.CATALOG_AWIN = uiProducts;
    }

    dispatchCatalogEvent(
      prefix,
      catalog.enabled ? "ready" : "disabled",
      publishedCatalog
    );

    if (catalog.runtime?.debug === true) {
      console.info("[SecretShop] Catálogo Awin", publishedCatalog);
    }

    return publishedCatalog;
  } catch (error) {
    const detail = {
      status: "error",
      enabled: false,
      message: error instanceof Error ? error.message : String(error),
      error,
      uiProducts: []
    };

    window.SecretShopAwinCatalog = detail;
    window.CATALOG_AWIN = [];
    dispatchCatalogEvent("secretshop:awin-catalog", "error", detail);
    console.error("[SecretShop] Error cargando el catálogo Awin", error);
    return detail;
  }
}

async function shouldAutoStart() {
  try {
    const response = await fetch(new URL(RUNTIME_URL, document.baseURI), {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return false;
    const runtime = await response.json();
    return runtime.autoStart !== false;
  } catch {
    return false;
  }
}

if (await shouldAutoStart()) {
  await bootSecretShopAwinCatalog();
}
