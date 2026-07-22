#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { parseArguments, printHelp } from "./import-awin.mjs";
import { importAwinFeed } from "./lib/awin-catalog-core.mjs";

export { importAwinFeed as importMueblesStyle };

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.inputPath) {
    printHelp();
    throw new Error("Falta la ruta del feed de Muebles Style");
  }

  options.merchantId = "muebles-style-spain";
  const { report } = await importAwinFeed(options);
  console.log(
    [
      `Feed: ${report.sourceFile}`,
      `Modo: ${report.mode}`,
      `Filas: ${report.totals.feedRows}`,
      `Aceptadas: ${report.totals.acceptedRows}`,
      `Omitidas: ${report.totals.skippedRows}`,
      `Productos: ${report.output.products}`,
      `Ofertas: ${report.output.offers}`
    ].join("\n")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[SecretShop] ${error.message}`);
    process.exitCode = 1;
  });
}
