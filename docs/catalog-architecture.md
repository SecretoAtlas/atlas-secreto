# Arquitectura del catálogo de SecretShop

## Objetivo

Separar el producto canónico de las ofertas de cada tienda. Un producto representa un artículo y una variante exacta; una oferta representa su disponibilidad en un merchant concreto.

## Fuentes de datos

Solo se incorporarán feeds o APIs autorizados. No se hará scraping de tiendas. Cada importador debe conservar el identificador original del merchant y la fecha de actualización.

## Coincidencia de productos

Orden de prioridad:

1. GTIN/EAN/UPC idéntico.
2. MPN o referencia del fabricante idéntica.
3. Marca + modelo + variante exactos.
4. Revisión manual.

Los productos que solo se parecen se muestran como **Alternativas similares**. No se fusionan como el mismo producto.

## Archivos

- `catalog-config.json`: países, monedas, frescura y reglas de coincidencia.
- `merchants.json`: anunciantes y estado de aprobación.
- `products.json`: productos canónicos.
- `offers.json`: ofertas de cada merchant.
- `product.example.json`: ejemplo de producto.
- `offer.example.json`: ejemplo de oferta.

## Reglas de publicación

- No publicar una oferta sin URL afiliada HTTPS.
- No mezclar productos nuevos, reacondicionados, usados o de segunda oportunidad.
- Mostrar precio, moneda, condición, disponibilidad y última actualización.
- El precio final debe incluir envío cuando el feed proporcione el coste.
- Los productos no comisionables deben excluirse o marcarse explícitamente.
- Naturitas y categorías sanitarias: bloquear afirmaciones médicas generadas.
- reBuy: separar compra de reacondicionados de la sección para vender dispositivos.

## Flujo al aprobarse un anunciante

1. Descargar una muestra del feed.
2. Mapear sus columnas a producto y oferta.
3. Validar 20–50 productos.
4. Comprobar enlaces de Awin y aterrizaje.
5. Ejecutar `node scripts/validate-catalog.mjs`.
6. Publicar el catálogo completo.
7. Programar actualización y retirada de ofertas obsoletas.
