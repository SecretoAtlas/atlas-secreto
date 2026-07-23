# Importador de Muebles Style Spain

## Objetivo

Convertir el feed oficial de Awin de Muebles Style en los archivos canónicos de SecretShop:

- `data/catalog/products.json`
- `data/catalog/offers.json`

No realiza scraping ni necesita dependencias de npm. Acepta el CSV o el ZIP descargado desde **Awin → Herramientas → Crea-un-feed**.

## Reglas de coincidencia

1. Normaliza GTIN, EAN y UPC a una clave GTIN-14 y valida su dígito de control.
2. Busca un producto existente con esa clave exacta.
3. Como respaldo, utiliza marca + MPN exactos.
4. Omite cualquier fila sin identificador exacto. No fusiona productos por parecido de nombre.
5. Si varios identificadores apuntan a productos distintos, registra el conflicto y no importa la fila.

## Primera prueba de 50 productos

Desde la raíz del repositorio:

```bash
node scripts/import-muebles-style.mjs "RUTA/AL/FEED.zip" --limit 50
node scripts/validate-catalog.mjs
node --test scripts/import-muebles-style.test.mjs scripts/catalog-loader.test.mjs
```

`--limit` está pensado para la primera prueba. Si ya existen ofertas de Muebles Style, el importador bloquea una sustitución parcial salvo que se añada deliberadamente `--allow-partial-replace`.

## Importación completa

```bash
node scripts/import-muebles-style.mjs "RUTA/AL/FEED.zip"
node scripts/validate-catalog.mjs
```

Cada ejecución completa:

- conserva productos y ofertas de otros merchants;
- sustituye todas las ofertas anteriores de Muebles Style;
- actualiza o crea productos mediante identificadores exactos;
- elimina productos huérfanos sin ninguna oferta;
- genera `data/catalog/import-reports/muebles-style-last.json`.

## Simulación sin modificar el catálogo

```bash
node scripts/import-muebles-style.mjs "RUTA/AL/FEED.zip" --dry-run
```

La simulación analiza todo el feed y escribe únicamente el informe.

## Campos principales

Producto:

- título, marca y modelo;
- categoría canónica;
- GTIN/EAN/UPC/MPN;
- condición;
- imágenes;
- descripción y especificaciones resumidas;
- referencias de origen.

Oferta:

- precio, precio anterior y envío;
- disponibilidad y stock;
- enlace afiliado Awin HTTPS;
- enlace de destino;
- condición, país y moneda;
- fecha de actualización;
- identificadores originales de Awin.

## Seguridad operativa

- El importador exige que `muebles-style-spain` figure como `approved` en `merchants.json`.
- No almacena la URL privada de descarga del feed.
- `catalog-runtime.json` debe permanecer con `enabled: false` hasta revisar el piloto en la web.
