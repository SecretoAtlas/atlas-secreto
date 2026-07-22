# Cargador y conexión visual del catálogo Awin

## Estado actual

El catálogo está publicado mediante:

```json
{
  "enabled": true,
  "autoStart": true,
  "includeUnavailableOffers": false
}
```

El navegador carga los JSON de `data/catalog`, valida los merchants aprobados, adapta los productos al formato visual de SecretShop y los integra con el catálogo estático existente.

## Flujo de carga

1. `scripts/catalog-bootstrap.js` lee `catalog-runtime.json`.
2. `scripts/catalog-loader.js` carga `merchants.json`, `products.json` y `offers.json`.
3. Se conservan únicamente merchants aprobados y ofertas válidas para el país/moneda activos.
4. `scripts/catalog-ui-adapter.js` convierte el modelo normalizado al modelo de tarjetas de SecretShop.
5. Se emite `secretshop:awin-catalog-ready` con `detail.uiProducts`.
6. `index.html` fusiona los productos Awin con las fuentes estáticas y vuelve a renderizar tiendas, categorías, resultados e inventario.

## Archivos

- `data/catalog/catalog-runtime.json`: publicación, país y opciones del cargador.
- `data/catalog/catalog-config.json`: países, matching, frescura y nombres de archivos auxiliares.
- `data/catalog/category-taxonomy.json`: categorías y jerarquía.
- `scripts/catalog-loader.js`: carga y filtrado del catálogo.
- `scripts/catalog-ui-adapter.js`: adaptación de productos y ofertas a la interfaz.
- `scripts/catalog-bootstrap.js`: arranque y eventos.
- `scripts/catalog-loader.test.mjs`: pruebas del cargador.
- `scripts/catalog-ui-adapter.test.mjs`: pruebas del adaptador.
- `scripts/validate-catalog.mjs`: validación integral de JSON.

## Categorías de Hogar

La categoría general `Hogar` se mantiene en la portada. Sus subcategorías aparecen en el filtro como:

```text
Hogar › Sofás
Hogar › Sillas y sillones
Hogar › Bancos, pufs y reposapiés
Hogar › Camas y colchones
Hogar › Mesas y escritorios
Hogar › Almacenaje
Hogar › Iluminación
Hogar › Textiles y cojines
Hogar › Jardín y terraza
Hogar › Cocina y comedor
Hogar › Decoración y accesorios
```

Las subcategorías no generan secciones duplicadas en la portada; sirven para filtrar el catálogo con más precisión.

## Seguridad y calidad

- Solo publica merchants con estado `approved`.
- Exige enlaces afiliados HTTPS.
- Comprueba país y moneda.
- Excluye por defecto ofertas agotadas, no disponibles o descatalogadas.
- Puede marcar ofertas antiguas como `isStale` sin retirarlas inmediatamente.
- No mezcla productos con identificadores incompatibles.
- Calcula el precio total con transporte cuando el feed informa el coste.
- Añade dinámicamente `Menos de 10` cuando el precio total es inferior al umbral.

## Objetos y eventos disponibles

```js
window.SecretShopAwinCatalog
window.CATALOG_AWIN
```

Eventos:

```text
secretshop:awin-catalog-disabled
secretshop:awin-catalog-ready
secretshop:awin-catalog-error
```

## Desactivación de emergencia

Cambiar en `data/catalog/catalog-runtime.json`:

```json
"enabled": false
```

El sitio conservará el catálogo estático y dejará de incorporar los productos Awin.

## Verificación

```bash
node --test scripts/catalog-loader.test.mjs scripts/catalog-ui-adapter.test.mjs
node scripts/validate-catalog.mjs
```
