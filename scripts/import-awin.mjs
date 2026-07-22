#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_CATALOG_DIR, importAwinFeed } from "./lib/awin-catalog-core.mjs";

export function printHelp() {
  console.log(`Uso:
  node scripts/import-awin.mjs <feed.csv|feed.zip> [opciones]

Opciones:
  --merchant <id>            ID interno del merchant en merchants.json.
                              Es opcional si awinAdvertiserId identifica uno solo.
  --catalog-dir <ruta>       Carpeta del catálogo. Por defecto: data/catalog
  --profiles <ruta>          Perfiles de importación. Por defecto: data/catalog/awin-import-profiles.json
  --taxonomy <ruta>          Taxonomía de categorías. Por defecto: data/catalog/category-taxonomy.json
  --limit <n>                Importa solo los primeros n productos válidos.
  --dry-run                  Valida y genera informe sin modificar products.json ni offers.json.
  --keep-orphans             Conserva productos que se queden sin ofertas.
  --allow-partial-replace    Permite usar --limit aunque ya existan ofertas del merchant.
  --generated-at <ISO>       Fecha ISO utilizada como actualización del feed.
  --report <ruta>            Ruta del informe JSON.
  --help                     Muestra esta ayuda.

El importador acepta directamente el ZIP o CSV descargado de Awin y no necesita npm install.`);
}

export function parseArguments(argv) {
  const options = {
    inputPath: null,
    merchantId: null,
    catalogDir: DEFAULT_CATALOG_DIR,
    profilesPath: null,
    taxonomyPath: null,
    limit: null,
    dryRun: false,
    pruneOrphans: true,
    allowPartialReplace: false,
    generatedAt: new Date().toISOString(),
    reportPath: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--keep-orphans") {
      options.pruneOrphans = false;
    } else if (argument === "--allow-partial-replace") {
      options.allowPartialReplace = true;
    } else if (argument === "--merchant") {
      options.merchantId = String(argv[++index] ?? "").trim();
      if (!options.merchantId) throw new Error("--merchant requiere un ID");
    } else if (argument === "--catalog-dir") {
      options.catalogDir = resolve(argv[++index] ?? "");
    } else if (argument === "--profiles") {
      options.profilesPath = resolve(argv[++index] ?? "");
    } else if (argument === "--taxonomy") {
      options.taxonomyPath = resolve(argv[++index] ?? "");
    } else if (argument === "--limit") {
      const limit = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error("--limit debe ser un entero positivo");
      }
      options.limit = limit;
    } else if (argument === "--generated-at") {
      const generatedAt = argv[++index] ?? "";
      if (!Number.isFinite(Date.parse(generatedAt))) {
        throw new Error("--generated-at debe ser una fecha ISO válida");
      }
      options.generatedAt = new Date(generatedAt).toISOString();
    } else if (argument === "--report") {
      options.reportPath = resolve(argv[++index] ?? "");
    } else if (argument.startsWith("--")) {
      throw new Error(`Opción desconocida: ${argument}`);
    } else if (!options.inputPath) {
      options.inputPath = resolve(argument);
    } else {
      throw new Error(`Argumento inesperado: ${argument}`);
    }
  }

  options.catalogDir = resolve(options.catalogDir);
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    printHelp();
    return null;
  }
  if (!options.inputPath) {
    printHelp();
    throw new Error("Falta la ruta del feed");
  }

  const result = await importAwinFeed(options);
  const { report } = result;
  console.log(
    [
      `Merchant: ${report.merchantName} (${report.merchantId})`,
      `Feed: ${report.sourceFile}`,
      `Modo: ${report.mode}`,
      `Filas: ${report.totals.feedRows}`,
      `Aceptadas: ${report.totals.acceptedRows}`,
      `Omitidas: ${report.totals.skippedRows}`,
      `Productos creados: ${report.totals.productsCreated}`,
      `Productos actualizados: ${report.totals.productsUpdated}`,
      `Ofertas escritas: ${report.totals.offersWritten}`,
      `Informe: ${options.reportPath || `data/catalog/import-reports/${report.merchantId}-last.json`}`
    ].join("\n")
  );

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[SecretShop] ${error.message}`);
    process.exitCode = 1;
  });
}
