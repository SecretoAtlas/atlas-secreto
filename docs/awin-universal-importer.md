# Importador universal de feeds Awin

## Objetivo

`import-awin.mjs` convierte un feed oficial de Awin, en CSV o ZIP, al catálogo normalizado de SecretShop. El mismo importador sirve para los anunciantes registrados en `merchants.json`; las diferencias de cada tienda se definen mediante perfiles, sin duplicar la lógica de importación.

No realiza scraping ni consulta páginas de producto. Utiliza exclusivamente los datos incluidos en el feed de afiliación.

## Archivos principales

- `scripts/import-awin.mjs`: interfaz de línea de comandos.
- `scripts/lib/awin-catalog-core.mjs`: normalización, matching, categorías y escritura del catálogo.
- `scripts/lib/awin-feed-utils.mjs`: lector ZIP, parser CSV y utilidades.
- `data/catalog/awin-import-profiles.json`: configuración general y reglas específicas por merchant.
- `data/catalog/category-taxonomy.json`: taxonomía común de SecretShop.
- `data/catalog/merchants.json`: anunciantes y estado de aprobación.
- `data/catalog/products.json`: productos normalizados.
- `data/catalog/offers.json`: ofertas por tienda.
- `data/catalog/import-reports/`: informes de cada ejecución.

## Uso

Desde la raíz del repositorio:

```bash
node scripts/import-awin.mjs ruta/al/feed.zip
```

El merchant se detecta automáticamente mediante `merchant_id`/`advertiser_id` del feed y `awinAdvertiserId` de `merchants.json`.

También puede indicarse explícitamente:

```bash
node scripts/import-awin.mjs ruta/al/feed.zip --merchant muebles-style-spain
```

### Validación sin modificar el catálogo

```bash
node scripts/import-awin.mjs ruta/al/feed.zip --dry-run
```

### Piloto limitado

```bash
node scripts/import-awin.mjs ruta/al/feed.zip --limit 50
```

Si ya existen ofertas de ese merchant, un piloto no puede sustituirlas accidentalmente. Para permitirlo de forma consciente:

```bash
node scripts/import-awin.mjs ruta/al/feed.zip --limit 50 --allow-partial-replace
```

### Opciones disponibles

```text
--merchant <id>            Merchant interno de merchants.json
--catalog-dir <ruta>       Carpeta del catálogo
--profiles <ruta>          Perfiles de importación
--taxonomy <ruta>          Taxonomía de categorías
--limit <n>                Límite de productos válidos
--dry-run                  No modifica products.json ni offers.json
--keep-orphans             Conserva productos sin ofertas
--allow-partial-replace    Permite reemplazo parcial con --limit
--generated-at <ISO>       Fecha de actualización del feed
--report <ruta>            Destino personalizado del informe
```

## Requisitos para incorporar una tienda nueva

1. El anunciante debe figurar en `merchants.json` con un `id` único, su `awinAdvertiserId`, país y estado `approved`.
2. Si el feed necesita reglas particulares, añadir un bloque bajo `merchants` en `awin-import-profiles.json`.
3. Ejecutar primero `--dry-run` y revisar el informe.
4. Validar una muestra si el mapeo del feed difiere del estándar.
5. Ejecutar la importación completa y las pruebas.

Ejemplo mínimo de perfil:

```json
{
  "mi-tienda": {
    "country": "ES",
    "currency": "EUR",
    "department": "Tecnología",
    "fallbackCategory": "Tecnología",
    "requireGlobalIdentifier": true
  }
}
```

## Matching exacto

El orden de coincidencia es:

1. GTIN, EAN o UPC normalizado y validado.
2. Marca + MPN.
3. Marca + modelo + variante completa, solo cuando no existe un identificador más fuerte.

Una fila con un GTIN nuevo no se fusiona con otro producto por una coincidencia más débil de modelo o variante. Los productos similares permanecen separados y pueden mostrarse como «Alternativas similares».

## Sustitución de ofertas

Una importación completa reemplaza únicamente las ofertas del merchant procesado. Las ofertas de otras tiendas se conservan. Después del reemplazo, el importador elimina productos huérfanos salvo que se utilice `--keep-orphans`.

La escritura de JSON es atómica para evitar archivos parciales en caso de error.

## Categorías

La clasificación se basa en:

- categoría del merchant;
- tipo de producto;
- categoría Awin;
- título;
- palabras clave.

Primero se aplican las reglas específicas del merchant y después las reglas genéricas de la taxonomía. Cada producto conserva una categoría principal y un departamento, por ejemplo:

```text
Hogar → Sofás
Hogar → Sillas y sillones
Hogar → Mesas y escritorios
```

## Verificación

```bash
node --test \
  scripts/catalog-loader.test.mjs \
  scripts/catalog-ui-adapter.test.mjs \
  scripts/import-awin.test.mjs

node scripts/validate-catalog.mjs
```

## Protección de enlaces de afiliado

El importador usa `aw_deep_link` como fuente prioritaria de `affiliateUrl` y conserva `merchant_deep_link` únicamente como `landingUrl` informativa. Una oferta de Awin no se importa si falta un enlace de tracking HTTPS válido.

La validación del catálogo comprueba además que cada enlace Awin:

- pertenece a `awin1.com`;
- usa una ruta de clic reconocida (`pclick.php` o `cread.php`);
- contiene el identificador del afiliado (`a`);
- contiene el identificador del producto (`p`);
- contiene el anunciante correcto (`m`), coincidente con `merchants.json` y con la fuente de la oferta.

Para auditar todos los enlaces:

```bash
node scripts/audit-affiliate-links.mjs
```

El informe se guarda en `data/catalog/affiliate-audit.json`.
