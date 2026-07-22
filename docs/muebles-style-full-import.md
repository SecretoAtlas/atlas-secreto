# Importación completa de Muebles Style Spain

## Resultado

- Filas del feed: **3.111**
- Productos aceptados: **3.110**
- Productos omitidos: **1**
- Ofertas publicadas: **3.110**
- Conflictos de identificadores: **0**
- Moneda: **EUR**
- Merchant Awin: **122118**
- Feed Awin: **112474**

La única fila omitida es:

```text
KA110497 — Alfombrilla universal «Billete de 100 DÓLARES» 28 x 20 cm
```

Motivo: no contiene GTIN/EAN/UPC ni otro identificador exacto admitido por el perfil de Muebles Style.

## Distribución por categorías

| Categoría | Productos |
|---|---:|
| Sofás | 1.620 |
| Sillas y sillones | 485 |
| Bancos, pufs y reposapiés | 347 |
| Camas y colchones | 275 |
| Mesas y escritorios | 188 |
| Almacenaje | 107 |
| Textiles y cojines | 33 |
| Iluminación | 25 |
| Jardín y terraza | 25 |
| Cocina y comedor | 5 |
| **Total** | **3.110** |

Todos estos productos pertenecen además al departamento general `Hogar`.

## Informes técnicos

- `data/catalog/import-reports/muebles-style-last.json`
- `data/catalog/import-reports/muebles-style-universal-dry-run.json`

## Publicación

La entrega incluye `catalog-runtime.json` con el catálogo activado. Una vez desplegados todos los archivos, los productos se incorporarán a la interfaz pública de SecretShop.
