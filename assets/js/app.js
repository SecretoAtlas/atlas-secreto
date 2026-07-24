import {
  asArray,
  bestOffer,
  categoryGuide,
  categoryStats,
  countryLabel,
  discountPercent,
  displayOfferPrice,
  escapeHtml,
  filterAndSortFamilies,
  filterOptions,
  formatMoney,
  getSuggestions,
  mergeCatalogPayloads,
  offerTotal,
  relatedFamilies,
  selectDiverseFamilies,
  topDeals,
  topScored,
  uniqueStrings
} from "./catalog-core.js";

const DATA_SOURCES = [
  {
    id: "catalog-es",
    url: "./data/catalog/families.json",
    country: "ES",
    currency: "EUR",
    merchantId: "muebles-style-spain",
    merchantName: "Muebles Style"
  },
  {
    id: "catalog-aliexpress-es",
    url: "./data/catalog/aliexpress-es.json",
    country: "ES",
    merchantId: "aliexpress",
    merchantName: "AliExpress"
  },
  {
    id: "catalog-mx",
    url: "./data/catalog/aliexpress-mx.json",
    country: "MX",
    merchantId: "aliexpress",
    merchantName: "AliExpress"
  },
  {
    id: "catalog-co",
    url: "./data/catalog/aliexpress-co.json",
    country: "CO",
    merchantId: "aliexpress",
    merchantName: "AliExpress"
  }
];

const STORAGE_KEYS = {
  favorites: "secretshop:favorites:v1",
  recent: "secretshop:recent:v1",
  searches: "secretshop:searches:v1",
  compare: "secretshop:compare:v1",
  theme: "secretshop:theme:v1"
};

const PAGE_SIZE = 24;
const MAX_COMPARE = 4;
const formatter = new Intl.NumberFormat("es-ES");

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function readStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeStoredArray(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // La web sigue funcionando aunque el navegador bloquee el almacenamiento.
  }
}

function initialState() {
  const params = new URLSearchParams(location.search);
  return {
    query: String(params.get("q") || "").slice(0, 120),
    category: params.get("categoria") || "all",
    country: params.get("pais") || "all",
    store: params.get("tienda") || "all",
    sort: params.get("orden") || "relevance",
    minimumPrice: null,
    maximumPrice: null,
    discountOnly: false,
    multipleVariants: false,
    visible: PAGE_SIZE,
    favorites: new Set(readStoredArray(STORAGE_KEYS.favorites)),
    recent: readStoredArray(STORAGE_KEYS.recent),
    searches: readStoredArray(STORAGE_KEYS.searches),
    compare: readStoredArray(STORAGE_KEYS.compare).slice(0, MAX_COMPARE),
    savedTab: "favorites",
    selectedFamilyId: null,
    selectedVariantId: null,
    selectedImage: null,
    suggestionIndex: -1,
    suggestions: []
  };
}

const state = initialState();
let families = [];
let familyById = new Map();
let catalogWarnings = [];
let inputTimer = null;

function currentFilters(overrides = {}) {
  return {
    query: state.query,
    category: state.category,
    country: state.country,
    store: state.store,
    sort: state.sort,
    minimumPrice: state.minimumPrice,
    maximumPrice: state.maximumPrice,
    discountOnly: state.discountOnly,
    multipleVariants: state.multipleVariants,
    ...overrides
  };
}

function dispatchAnalytics(name, detail = {}) {
  const payload = {
    event: `secretshop_${name}`,
    ...detail
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
  document.dispatchEvent(new CustomEvent("secretshop:analytics", { detail: payload }));
}

function showToast(message) {
  const region = $("[data-toast-region]");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  document.body.classList.add("modal-open");
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  if (!$$("dialog[open]").some((item) => item !== dialog)) {
    document.body.classList.remove("modal-open");
  }
}

function syncBodyModalState() {
  document.body.classList.toggle("modal-open", $$("dialog[open]").length > 0);
}

async function fetchCatalogSource(source) {
  const response = await fetch(source.url, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${source.id}: respuesta ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.families)) {
    throw new Error(`${source.id}: catálogo sin familias`);
  }
  return { ...source, payload };
}

async function loadCatalog() {
  const settled = await Promise.allSettled(DATA_SOURCES.map(fetchCatalogSource));
  const loaded = [];
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") loaded.push(result.value);
    else failed.push(`${DATA_SOURCES[index].id}: ${result.reason?.message || "error"}`);
  });

  const merged = mergeCatalogPayloads(loaded);
  families = merged.families;
  familyById = new Map(families.map((family) => [family.id, family]));
  catalogWarnings = [...merged.warnings, ...failed];

  state.favorites = new Set(
    [...state.favorites].filter((id) => familyById.has(id))
  );
  state.recent = state.recent.filter((id) => familyById.has(id)).slice(0, 16);
  state.compare = state.compare.filter((id) => familyById.has(id)).slice(0, MAX_COMPARE);
  persistPersonalState();

  if (families.length === 0) {
    throw new Error("No se pudo cargar ninguna familia válida");
  }

  return merged.stats;
}

function persistPersonalState() {
  writeStoredArray(STORAGE_KEYS.favorites, [...state.favorites]);
  writeStoredArray(STORAGE_KEYS.recent, state.recent);
  writeStoredArray(STORAGE_KEYS.searches, state.searches);
  writeStoredArray(STORAGE_KEYS.compare, state.compare);
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.category !== "all") params.set("categoria", state.category);
  if (state.country !== "all") params.set("pais", state.country);
  if (state.store !== "all") params.set("tienda", state.store);
  if (state.sort !== "relevance") params.set("orden", state.sort);
  const query = params.toString();
  const next = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  history.replaceState(history.state, "", next);
}

function syncSearchInputs(source = null) {
  $$("[data-search-input]").forEach((input) => {
    if (input !== source && input.value !== state.query) input.value = state.query;
  });
}

function renderCatalogStatus(stats) {
  const status = $("[data-catalog-status]");
  if (!status) return;
  status.classList.toggle("is-warning", catalogWarnings.length > 0);
  status.classList.toggle("is-ready", catalogWarnings.length === 0);
  status.textContent = catalogWarnings.length
    ? `${formatter.format(stats.families)} familias · catálogo parcial`
    : `${formatter.format(stats.families)} familias disponibles`;
}

function renderMetrics(stats) {
  $("[data-family-total]").textContent = formatter.format(stats.families);
  $("[data-variant-total]").textContent = formatter.format(stats.variants);
  $("[data-market-total]").textContent = formatter.format(stats.countries.length);
  $$("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}

function familyPriceMarkup(family, offer) {
  const current = displayOfferPrice(offer);
  const previous = Number(offer?.previousPrice);
  const previousMarkup =
    Number.isFinite(previous) && offer?.currency && previous > (offerTotal(offer) ?? previous)
      ? `<span class="previous-price">${escapeHtml(formatMoney(previous, offer.currency, offer.country))}</span>`
      : "";
  return `
    <div class="price-line">
      <span>${family.minPrice === null ? "" : "Desde"}</span>
      <strong>${escapeHtml(current)}</strong>
      ${previousMarkup}
    </div>`;
}

function productCardMarkup(family, options = {}) {
  const offer = bestOffer(family, state.country);
  const favorite = state.favorites.has(family.id);
  const compared = state.compare.includes(family.id);
  const discount = discountPercent(offer);
  const marketLabel = family.countries.map(countryLabel).join(" · ");
  const storeText = `${family.stores.length} ${family.stores.length === 1 ? "tienda" : "tiendas"}`;
  const loading = options.eager ? "eager" : "lazy";

  return `
    <article class="product-card" data-family-card="${escapeHtml(family.id)}">
      <div class="product-media">
        <div class="card-badges">
          ${discount > 0 ? `<span class="badge discount">−${discount}%</span>` : ""}
          <span class="badge">${escapeHtml(marketLabel)}</span>
        </div>
        <button
          class="card-icon-button ${favorite ? "is-active" : ""}"
          type="button"
          data-toggle-favorite="${escapeHtml(family.id)}"
          aria-label="${favorite ? "Quitar de favoritos" : "Añadir a favoritos"}"
          aria-pressed="${favorite}"
        >${favorite ? "♥" : "♡"}</button>
        <img
          src="${escapeHtml(family.image)}"
          alt="${escapeHtml(family.title)}"
          loading="${loading}"
          width="420"
          height="420"
        >
      </div>
      <div class="product-body">
        <p class="product-meta">${escapeHtml(family.primaryGroup)} · ${escapeHtml(family.brand)}</p>
        <h3>${escapeHtml(family.title)}</h3>
        <div class="card-score-row">
          <span class="score" title="Puntuación orientativa de calidad de la ficha">SecretScore ${family.secretScore.toFixed(1)}</span>
          <span class="variant-count">${family.variantCount === 1 ? "1 variante" : `${formatter.format(family.variantCount)} variantes`}</span>
        </div>
        ${familyPriceMarkup(family, offer)}
        <p class="store-line"><span class="availability-dot"></span>${escapeHtml(storeText)} · ${family.offerCount} ${family.offerCount === 1 ? "oferta" : "ofertas"}</p>
        <div class="product-actions">
          <button class="product-open" type="button" data-open-family="${escapeHtml(family.id)}">
            ${family.offerCount > 1 ? "Comparar precios" : "Ver producto"}
          </button>
          <button
            class="compare-toggle ${compared ? "is-active" : ""}"
            type="button"
            data-toggle-compare="${escapeHtml(family.id)}"
            aria-label="${compared ? "Quitar del comparador" : "Añadir al comparador"}"
            aria-pressed="${compared}"
          >⇄</button>
        </div>
      </div>
    </article>`;
}

function renderHero() {
  const mosaic = selectDiverseFamilies(families, 3);
  $("[data-hero-mosaic]").innerHTML = mosaic.map((family) => {
    const offer = bestOffer(family);
    return `
      <button class="mosaic-card" type="button" data-open-family="${escapeHtml(family.id)}">
        <img src="${escapeHtml(family.image)}" alt="${escapeHtml(family.title)}" width="500" height="500" loading="eager">
        <span class="mosaic-label">
          <strong>${escapeHtml(family.title)}</strong>
          <span>${escapeHtml(displayOfferPrice(offer))} · ${family.variantCount} ${family.variantCount === 1 ? "variante" : "variantes"}</span>
        </span>
      </button>`;
  }).join("");
}

function renderCategories() {
  const categories = categoryStats(families).slice(0, 12);
  $("[data-category-grid]").innerHTML = categories.map((category) => `
    <button class="category-card" type="button" data-set-category="${escapeHtml(category.name)}">
      <span class="category-icon" aria-hidden="true">${escapeHtml(category.icon)}</span>
      <span>
        <strong>${escapeHtml(category.name)}</strong>
        <small>${formatter.format(category.count)} familias</small>
      </span>
      <span class="category-arrow" aria-hidden="true">→</span>
    </button>`).join("");
}

function renderHighlights() {
  const deals = topDeals(families, 14);
  const dealFamilies = deals.length ? deals : topScored(families, 10);
  $("[data-deals-carousel]").innerHTML = dealFamilies
    .map((family) => productCardMarkup(family))
    .join("");
  $("[data-featured-grid]").innerHTML = topScored(families, 8)
    .map((family) => productCardMarkup(family))
    .join("");
}

function renderStores() {
  const entries = new Map();
  for (const family of families) {
    for (const store of family.stores) {
      const current = entries.get(store) || { families: new Set(), countries: new Set() };
      current.families.add(family.id);
      family.offers
        .filter((offer) => offer.merchantName === store)
        .forEach((offer) => current.countries.add(offer.country));
      entries.set(store, current);
    }
  }

  $("[data-store-grid]").innerHTML = [...entries.entries()]
    .sort((left, right) => right[1].families.size - left[1].families.size)
    .map(([store, data]) => `
      <article class="store-card">
        <span class="store-mark" aria-hidden="true">${escapeHtml(store.slice(0, 2).toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(store)}</strong>
          <span>${formatter.format(data.families.size)} familias · ${[...data.countries].map(countryLabel).join(", ")}</span>
        </div>
      </article>`).join("");
}

function renderFilterOptions() {
  const options = filterOptions(families);
  const categorySelect = $("[data-filter-category]");
  categorySelect.innerHTML = `
    <option value="all">Todas las categorías</option>
    <optgroup label="Categorías principales">
      ${options.categoryGroups.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}
    </optgroup>
    <optgroup label="Subcategorías">
      ${options.rawCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}
    </optgroup>`;

  $("[data-filter-country]").innerHTML = `
    <option value="all">Todos los mercados</option>
    ${options.countries.map(({ code, label }) => `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`).join("")}`;
  $("[data-filter-store]").innerHTML = `
    <option value="all">Todas las tiendas</option>
    ${options.stores.map((store) => `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`).join("")}`;

  if (![...categorySelect.options].some((option) => option.value === state.category)) {
    state.category = "all";
  }
  if (![...$("[data-filter-country]").options].some((option) => option.value === state.country)) {
    state.country = "all";
  }
  if (![...$("[data-filter-store]").options].some((option) => option.value === state.store)) {
    state.store = "all";
  }
  syncFilterControls();
}

function syncFilterControls() {
  $("[data-filter-category]").value = state.category;
  $("[data-filter-country]").value = state.country;
  $("[data-filter-store]").value = state.store;
  $("[data-sort]").value = state.sort;
  $("[data-price-min]").value = state.minimumPrice ?? "";
  $("[data-price-max]").value = state.maximumPrice ?? "";
  $("[data-discount-only]").checked = state.discountOnly;
  $("[data-multiple-variants]").checked = state.multipleVariants;
}

function activeFilterEntries() {
  return [
    state.query ? { key: "query", label: `Búsqueda: ${state.query}` } : null,
    state.category !== "all" ? { key: "category", label: state.category } : null,
    state.country !== "all" ? { key: "country", label: countryLabel(state.country) } : null,
    state.store !== "all" ? { key: "store", label: state.store } : null,
    Number.isFinite(state.minimumPrice) ? { key: "minimumPrice", label: `Desde ${state.minimumPrice}` } : null,
    Number.isFinite(state.maximumPrice) ? { key: "maximumPrice", label: `Hasta ${state.maximumPrice}` } : null,
    state.discountOnly ? { key: "discountOnly", label: "Con descuento" } : null,
    state.multipleVariants ? { key: "multipleVariants", label: "Varias variantes" } : null
  ].filter(Boolean);
}

function renderActiveFilters() {
  const entries = activeFilterEntries();
  $("[data-active-filters]").innerHTML = entries.map((entry) => `
    <span class="active-filter">
      ${escapeHtml(entry.label)}
      <button type="button" data-remove-filter="${escapeHtml(entry.key)}" aria-label="Quitar filtro ${escapeHtml(entry.label)}">×</button>
    </span>`).join("");
  $("[data-clear-filters]").hidden = entries.length === 0;
  const advancedCount = [
    Number.isFinite(state.minimumPrice),
    Number.isFinite(state.maximumPrice),
    state.discountOnly,
    state.multipleVariants
  ].filter(Boolean).length;
  const counter = $("[data-active-filter-count]");
  counter.hidden = advancedCount === 0;
  counter.textContent = String(advancedCount);
}

function renderCategoryGuide() {
  const container = $("[data-category-guide]");
  if (state.category === "all") {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const guide = categoryGuide(state.category);
  container.hidden = false;
  container.innerHTML = `
    <div>
      <p class="eyebrow">Consejo por categoría</p>
      <h3>${escapeHtml(guide.title)}</h3>
      <p>${escapeHtml(guide.intro)}</p>
    </div>
    <ul>${guide.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`;
}

function renderCatalog({ updateHistory = true } = {}) {
  const results = filterAndSortFamilies(families, currentFilters());
  const visible = results.slice(0, state.visible);
  const grid = $("[data-catalog-grid]");
  grid.setAttribute("aria-busy", "false");
  grid.innerHTML = visible.length
    ? visible.map((family) => productCardMarkup(family)).join("")
    : `
      <div class="empty-state">
        <div>
          <h3>No hemos encontrado coincidencias</h3>
          <p>Prueba otra palabra, elimina algún filtro o cambia de mercado.</p>
          <button class="button secondary" type="button" data-clear-filters>Limpiar filtros</button>
        </div>
      </div>`;

  const summary = $("[data-results-summary]");
  const market = state.country === "all" ? "" : ` en ${countryLabel(state.country)}`;
  summary.textContent = `${formatter.format(results.length)} ${results.length === 1 ? "familia" : "familias"}${market}`;

  const loadMore = $("[data-load-more]");
  loadMore.hidden = visible.length >= results.length;
  loadMore.textContent = `Mostrar más productos (${formatter.format(results.length - visible.length)})`;
  renderActiveFilters();
  renderCategoryGuide();
  syncFilterControls();
  if (updateHistory) updateUrl();
}

function renderFavoriteCount() {
  $$("[data-favorite-count]").forEach((node) => {
    node.textContent = String(state.favorites.size);
  });
}

function renderCompareTray() {
  const tray = $("[data-compare-tray]");
  tray.hidden = state.compare.length === 0;
  $("[data-compare-count]").textContent = String(state.compare.length);
  $("[data-compare-thumbs]").innerHTML = state.compare
    .map((id) => familyById.get(id))
    .filter(Boolean)
    .map((family) => `<img src="${escapeHtml(family.image)}" alt="">`)
    .join("");
}

function renderPersonalizedViews() {
  renderFavoriteCount();
  renderCompareTray();
}

function refreshCardsAndCatalog() {
  renderHighlights();
  renderCatalog();
  renderPersonalizedViews();
}

function setQuery(query, options = {}) {
  state.query = String(query || "").trim().slice(0, 120);
  state.visible = PAGE_SIZE;
  syncSearchInputs(options.source);
  renderCatalog();
  if (options.save && state.query.length >= 2) saveSearch(state.query);
  if (options.scroll) $("#catalogo").scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveSearch(query) {
  const normalized = query.trim();
  state.searches = [
    normalized,
    ...state.searches.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
  ].slice(0, 10);
  persistPersonalState();
}

function setCategory(category, scroll = true) {
  state.category = category || "all";
  state.visible = PAGE_SIZE;
  renderCatalog();
  if (scroll) $("#catalogo").scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearFilters() {
  state.query = "";
  state.category = "all";
  state.country = "all";
  state.store = "all";
  state.sort = "relevance";
  state.minimumPrice = null;
  state.maximumPrice = null;
  state.discountOnly = false;
  state.multipleVariants = false;
  state.visible = PAGE_SIZE;
  syncSearchInputs();
  renderCatalog();
}

function removeFilter(key) {
  const resets = {
    query: "",
    category: "all",
    country: "all",
    store: "all",
    minimumPrice: null,
    maximumPrice: null,
    discountOnly: false,
    multipleVariants: false
  };
  if (Object.hasOwn(resets, key)) state[key] = resets[key];
  state.visible = PAGE_SIZE;
  syncSearchInputs();
  renderCatalog();
}

function toggleFavorite(familyId) {
  const family = familyById.get(familyId);
  if (!family) return;
  if (state.favorites.has(familyId)) {
    state.favorites.delete(familyId);
    showToast("Producto eliminado de favoritos.");
  } else {
    state.favorites.add(familyId);
    showToast("Producto guardado en favoritos.");
  }
  persistPersonalState();
  refreshCardsAndCatalog();
  if ($("#saved-dialog")?.open) renderSavedContent();
}

function toggleCompare(familyId) {
  if (!familyById.has(familyId)) return;
  if (state.compare.includes(familyId)) {
    state.compare = state.compare.filter((id) => id !== familyId);
  } else if (state.compare.length >= MAX_COMPARE) {
    showToast(`Puedes comparar hasta ${MAX_COMPARE} productos a la vez.`);
    return;
  } else {
    state.compare.push(familyId);
    showToast("Producto añadido al comparador.");
  }
  persistPersonalState();
  refreshCardsAndCatalog();
  if ($("#product-dialog")?.open && state.selectedFamilyId === familyId) {
    renderProductDialog(familyId, state.selectedVariantId);
  }
  if ($("#compare-dialog")?.open) renderComparison();
}

function rememberViewed(familyId) {
  state.recent = [familyId, ...state.recent.filter((id) => id !== familyId)].slice(0, 16);
  persistPersonalState();
}

function availabilityLabel(value) {
  const labels = {
    in_stock: "En stock",
    preorder: "Reserva",
    unknown: "Confirmar en tienda"
  };
  return labels[value] || "Disponible";
}

function shippingLabel(offer) {
  if (offer.shippingCost === 0) return "Gratis";
  if (Number.isFinite(offer.shippingCost)) {
    return formatMoney(offer.shippingCost, offer.currency, offer.country);
  }
  return "Consultar";
}

function shippingDetailLabel(offer) {
  const label = shippingLabel(offer);
  return label === "Consultar" ? "Envío a confirmar" : `${label} de envío`;
}

function bestPriceNote(offer, index) {
  return index === 0 && offerTotal(offer) !== null ? "Mejor precio detectado" : "";
}

function variantAttributes(variant) {
  return [
    ["Color", variant.color],
    ["Tamaño", variant.size],
    ["Orientación", variant.orientation],
    ["Medidas", variant.dimensions],
    ["Material", variant.material],
    ["Capacidad", variant.capacity],
    ["Configuración", variant.configuration]
  ].filter(([, value]) => value);
}

function offerRowMarkup(offer, index) {
  return `
    <tr class="${index === 0 ? "best-row" : ""}">
      <td><strong>${escapeHtml(offer.merchantName)}</strong>${bestPriceNote(offer, index) ? `<br><small>${bestPriceNote(offer, index)}</small>` : ""}</td>
      <td>${escapeHtml(displayOfferPrice(offer))}</td>
      <td>${escapeHtml(shippingLabel(offer))}</td>
      <td>${escapeHtml(availabilityLabel(offer.availability))}</td>
      <td><a class="offer-link" href="./go.html?offer=${encodeURIComponent(offer.id)}" target="_blank" rel="nofollow sponsored noopener" data-outbound-offer="${escapeHtml(offer.id)}">Ver oferta</a></td>
    </tr>`;
}

function offerCardMarkup(offer, index) {
  return `
    <article class="offer-card ${index === 0 ? "is-best" : ""}">
      <div>
        <strong>${escapeHtml(offer.merchantName)}</strong>
        <small>${escapeHtml(countryLabel(offer.country))}${bestPriceNote(offer, index) ? ` · ${bestPriceNote(offer, index)}` : ""}</small>
      </div>
      <div>
        <strong>${escapeHtml(displayOfferPrice(offer))}</strong>
        <small>${escapeHtml(shippingLabel(offer))} de envío</small>
      </div>
      <a class="offer-link" href="./go.html?offer=${encodeURIComponent(offer.id)}" target="_blank" rel="nofollow sponsored noopener" data-outbound-offer="${escapeHtml(offer.id)}">Ver oferta en la tienda</a>
    </article>`;
}

function renderProductDialog(familyId, preferredVariantId = null) {
  const family = familyById.get(familyId);
  if (!family) return;
  const variant =
    family.variants.find((item) => item.id === preferredVariantId) ||
    family.variants[0];
  state.selectedFamilyId = family.id;
  state.selectedVariantId = variant.id;
  const images = uniqueStrings([...variant.images, ...family.images]).slice(0, 8);
  state.selectedImage =
    images.includes(state.selectedImage) ? state.selectedImage : images[0] || family.image;
  const offers = [...variant.offers].sort((left, right) =>
    (offerTotal(left) ?? Infinity) - (offerTotal(right) ?? Infinity)
  );
  const best = offers[0];
  const attributes = variantAttributes(variant);
  const compared = state.compare.includes(family.id);
  const favorite = state.favorites.has(family.id);
  const hiddenVariantCount = Math.max(0, family.variants.length - 10);
  const related = relatedFamilies(families, family, 3);
  const content = $("[data-product-content]");

  content.innerHTML = `
    <button class="modal-close product-close" type="button" data-close-product aria-label="Cerrar">×</button>
    <article class="product-detail">
      <div class="detail-media">
        <div class="detail-main-image">
          <button type="button" data-open-image="${escapeHtml(state.selectedImage)}" aria-label="Ampliar imagen">
            <img src="${escapeHtml(state.selectedImage)}" alt="${escapeHtml(family.title)}">
          </button>
        </div>
        ${images.length > 1 ? `
          <div class="gallery-thumbs" aria-label="Galería del producto">
            ${images.map((image, index) => `
              <button class="${image === state.selectedImage ? "is-active" : ""}" type="button" data-select-image="${escapeHtml(image)}" aria-label="Mostrar imagen ${index + 1}">
                <img src="${escapeHtml(image)}" alt="" loading="lazy">
              </button>`).join("")}
          </div>` : ""}
      </div>
      <div class="detail-content">
        <div class="detail-topbar">
          <span class="breadcrumbs">Inicio / ${escapeHtml(family.primaryGroup)} / ${escapeHtml(family.brand)}</span>
          <div class="detail-actions">
            <button type="button" data-toggle-favorite="${escapeHtml(family.id)}">${favorite ? "♥ Guardado" : "♡ Favorito"}</button>
            <button type="button" data-toggle-compare="${escapeHtml(family.id)}">${compared ? "✓ Comparando" : "⇄ Comparar"}</button>
          </div>
        </div>
        <h2 id="product-title">${escapeHtml(family.title)}</h2>
        <div class="detail-summary">
          <span class="score">SecretScore ${family.secretScore.toFixed(1)}</span>
          <span>${formatter.format(family.variantCount)} ${family.variantCount === 1 ? "variante" : "variantes"}</span>
          <span>${family.countries.map(countryLabel).join(" · ")}</span>
        </div>
        ${variant.title !== family.title ? `<p class="detail-variant-title">${escapeHtml(variant.title)}</p>` : ""}
        <p class="detail-description">${escapeHtml(family.description)}</p>

        <section class="detail-section" aria-labelledby="variants-title">
          <div class="detail-section-head">
            <h3 id="variants-title">Elige la variante exacta</h3>
            <span>${formatter.format(family.variantCount)} disponibles</span>
          </div>
          <div class="variant-list">
            ${family.variants.map((item, index) => `
              <button
                class="variant-chip ${item.id === variant.id ? "is-active" : ""} ${index >= 10 ? "extra-variant" : ""}"
                type="button"
                data-select-variant="${escapeHtml(item.id)}"
                ${index >= 10 ? "hidden" : ""}
              >${escapeHtml(item.label)}</button>`).join("")}
            ${hiddenVariantCount ? `<button class="variant-chip" type="button" data-show-all-variants>Ver ${hiddenVariantCount} más</button>` : ""}
          </div>
        </section>

        <section class="detail-section" aria-labelledby="offers-title">
          <div class="detail-section-head">
            <h3 id="offers-title">${offers.length === 1 ? "Oferta disponible" : "Compara ofertas"}</h3>
            <span>${offers.length} ${offers.length === 1 ? "tienda" : "ofertas"}</span>
          </div>
          ${offers.length === 1 ? `
            <div class="offer-highlight">
              <div>
                <p>${escapeHtml(best.merchantName)} · ${escapeHtml(countryLabel(best.country))}</p>
                <strong class="offer-main-price">${escapeHtml(displayOfferPrice(best))}</strong>
                <small>${escapeHtml(shippingDetailLabel(best))} · ${escapeHtml(availabilityLabel(best.availability))}</small>
              </div>
              <a class="offer-link" href="./go.html?offer=${encodeURIComponent(best.id)}" target="_blank" rel="nofollow sponsored noopener" data-outbound-offer="${escapeHtml(best.id)}">Ver oferta</a>
            </div>` : `
            <div class="offer-table-wrap">
              <table class="offer-table">
                <thead><tr><th>Tienda</th><th>Precio</th><th>Envío</th><th>Disponibilidad</th><th>Acción</th></tr></thead>
                <tbody>${offers.map(offerRowMarkup).join("")}</tbody>
              </table>
            </div>
            <div class="offer-cards">${offers.map(offerCardMarkup).join("")}</div>`}
          <p class="detail-disclosure">El precio, el envío y la disponibilidad definitivos se confirman en la tienda. El enlace puede generar una comisión sin coste adicional.</p>
        </section>

        ${attributes.length ? `
          <section class="detail-section" aria-labelledby="attributes-title">
            <div class="detail-section-head"><h3 id="attributes-title">Características de esta variante</h3></div>
            <dl class="attribute-grid">
              ${attributes.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
            </dl>
          </section>` : ""}

        ${related.length ? `
          <section class="detail-section" aria-labelledby="related-title">
            <div class="detail-section-head"><h3 id="related-title">Alternativas similares</h3><span>No se consideran el mismo producto</span></div>
            <div class="detail-related">
              ${related.map((item) => `
                <button type="button" data-open-family="${escapeHtml(item.id)}">
                  <img src="${escapeHtml(item.image)}" alt="">
                  <span>${escapeHtml(item.title)}</span>
                </button>`).join("")}
            </div>
          </section>` : ""}
      </div>
    </article>
    <div class="image-viewer" data-image-viewer hidden>
      <button type="button" data-close-image aria-label="Cerrar imagen ampliada">×</button>
      <img src="${escapeHtml(state.selectedImage)}" alt="${escapeHtml(family.title)} ampliado">
    </div>`;
}

function openProduct(familyId, options = {}) {
  const family = familyById.get(familyId);
  if (!family) return;
  state.selectedImage = null;
  rememberViewed(familyId);
  renderProductDialog(familyId, options.variantId);
  openDialog($("#product-dialog"));
  if (options.route !== false) {
    const hash = `#/producto/${encodeURIComponent(familyId)}`;
    if (location.hash !== hash) history.pushState({ product: familyId }, "", hash);
  }
  dispatchAnalytics("product_view", {
    family_id: familyId,
    category: family.primaryGroup
  });
}

function closeProduct({ clearRoute = true } = {}) {
  closeDialog($("#product-dialog"));
  state.selectedFamilyId = null;
  state.selectedVariantId = null;
  state.selectedImage = null;
  if (clearRoute && location.hash.startsWith("#/producto/")) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}

function handleProductRoute() {
  const match = location.hash.match(/^#\/producto\/(.+)$/);
  if (!match) {
    if ($("#product-dialog")?.open) closeProduct({ clearRoute: false });
    return;
  }
  const familyId = decodeURIComponent(match[1]);
  if (familyById.has(familyId)) {
    if (!$("#product-dialog")?.open || state.selectedFamilyId !== familyId) {
      openProduct(familyId, { route: false });
    }
  } else {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    showToast("Ese producto ya no está disponible.");
  }
}

function renderComparison() {
  const selected = state.compare.map((id) => familyById.get(id)).filter(Boolean);
  const content = $("[data-compare-content]");
  if (selected.length === 0) {
    content.innerHTML = `<div class="saved-empty"><div><h3>El comparador está vacío</h3><p>Añade hasta cuatro productos desde sus tarjetas.</p></div></div>`;
    return;
  }
  const cells = (valueForFamily) =>
    selected.map((family) => `<td>${valueForFamily(family)}</td>`).join("");
  content.innerHTML = `
    <div class="comparison-scroll">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Producto</th>
            ${selected.map((family) => `
              <td>
                <div class="compare-product-head">
                  <img src="${escapeHtml(family.image)}" alt="">
                  <strong>${escapeHtml(family.title)}</strong>
                  <button type="button" data-toggle-compare="${escapeHtml(family.id)}">Quitar</button>
                </div>
              </td>`).join("")}
          </tr>
        </thead>
        <tbody>
          <tr><th>Categoría</th>${cells((family) => escapeHtml(family.primaryGroup))}</tr>
          <tr><th>SecretScore</th>${cells((family) => `<span class="score">${family.secretScore.toFixed(1)}</span>`)}</tr>
          <tr><th>Precio</th>${cells((family) => escapeHtml(displayOfferPrice(bestOffer(family, state.country))))}</tr>
          <tr><th>Variantes</th>${cells((family) => formatter.format(family.variantCount))}</tr>
          <tr><th>Tiendas</th>${cells((family) => escapeHtml(family.stores.join(", ")))}</tr>
          <tr><th>Mercados</th>${cells((family) => escapeHtml(family.countries.map(countryLabel).join(", ")))}</tr>
          <tr><th>Ver detalle</th>${cells((family) => `<button class="button secondary" type="button" data-open-family="${escapeHtml(family.id)}">Abrir</button>`)}</tr>
        </tbody>
      </table>
    </div>
    <div class="comparison-cards">
      ${selected.map((family) => `
        <article class="comparison-card">
          <div class="comparison-card-head">
            <img src="${escapeHtml(family.image)}" alt="">
            <div>
              <strong>${escapeHtml(family.title)}</strong>
              <span class="score">SecretScore ${family.secretScore.toFixed(1)}</span>
            </div>
          </div>
          <dl>
            <div><dt>Categoría</dt><dd>${escapeHtml(family.primaryGroup)}</dd></div>
            <div><dt>Precio</dt><dd>${escapeHtml(displayOfferPrice(bestOffer(family, state.country)))}</dd></div>
            <div><dt>Variantes</dt><dd>${formatter.format(family.variantCount)}</dd></div>
            <div><dt>Tiendas</dt><dd>${escapeHtml(family.stores.join(", "))}</dd></div>
            <div><dt>Mercados</dt><dd>${escapeHtml(family.countries.map(countryLabel).join(", "))}</dd></div>
          </dl>
          <div class="comparison-card-actions">
            <button class="button secondary" type="button" data-open-family="${escapeHtml(family.id)}">Abrir ficha</button>
            <button class="comparison-remove" type="button" data-toggle-compare="${escapeHtml(family.id)}">Quitar</button>
          </div>
        </article>`).join("")}
    </div>`;
}

function openComparison() {
  renderComparison();
  openDialog($("#compare-dialog"));
  dispatchAnalytics("compare_open", { product_count: state.compare.length });
}

function renderSavedContent() {
  const content = $("[data-saved-content]");
  const tabs = $$("[data-saved-tab]");
  tabs.forEach((tab) => {
    const selected = tab.dataset.savedTab === state.savedTab;
    tab.setAttribute("aria-selected", String(selected));
  });

  if (state.savedTab === "searches") {
    content.innerHTML = state.searches.length
      ? `<div class="search-history-list">${state.searches.map((query) => `<button type="button" data-use-search="${escapeHtml(query)}">${escapeHtml(query)}</button>`).join("")}</div>`
      : `<div class="saved-empty"><div><h3>Aún no hay búsquedas guardadas</h3><p>Las últimas búsquedas quedan solo en este dispositivo.</p></div></div>`;
    return;
  }

  const ids = state.savedTab === "favorites"
    ? [...state.favorites]
    : state.recent;
  const selectedFamilies = ids.map((id) => familyById.get(id)).filter(Boolean);
  content.innerHTML = selectedFamilies.length
    ? `<div class="saved-list">${selectedFamilies.map((family) => `
        <article class="saved-item">
          <img src="${escapeHtml(family.image)}" alt="">
          <div>
            <strong>${escapeHtml(family.title)}</strong>
            <small>${escapeHtml(family.primaryGroup)} · ${escapeHtml(displayOfferPrice(bestOffer(family)))}</small>
          </div>
          <button type="button" data-open-family="${escapeHtml(family.id)}" aria-label="Abrir ${escapeHtml(family.title)}">→</button>
        </article>`).join("")}</div>`
    : `<div class="saved-empty"><div><h3>${state.savedTab === "favorites" ? "No has guardado favoritos" : "Aún no hay productos recientes"}</h3><p>Explora el catálogo y vuelve aquí cuando quieras.</p></div></div>`;
}

function openSaved() {
  renderSavedContent();
  openDialog($("#saved-dialog"));
}

function renderSuggestions(input) {
  const container = $("[data-search-suggestions]");
  if (!container || input.id !== "header-search") return;
  state.suggestions = getSuggestions(families, input.value, 7);
  state.suggestionIndex = -1;
  input.setAttribute("aria-expanded", String(state.suggestions.length > 0));
  container.hidden = state.suggestions.length === 0;
  container.innerHTML = state.suggestions.map((suggestion, index) => `
    <button
      class="suggestion"
      type="button"
      role="option"
      aria-selected="false"
      data-suggestion-index="${index}"
    >
      ${suggestion.image
        ? `<img src="${escapeHtml(suggestion.image)}" alt="">`
        : `<span class="category-icon" aria-hidden="true">⌕</span>`}
      <span>
        <strong>${escapeHtml(suggestion.label)}</strong>
        <small>${escapeHtml(suggestion.meta)}</small>
      </span>
      <span class="suggestion-type">${suggestion.type === "product" ? "Producto" : "Categoría"}</span>
    </button>`).join("");
}

function closeSuggestions() {
  const container = $("[data-search-suggestions]");
  if (container) {
    container.hidden = true;
    container.innerHTML = "";
  }
  const input = $("#header-search");
  if (input) input.setAttribute("aria-expanded", "false");
  state.suggestions = [];
  state.suggestionIndex = -1;
}

function chooseSuggestion(index) {
  const suggestion = state.suggestions[index];
  if (!suggestion) return;
  closeSuggestions();
  if (suggestion.type === "product") {
    openProduct(suggestion.value);
  } else {
    setCategory(suggestion.value);
  }
}

function moveSuggestion(direction) {
  if (state.suggestions.length === 0) return;
  state.suggestionIndex =
    (state.suggestionIndex + direction + state.suggestions.length) %
    state.suggestions.length;
  $$("[data-suggestion-index]").forEach((button, index) => {
    button.setAttribute("aria-selected", String(index === state.suggestionIndex));
  });
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEYS.theme, next);
  } catch {}
  renderThemeControls();
}

function renderThemeControls() {
  const dark = document.documentElement.dataset.theme === "dark";
  $$("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-label", dark ? "Activar modo claro" : "Activar modo oscuro");
  });
  $$("[data-theme-label]").forEach((label) => {
    label.textContent = dark ? "Claro" : "Oscuro";
  });
  $$("[data-theme-icon]").forEach((icon) => {
    icon.textContent = dark ? "☀" : "◐";
  });
  const themeMeta = $('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = dark ? "#09181c" : "#f7f2e8";
}

function applyAdvancedFilters(event) {
  event.preventDefault();
  const minimum = Number($("[data-price-min]").value);
  const maximum = Number($("[data-price-max]").value);
  const hasMinimum = $("[data-price-min]").value !== "" && Number.isFinite(minimum);
  const hasMaximum = $("[data-price-max]").value !== "" && Number.isFinite(maximum);
  if ((hasMinimum || hasMaximum) && state.country === "all") {
    showToast("Elige un mercado antes de filtrar por precio; las monedas son distintas.");
    return;
  }
  if (hasMinimum && hasMaximum && minimum > maximum) {
    showToast("El precio mínimo no puede superar al máximo.");
    return;
  }
  state.minimumPrice = hasMinimum ? Math.max(0, minimum) : null;
  state.maximumPrice = hasMaximum ? Math.max(0, maximum) : null;
  state.discountOnly = $("[data-discount-only]").checked;
  state.multipleVariants = $("[data-multiple-variants]").checked;
  state.visible = PAGE_SIZE;
  closeDialog($("#filters-dialog"));
  renderCatalog();
}

function resetAdvancedFilters() {
  state.minimumPrice = null;
  state.maximumPrice = null;
  state.discountOnly = false;
  state.multipleVariants = false;
  syncFilterControls();
}

function wireEvents() {
  document.addEventListener("submit", (event) => {
    if (event.target.matches("[data-search-form]")) {
      event.preventDefault();
      const input = $("[data-search-input]", event.target);
      closeSuggestions();
      setQuery(input.value, { source: input, save: true, scroll: true });
    }
    if (event.target.matches("[data-advanced-filters]")) {
      applyAdvancedFilters(event);
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-search-input]");
    if (!input) return;
    window.clearTimeout(inputTimer);
    state.query = input.value.slice(0, 120);
    syncSearchInputs(input);
    renderSuggestions(input);
    inputTimer = window.setTimeout(() => {
      state.visible = PAGE_SIZE;
      renderCatalog();
    }, 180);
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-filter-category]")) {
      state.category = event.target.value;
      state.visible = PAGE_SIZE;
      renderCatalog();
    }
    if (event.target.matches("[data-filter-country]")) {
      state.country = event.target.value;
      state.minimumPrice = null;
      state.maximumPrice = null;
      state.visible = PAGE_SIZE;
      renderCatalog();
    }
    if (event.target.matches("[data-filter-store]")) {
      state.store = event.target.value;
      state.visible = PAGE_SIZE;
      renderCatalog();
    }
    if (event.target.matches("[data-sort]")) {
      state.sort = event.target.value;
      renderCatalog();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.id === "header-search") {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSuggestion(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSuggestion(-1);
      } else if (event.key === "Enter" && state.suggestionIndex >= 0) {
        event.preventDefault();
        chooseSuggestion(state.suggestionIndex);
      } else if (event.key === "Escape") {
        closeSuggestions();
      }
    }
  });

  document.addEventListener("click", (event) => {
    const suggestion = event.target.closest("[data-suggestion-index]");
    if (suggestion) {
      chooseSuggestion(Number(suggestion.dataset.suggestionIndex));
      return;
    }

    const favorite = event.target.closest("[data-toggle-favorite]");
    if (favorite) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(favorite.dataset.toggleFavorite);
      return;
    }

    const compare = event.target.closest("[data-toggle-compare]");
    if (compare) {
      event.preventDefault();
      event.stopPropagation();
      toggleCompare(compare.dataset.toggleCompare);
      return;
    }

    const open = event.target.closest("[data-open-family]");
    if (open) {
      event.preventDefault();
      openProduct(open.dataset.openFamily);
      return;
    }

    const category = event.target.closest("[data-set-category]");
    if (category) {
      setCategory(category.dataset.setCategory);
      return;
    }

    const footerCategory = event.target.closest("[data-footer-category]");
    if (footerCategory) {
      event.preventDefault();
      setCategory(footerCategory.dataset.footerCategory);
      return;
    }

    const removeFilterButton = event.target.closest("[data-remove-filter]");
    if (removeFilterButton) {
      removeFilter(removeFilterButton.dataset.removeFilter);
      return;
    }

    if (event.target.closest("[data-clear-filters]")) {
      clearFilters();
      return;
    }

    if (event.target.closest("[data-load-more]")) {
      state.visible += PAGE_SIZE;
      renderCatalog();
      return;
    }

    const previousCarousel = event.target.closest("[data-carousel-prev]");
    const nextCarousel = event.target.closest("[data-carousel-next]");
    if (previousCarousel || nextCarousel) {
      const carousel = $("[data-deals-carousel]");
      carousel.scrollBy({
        left: (nextCarousel ? 1 : -1) * Math.max(260, carousel.clientWidth * 0.75),
        behavior: "smooth"
      });
      return;
    }

    if (event.target.closest("[data-open-saved]")) {
      openSaved();
      return;
    }
    if (event.target.closest("[data-open-compare]")) {
      openComparison();
      return;
    }
    if (event.target.closest("[data-clear-compare]")) {
      state.compare = [];
      persistPersonalState();
      refreshCardsAndCatalog();
      return;
    }
    if (event.target.closest("[data-open-filters]")) {
      syncFilterControls();
      openDialog($("#filters-dialog"));
      return;
    }
    if (event.target.closest("[data-reset-advanced]")) {
      resetAdvancedFilters();
      return;
    }
    if (event.target.closest("[data-score-help]")) {
      openDialog($("#score-dialog"));
      return;
    }
    if (event.target.closest("[data-theme-toggle]")) {
      toggleTheme();
      return;
    }
    if (event.target.closest("[data-menu-toggle]")) {
      openDialog($("#menu-dialog"));
      return;
    }

    const savedTab = event.target.closest("[data-saved-tab]");
    if (savedTab) {
      state.savedTab = savedTab.dataset.savedTab;
      renderSavedContent();
      return;
    }

    const useSearch = event.target.closest("[data-use-search]");
    if (useSearch) {
      closeDialog($("#saved-dialog"));
      setQuery(useSearch.dataset.useSearch, { save: true, scroll: true });
      return;
    }

    const variant = event.target.closest("[data-select-variant]");
    if (variant) {
      state.selectedImage = null;
      renderProductDialog(state.selectedFamilyId, variant.dataset.selectVariant);
      return;
    }
    if (event.target.closest("[data-show-all-variants]")) {
      $$(".extra-variant", $("[data-product-content]")).forEach((chip) => {
        chip.hidden = false;
      });
      event.target.closest("[data-show-all-variants]").remove();
      return;
    }

    const image = event.target.closest("[data-select-image]");
    if (image) {
      state.selectedImage = image.dataset.selectImage;
      const main = $(".detail-main-image img");
      if (main) main.src = state.selectedImage;
      $$("[data-select-image]").forEach((button) => {
        button.classList.toggle("is-active", button === image);
      });
      const openImage = $("[data-open-image]");
      if (openImage) openImage.dataset.openImage = state.selectedImage;
      return;
    }

    if (event.target.closest("[data-open-image]")) {
      const viewer = $("[data-image-viewer]");
      viewer.hidden = false;
      $(".image-viewer img").src = event.target.closest("[data-open-image]").dataset.openImage;
      return;
    }
    if (event.target.closest("[data-close-image]")) {
      $("[data-image-viewer]").hidden = true;
      return;
    }

    const outbound = event.target.closest("[data-outbound-offer]");
    if (outbound) {
      dispatchAnalytics("outbound_click", {
        offer_id: outbound.dataset.outboundOffer,
        family_id: state.selectedFamilyId
      });
      return;
    }

    if (event.target.closest("[data-close-product]")) {
      closeProduct();
      return;
    }

    const close = event.target.closest("[data-close-dialog]");
    if (close) {
      closeDialog(close.closest("dialog"));
      return;
    }

    if (
      !event.target.closest(".header-search") &&
      !event.target.closest("[data-search-suggestions]")
    ) {
      closeSuggestions();
    }

    const menuLink = event.target.closest("#menu-dialog a");
    if (menuLink) closeDialog($("#menu-dialog"));
  });

  document.addEventListener("close", syncBodyModalState, true);
  document.addEventListener("cancel", (event) => {
    if (event.target.id === "product-dialog") closeProduct();
    else syncBodyModalState();
  }, true);

  document.addEventListener("error", (event) => {
    if (event.target instanceof HTMLImageElement) {
      event.target.hidden = true;
      event.target.parentElement?.classList.add("image-error");
    }
  }, true);

  window.addEventListener("hashchange", handleProductRoute);
  window.addEventListener("popstate", handleProductRoute);
}

function renderInitial(stats) {
  renderMetrics(stats);
  renderCatalogStatus(stats);
  renderHero();
  renderCategories();
  renderHighlights();
  renderStores();
  renderFilterOptions();
  renderPersonalizedViews();
  syncSearchInputs();
  renderThemeControls();
  renderCatalog({ updateHistory: false });
  handleProductRoute();
}

async function start() {
  wireEvents();
  try {
    const stats = await loadCatalog();
    renderInitial(stats);
  } catch (error) {
    const status = $("[data-catalog-status]");
    if (status) {
      status.textContent = "Catálogo no disponible";
      status.classList.add("is-warning");
    }
    const grid = $("[data-catalog-grid]");
    if (grid) {
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>No se pudo cargar el catálogo</h3>
            <p>Actualiza la página en unos instantes. El resto de la información sigue disponible.</p>
          </div>
        </div>`;
    }
    console.error("[SecretShop] Error de catálogo", error);
  }
}

start();
