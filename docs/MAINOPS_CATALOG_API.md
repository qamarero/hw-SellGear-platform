# Catálogo interno para Qamarero

`GET /api/external/catalog/products` permite consultar todas las filas de
`public.products`, incluidas las inactivas y sus notas internas, desde el
conector `mainops_readonly`. Sólo admite `GET` y exige `X-API-Key` con la
clave `QARVIS_API_KEY` configurada en MainOps. No hay escrituras.

Parámetros opcionales:

| Parámetro | Uso |
| --- | --- |
| `code` | Código exacto del producto. |
| `active` | `true` o `false`; sin filtro devuelve ambos estados. |
| `limit` | De 1 a 100; por defecto 100. |
| `offset` | Desde 0; para paginar. |

La respuesta contiene `generated_at`, `pagination` (`total`, `limit`,
`offset`) y `products` con los campos íntegros de cada ficha. Los importes
`price_cents` están en céntimos sin IVA; `vat_rate` es el tipo aplicable.

La ruta no se debe consumir desde un navegador público: devuelve datos
internos y está destinada al conector local de Qamarero. La clave permanece
en la configuración del MCP y en el entorno de Vercel, nunca en el repositorio.
