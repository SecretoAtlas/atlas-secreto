const STOP_WORDS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "los",
  "para",
  "por",
  "un",
  "una",
  "y"
]);

const SEARCH_SYNONYMS = {
  auriculares: ["audifonos", "cascos", "headphones"],
  audifonos: ["auriculares", "cascos"],
  bolso: ["bolsa", "mochila"],
  celular: ["movil", "telefono", "smartphone"],
  coche: ["auto", "automovil", "carro"],
  lampara: ["iluminacion", "luz"],
  movil: ["celular", "telefono", "smartphone"],
  ordenador: ["computadora", "pc"],
  computadora: ["ordenador", "pc"],
  sofa: ["sillon", "mueble"],
  sillon: ["sofa", "mueble"],
  tenis: ["zapatillas", "calzado"],
  zapatillas: ["tenis", "calzado"]
};

export const CATEGORY_GROUPS = [
  {
    name: "Tecnología",
    icon: "⌁",
    aliases: ["Tecnología", "Electrónica", "Informática", "Papelería y oficina"]
  },
  {
    name: "Hogar",
    icon: "⌂",
    aliases: [
      "Hogar",
      "Hogar y cocina",
      "Sofás",
      "Sillas y sillones",
      "Bancos, pufs y reposapiés",
      "Camas y colchones",
      "Mesas y escritorios",
      "Almacenaje",
      "Iluminación",
      "Textiles y cojines",
      "Jardín y terraza",
      "Cocina y comedor",
      "Decoración y accesorios",
      "Herramientas y bricolaje"
    ]
  },
  {
    name: "Moda",
    icon: "◇",
    aliases: [
      "Moda mujer",
      "Moda hombre",
      "Moda infantil",
      "Accesorios mujer",
      "Accesorios hombre",
      "Accesorios y complementos"
    ]
  },
  {
    name: "Belleza y cuidado",
    icon: "✦",
    aliases: ["Belleza y cuidado"]
  },
  {
    name: "Deportes",
    icon: "○",
    aliases: ["Deportes y aire libre"]
  },
  {
    name: "Aventura y viajes",
    icon: "△",
    aliases: ["Aventura y viajes"]
  },
  {
    name: "Coche/Moto",
    icon: "◎",
    aliases: ["Coche/Moto"]
  },
  {
    name: "Virales",
    icon: "↗",
    aliases: ["Virales"]
  },
  {
    name: "Menos de 10",
    icon: "€",
    aliases: ["Menos de 10"]
  },
  {
    name: "Mascotas",
    icon: "♢",
    aliases: ["Mascotas"]
  },
  {
    name: "Familia y ocio",
    icon: "☆",
    aliases: ["Juguetes y ocio", "Bebés y niños"]
  },
  {
    name: "Otros",
    icon: "＋",
    aliases: ["Industria y negocio", "Otros"]
  }
];

const GROUP_BY_ALIAS = new Map(
  CATEGORY_GROUPS.flatMap((group) =>
    group.aliases.map((alias) => [normalizeText(alias), group])
  )
);

const COUNTRY_LABELS = {
  ES: "España",
  MX: "México",
  CO: "Colombia"
};

const COUNTRY_LOCALES = {
  ES: "es-ES",
  MX: "es-MX",
  CO: "es-CO"
};

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function uniqueStrings(values) {
  return [
    ...new Set(
      asArray(values)
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-").slice(0, 96);
}

export function isRealImage(value) {
  if (
    typeof value !== "string" ||
    !(/^(?:https?:\/\/|\.{0,2}\/?images\/)/i.test(value))
  ) {
    return false;
  }
  if (/\/assets\/brand\/amazon-placeholder\.svg(?:[?#].*)?$/i.test(value)) {
    return true;
  }
  return !/(placehold\.co|placeholder|no[-_ ]?image)/i.test(value);
}

export function isVisibleAvailability(value) {
  return !["out_of_stock", "unavailable", "discontinued"].includes(
    String(value || "").toLowerCase()
  );
}

export function countryLabel(code) {
  return COUNTRY_LABELS[String(code || "").toUpperCase()] || String(code || "Disponible");
}

export function formatMoney(amount, currency = "EUR", country = "ES") {
  if (amount === null || amount === undefined || amount === "") return null;
  if (!Number.isFinite(Number(amount))) return null;
  try {
    return new Intl.NumberFormat(COUNTRY_LOCALES[country] || "es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

function numericValueOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function offerTotal(offer) {
  const totalPrice = numericValueOrNull(offer?.totalPrice);
  if (totalPrice !== null) return totalPrice;

  const price = numericValueOrNull(offer?.price);
  if (price === null) return null;

  const shippingCost = numericValueOrNull(offer?.shippingCost);
  return price + (shippingCost ?? 0);
}

export function displayOfferPrice(offer) {
  const total = offerTotal(offer);
  if (total !== null && offer?.currency) {
    return formatMoney(total, offer.currency, offer.country);
  }
  return String(
    offer?.displayPrice ||
    offer?.priceLabel ||
    offer?.priceSnapshot ||
    "Consultar precio"
  );
}

export function discountPercent(offer) {
  const current = offerTotal(offer);
  const previous = Number(offer?.previousPrice);
  if (
    current === null ||
    !Number.isFinite(previous) ||
    previous <= current ||
    previous <= 0
  ) {
    return 0;
  }
  return Math.round(((previous - current) / previous) * 100);
}

function normalizeOffer(rawOffer, defaults = {}) {
  if (!rawOffer || typeof rawOffer !== "object") return null;
  const id = String(
    rawOffer.id ||
    rawOffer.offerId ||
    defaults.offerId ||
    ""
  ).trim();
  if (!id) return null;

  const country = String(
    rawOffer.country ||
    defaults.country ||
    ""
  ).toUpperCase();
  const currency = String(
    rawOffer.currency ||
    defaults.currency ||
    ""
  ).toUpperCase();
  const price = numericValueOrNull(rawOffer.price);
  const previousPrice = numericValueOrNull(rawOffer.previousPrice);
  const shippingCost = numericValueOrNull(rawOffer.shippingCost);
  const totalPrice = numericValueOrNull(rawOffer.totalPrice);

  return {
    id,
    merchantId: String(
      rawOffer.merchantId ||
      defaults.merchantId ||
      "external-store"
    ),
    merchantName: String(
      rawOffer.merchantName ||
      rawOffer.store ||
      defaults.merchantName ||
      "Tienda"
    ),
    country,
    currency,
    price,
    previousPrice,
    shippingCost,
    totalPrice: totalPrice !== null
      ? totalPrice
      : price !== null
        ? price + (shippingCost ?? 0)
        : null,
    displayPrice: rawOffer.displayPrice || rawOffer.priceLabel || rawOffer.priceSnapshot || null,
    availability: rawOffer.availability || "unknown",
    condition: rawOffer.condition || "new",
    deliveryTime: rawOffer.deliveryTime || null,
    updatedAt: rawOffer.updatedAt || rawOffer.lastUpdatedAt || null,
    isStale: rawOffer.isStale === true
  };
}

function variantLabel(rawVariant) {
  if (rawVariant.label) return String(rawVariant.label);
  const values = uniqueStrings([
    rawVariant.color,
    rawVariant.size,
    rawVariant.orientation,
    rawVariant.dimensions,
    rawVariant.material,
    rawVariant.capacity,
    rawVariant.configuration
  ]);
  return values.slice(0, 3).join(" · ") || "Modelo disponible";
}

function normalizeVariant(rawVariant, family, defaults) {
  if (!rawVariant || typeof rawVariant !== "object") return null;
  const legacyOffer = rawVariant.offerId
    ? normalizeOffer(rawVariant, {
        ...defaults,
        offerId: rawVariant.offerId
      })
    : null;
  const offers = asArray(rawVariant.offers)
    .map((offer) => normalizeOffer(offer, defaults))
    .filter(Boolean);
  if (legacyOffer) offers.push(legacyOffer);

  const deduplicatedOffers = [
    ...new Map(offers.map((offer) => [offer.id, offer])).values()
  ].filter((offer) => isVisibleAvailability(offer.availability));

  if (deduplicatedOffers.length === 0) return null;

  const images = uniqueStrings([
    ...asArray(rawVariant.images),
    rawVariant.image,
    family.image
  ]).filter(isRealImage);

  return {
    id: String(rawVariant.id || `${family.id}-variant-${family.variantIndex}`),
    title: String(rawVariant.title || family.title),
    label: variantLabel(rawVariant),
    color: rawVariant.color || null,
    size: rawVariant.size || null,
    orientation: rawVariant.orientation || null,
    dimensions: rawVariant.dimensions || null,
    material: rawVariant.material || null,
    capacity: rawVariant.capacity || null,
    configuration: rawVariant.configuration || null,
    images: images.length ? images : [family.image].filter(Boolean),
    offers: deduplicatedOffers
  };
}

export function categoryGroup(category) {
  const normalized = normalizeText(category);
  const direct = GROUP_BY_ALIAS.get(normalized);
  if (direct) return direct;
  const partial = CATEGORY_GROUPS.find((group) =>
    group.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized);
    })
  );
  return partial || {
    name: String(category || "Otros"),
    icon: "＋",
    aliases: [String(category || "Otros")]
  };
}

function fallbackSecretScore(family) {
  let score = 5;
  if (family.description.length >= 80) score += 0.75;
  if (family.images.length >= 2) score += 0.55;
  if (family.images.length >= 4) score += 0.35;
  if (family.variants.length > 1) score += 0.65;
  if (family.offers.length > 1) score += 0.45;
  if (family.offers.some((offer) => offerTotal(offer) !== null)) score += 0.55;
  if (family.offers.every((offer) => isVisibleAvailability(offer.availability))) score += 0.55;
  if (family.offers.some((offer) => discountPercent(offer) > 0)) score += 0.35;
  if (family.offers.some((offer) => offer.isStale)) score -= 0.4;
  return Number(clamp(score, 1, 9.8).toFixed(1));
}

export function normalizeFamily(rawFamily, source = {}) {
  if (!rawFamily || typeof rawFamily !== "object") return null;
  const title = String(rawFamily.title || rawFamily.name || "").trim();
  const id = String(rawFamily.id || "").trim();
  const image = uniqueStrings([
    rawFamily.image,
    ...asArray(rawFamily.images)
  ]).find(isRealImage);
  if (!id || !title || !image) return null;

  const rawCategories = uniqueStrings([
    rawFamily.category,
    ...asArray(rawFamily.categories)
  ]);
  const groups = uniqueStrings(
    rawCategories.map((category) => categoryGroup(category).name)
  );
  const familyShell = {
    id,
    title,
    image,
    variantIndex: 0
  };
  const variants = asArray(rawFamily.variants)
    .map((variant, index) => {
      familyShell.variantIndex = index;
      return normalizeVariant(variant, familyShell, {
        country: source.country || rawFamily.country,
        currency: source.currency || rawFamily.currency,
        merchantId: source.merchantId || rawFamily.merchantId,
        merchantName: source.merchantName || rawFamily.merchantName
      });
    })
    .filter(Boolean);

  if (variants.length === 0) return null;

  const offers = [
    ...new Map(
      variants.flatMap((variant) => variant.offers).map((offer) => [offer.id, offer])
    ).values()
  ];
  const images = uniqueStrings([
    image,
    ...asArray(rawFamily.images),
    ...variants.flatMap((variant) => variant.images)
  ]).filter(isRealImage);
  const numericPrices = offers.map(offerTotal).filter(Number.isFinite);
  const countries = uniqueStrings(offers.map((offer) => offer.country));
  const stores = uniqueStrings(offers.map((offer) => offer.merchantName));
  const brand = String(rawFamily.brand || source.brand || "Selección").trim();
  const description = String(rawFamily.description || "").trim();

  const family = {
    id,
    slug: String(rawFamily.slug || slugify(`${brand}-${title}`)),
    title,
    brand,
    model: rawFamily.model || null,
    category: rawFamily.category || rawCategories[0] || groups[0] || "Otros",
    categories: rawCategories.length ? rawCategories : groups,
    groups,
    primaryGroup: groups[0] || categoryGroup(rawCategories[0]).name,
    description,
    image,
    images,
    variants,
    offers,
    variantCount: variants.length,
    offerCount: offers.length,
    countries,
    stores,
    source: source.id || rawFamily.source || "catalog",
    generatedAt: source.generatedAt || null,
    minPrice: numericPrices.length ? Math.min(...numericPrices) : null,
    maxPrice: numericPrices.length ? Math.max(...numericPrices) : null,
    maxDiscount: Math.max(0, ...offers.map(discountPercent)),
    secretScore: null,
    createdAt: rawFamily.createdAt || source.generatedAt || "1970-01-01"
  };

  const providedScore = Number(rawFamily.secretScore);
  family.secretScore = Number.isFinite(providedScore)
    ? clamp(providedScore, 0, 10)
    : fallbackSecretScore(family);
  family.searchIndex = buildSearchIndex(family);
  return family;
}

export function mergeCatalogPayloads(sources) {
  const families = [];
  const ids = new Set();
  const warnings = [];

  for (const source of asArray(sources)) {
    const payload = source?.payload;
    if (!payload || !Array.isArray(payload.families)) {
      warnings.push(`${source?.id || "fuente"}: formato no compatible`);
      continue;
    }

    for (const rawFamily of payload.families) {
      const family = normalizeFamily(rawFamily, {
        ...source,
        generatedAt: payload.generatedAt
      });
      if (!family) continue;
      if (ids.has(family.id)) {
        warnings.push(`Familia duplicada omitida: ${family.id}`);
        continue;
      }
      ids.add(family.id);
      families.push(family);
    }
  }

  families.sort((left, right) =>
    left.title.localeCompare(right.title, "es", { sensitivity: "base" })
  );

  return {
    families,
    warnings,
    stats: catalogStats(families)
  };
}

export function buildSearchIndex(family) {
  const base = normalizeText([
    family.title,
    family.brand,
    family.model,
    family.description,
    ...family.categories,
    ...family.groups,
    ...family.stores,
    ...family.variants.flatMap((variant) => [
      variant.title,
      variant.label,
      variant.color,
      variant.size,
      variant.dimensions,
      variant.material
    ])
  ].filter(Boolean).join(" "));

  const expanded = new Set(base.split(/\s+/).filter(Boolean));
  for (const token of [...expanded]) {
    for (const synonym of SEARCH_SYNONYMS[token] || []) {
      expanded.add(synonym);
    }
  }
  return [...expanded].join(" ");
}

export function tokenizeQuery(query) {
  return normalizeText(query)
    .split(/\s+/)
    .filter((token) => token && (!STOP_WORDS.has(token) || token.length > 3));
}

function withinOneEdit(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return true;
}

export function smartSearchScore(family, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0;

  const title = normalizeText(family.title);
  const brand = normalizeText(family.brand);
  const categories = normalizeText([...family.categories, ...family.groups].join(" "));
  const haystack = family.searchIndex || buildSearchIndex(family);
  const words = haystack.split(/\s+/);
  let score = title.includes(normalizedQuery) ? 80 : 0;

  for (const token of tokens) {
    const alternatives = [token, ...(SEARCH_SYNONYMS[token] || [])];
    let best = -1;
    for (const alternative of alternatives) {
      if (title.split(" ").includes(alternative)) best = Math.max(best, 28);
      else if (title.includes(alternative)) best = Math.max(best, 22);
      if (brand.includes(alternative)) best = Math.max(best, 18);
      if (categories.includes(alternative)) best = Math.max(best, 15);
      if (haystack.includes(alternative)) best = Math.max(best, 9);
      if (
        alternative.length >= 4 &&
        words.some((word) => word.length >= 4 && withinOneEdit(alternative, word))
      ) {
        best = Math.max(best, 5);
      }
    }
    if (best < 0) return -1;
    score += best;
  }

  score += family.secretScore * 0.25;
  score += Math.min(family.variantCount, 8) * 0.08;
  return score;
}

export function bestOffer(family, preferredCountry = null) {
  const candidates = family.offers.filter((offer) =>
    !preferredCountry || preferredCountry === "all" || offer.country === preferredCountry
  );
  const numeric = candidates
    .filter((offer) => offerTotal(offer) !== null)
    .sort((left, right) => offerTotal(left) - offerTotal(right));
  return numeric[0] || candidates[0] || family.offers[0] || null;
}

export function filterAndSortFamilies(families, filters = {}) {
  const {
    query = "",
    category = "all",
    country = "all",
    store = "all",
    sort = "relevance",
    minimumPrice = null,
    maximumPrice = null,
    discountOnly = false,
    multipleVariants = false,
    favorites = null
  } = filters;

  const favoriteSet = favorites instanceof Set ? favorites : null;
  const results = [];

  for (const family of families) {
    if (
      category !== "all" &&
      ![...family.categories, ...family.groups]
        .map(normalizeText)
        .includes(normalizeText(category))
    ) {
      continue;
    }
    if (country !== "all" && !family.countries.includes(country)) continue;
    if (store !== "all" && !family.stores.includes(store)) continue;
    if (favoriteSet && !favoriteSet.has(family.id)) continue;
    if (discountOnly && family.maxDiscount <= 0) continue;
    if (multipleVariants && family.variantCount < 2) continue;
    if (
      Number.isFinite(minimumPrice) &&
      (family.minPrice === null || family.minPrice < minimumPrice)
    ) {
      continue;
    }
    if (
      Number.isFinite(maximumPrice) &&
      (family.minPrice === null || family.minPrice > maximumPrice)
    ) {
      continue;
    }

    const relevance = smartSearchScore(family, query);
    if (relevance < 0) continue;
    results.push({ family, relevance });
  }

  results.sort((left, right) => {
    if (sort === "price-asc") {
      return (left.family.minPrice ?? Infinity) - (right.family.minPrice ?? Infinity) ||
        right.family.secretScore - left.family.secretScore;
    }
    if (sort === "score-desc") {
      return right.family.secretScore - left.family.secretScore ||
        right.family.variantCount - left.family.variantCount;
    }
    if (sort === "discount-desc") {
      return right.family.maxDiscount - left.family.maxDiscount ||
        right.family.secretScore - left.family.secretScore;
    }
    if (sort === "variants-desc") {
      return right.family.variantCount - left.family.variantCount ||
        right.family.secretScore - left.family.secretScore;
    }
    return right.relevance - left.relevance ||
      right.family.secretScore - left.family.secretScore ||
      right.family.variantCount - left.family.variantCount;
  });

  return results.map((result) => result.family);
}

export function catalogStats(families) {
  const variants = families.reduce((sum, family) => sum + family.variantCount, 0);
  const offers = families.reduce((sum, family) => sum + family.offerCount, 0);
  const countries = uniqueStrings(families.flatMap((family) => family.countries));
  const stores = uniqueStrings(families.flatMap((family) => family.stores));
  return {
    families: families.length,
    variants,
    offers,
    countries,
    stores
  };
}

export function categoryStats(families) {
  const counts = new Map();
  for (const family of families) {
    const groupNames = new Set(family.groups);
    for (const groupName of groupNames) {
      counts.set(groupName, (counts.get(groupName) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      icon: CATEGORY_GROUPS.find((group) => group.name === name)?.icon || "＋"
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "es"));
}

export function filterOptions(families) {
  const grouped = categoryStats(families).map((entry) => entry.name);
  const rawCategories = uniqueStrings(
    families.flatMap((family) => family.categories)
  )
    .filter((category) => !grouped.includes(category))
    .sort((left, right) => left.localeCompare(right, "es"));
  return {
    categoryGroups: grouped,
    rawCategories,
    countries: uniqueStrings(families.flatMap((family) => family.countries))
      .sort()
      .map((code) => ({ code, label: countryLabel(code) })),
    stores: uniqueStrings(families.flatMap((family) => family.stores))
      .sort((left, right) => left.localeCompare(right, "es"))
  };
}

export function getSuggestions(families, query, limit = 7) {
  const normalized = normalizeText(query);
  if (!normalized || normalized.length < 2) return [];
  const suggestions = [];
  const categoryMatches = categoryStats(families)
    .filter((entry) => normalizeText(entry.name).includes(normalized))
    .slice(0, 2)
    .map((entry) => ({
      type: "category",
      value: entry.name,
      label: entry.name,
      meta: `${entry.count.toLocaleString("es-ES")} familias`,
      image: null
    }));
  suggestions.push(...categoryMatches);

  const productMatches = families
    .map((family) => ({ family, score: smartSearchScore(family, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, limit - suggestions.length))
    .map(({ family }) => ({
      type: "product",
      value: family.id,
      label: family.title,
      meta: `${family.primaryGroup} · ${family.brand}`,
      image: family.image
    }));
  suggestions.push(...productMatches);
  return suggestions.slice(0, limit);
}

export function selectDiverseFamilies(families, limit = 3) {
  const ordered = families
    .filter((family) => family.image)
    .sort((left, right) =>
      right.secretScore - left.secretScore ||
      right.variantCount - left.variantCount
    );
  const output = [];
  const usedGroups = new Set();
  const usedCountries = new Set();

  for (const family of ordered) {
    const addsDiversity =
      !usedGroups.has(family.primaryGroup) ||
      family.countries.some((country) => !usedCountries.has(country));
    if (!addsDiversity && output.length < limit - 1) continue;
    output.push(family);
    usedGroups.add(family.primaryGroup);
    family.countries.forEach((country) => usedCountries.add(country));
    if (output.length >= limit) break;
  }

  for (const family of ordered) {
    if (output.length >= limit) break;
    if (!output.some((item) => item.id === family.id)) output.push(family);
  }
  return output;
}

export function topDeals(families, limit = 12) {
  return families
    .filter((family) => family.maxDiscount > 0 && family.minPrice !== null)
    .sort((left, right) =>
      right.maxDiscount - left.maxDiscount ||
      right.secretScore - left.secretScore
    )
    .slice(0, limit);
}

export function topScored(families, limit = 8) {
  return [...families]
    .sort((left, right) =>
      right.secretScore - left.secretScore ||
      right.variantCount - left.variantCount
    )
    .slice(0, limit);
}

export function relatedFamilies(families, family, limit = 4) {
  return families
    .filter((candidate) =>
      candidate.id !== family.id &&
      candidate.groups.some((group) => family.groups.includes(group))
    )
    .sort((left, right) =>
      right.secretScore - left.secretScore ||
      Math.abs((left.minPrice ?? 0) - (family.minPrice ?? 0))
    )
    .slice(0, limit);
}

export function categoryGuide(category) {
  const group = categoryGroup(category).name;
  const guides = {
    Hogar: {
      title: "Antes de comprar para el hogar",
      intro: "Comprueba siempre las medidas reales del espacio, los accesos, el montaje y el coste de entrega.",
      points: ["Mide ancho, alto y profundidad", "Revisa materiales y mantenimiento", "Confirma entrega, subida y montaje"]
    },
    Tecnología: {
      title: "Antes de elegir tecnología",
      intro: "La compatibilidad y la variante exacta importan tanto como el precio anunciado.",
      points: ["Confirma modelo y conectividad", "Compara capacidad y versión", "Revisa garantía y vendedor"]
    },
    Moda: {
      title: "Antes de elegir moda",
      intro: "Consulta la tabla de medidas de cada vendedor y no asumas que una talla es idéntica entre marcas.",
      points: ["Comprueba medidas, no solo talla", "Revisa composición y cuidados", "Confirma devolución y coste"]
    },
    "Belleza y cuidado": {
      title: "Antes de comprar belleza y cuidado",
      intro: "Revisa composición, formato, cantidad y modo de uso directamente en la ficha de la tienda.",
      points: ["Comprueba cantidad y variante", "Lee ingredientes y advertencias", "Evita atribuir efectos no demostrados"]
    }
  };
  return guides[group] || {
    title: `Antes de comprar en ${group}`,
    intro: "Compara la variante exacta, el precio total, la disponibilidad y las condiciones de la tienda.",
    points: ["Confirma el modelo correcto", "Revisa envío y devolución", "Comprueba el precio final"]
  };
}
