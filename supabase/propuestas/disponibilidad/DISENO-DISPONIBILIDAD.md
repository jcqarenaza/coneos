# Diseño de disponibilidad con factor de stock

Orden CTO 4/11, punto 2 · solo diseño (no se tocó el repo ni Supabase) · fondo blanco

## 0. En cinco líneas

1. Hoy **no hay ninguna indicación** cuando el stock alcanza para el producto pero no para una presentación (caja x8 con 5 en stock): la card se ve normal y falla recién al confirmar, con un 409 de texto genérico.
2. Regla única: una presentación está **disponible** si `stock − ya_comprometido >= factor_stock` (equivale a `floor(restante / factor) >= 1`). No disponible = se ve, gris, con leyenda y el "+" bloqueado.
3. El cálculo se hace en **dos lugares con el mismo helper puro**: el servidor lo calcula contra el stock real de la sucursal y lo manda en el catálogo; el cliente lo recalcula restando lo que ya hay en el carrito (varias presentaciones del mismo producto comparten el mismo stock físico).
4. El servidor sigue siendo la autoridad: la RPC aprobada **no se toca**. Solo cambia el cuerpo del 409 en `/api/pedidos` (agrega un código y el producto) para que el cliente reaccione bien.
5. Se entrega un helper `disponibilidad.ts` con 13 pruebas de Node en verde, listo para copiar cuando el CTO dé el GO.

## 1. Estado actual por pantalla

| Superficie | Archivo | Qué hace hoy con el stock |
| --- | --- | --- |
| Catálogo (todos los canales) | `src/app/api/kiosk/catalogo/route.ts:51-72` | Lee `producto_stock` y marca `agotado` solo si `controla_stock` y `cantidad <= 0` (o sin fila). **No lee `factor_stock`** (el select de presentaciones, línea 33, no lo trae). |
| Poda por toggle | misma ruta, `:43-44, :70-72` | `empresa_config.mostrar_agotados` apagado (default): el producto agotado y todas sus presentaciones salen del catálogo. Encendido: viajan con `agotado: true`. |
| Promos | misma ruta, `:93-125` | Una promo solo viaja si todos sus slots tienen alguna presentación visible. No mira stock más allá de la poda anterior. |
| Kiosco / Mesa / Delivery / Takeaway | `src/components/kiosk/KioskCatalogo.tsx:593-640` | Si `prod.agotado`: card gris con etiqueta "Agotado" y sin botones. Si no, `+` y `−` sin tope. Mesa, delivery y takeaway montan este mismo componente con `canal=...`. |
| Novedades y promos en pantalla | `KioskCatalogo.tsx:228, 395, 400` | Filtran por `!prod.agotado` (idem `presDeSlot`). Nada por presentación. |
| Carrito | `KioskCarrito.tsx` | Cada unidad es una fila de cantidad 1. No revalida contra stock. |
| Carrito de mesa | `src/app/[empresa]/mesa/[sucursal]/page.tsx:52-66` | Se guarda en `localStorage` y se restaura hasta 2 horas después: un carrito viejo puede reaparecer con stock ya agotado. |
| Caja | `src/components/operacion/NuevoPedido.tsx:97-102, 506-535` | Usa el catálogo `canal=operacion`; los tiles no muestran ni bloquean nada por stock. Error al crear: `setError(d?.error)` (`:395-396`). |
| Confirmación (409) | `src/app/api/pedidos/route.ts:420-424` | `SIN_STOCK:<nombre>` → 409 `"No queda stock de X. Sacalo del carrito e intentá de nuevo."` Solo texto: el cliente no sabe que fue por stock. |
| Patrón existente a imitar | `KioskConfirmacionDelivery.tsx:198-201` + `delivery/…/page.tsx:469` | Para el 409 de precios ya existe `onPreciosDesactualizados` → re-precia y vuelve al carrito. |
| Realtime | `KioskCatalogo.tsx:109-170` | `catalogo_version` avisa → refetch **solo en reposo** (sin carrito, sin cantidades marcadas, 10 s sin tocar). Cada venta ya sube la versión (trigger sobre `producto_stock`). |
| Admin | `src/app/[empresa]/admin/catalogo/page.tsx:817-826` | Chip de stock por producto (`📦 N`, rojo si `<= stock_minimo`). Las presentaciones no muestran cuánto consumen ni si alcanzan. |
| Alertas de caja | `api/operacion/consulta/route.ts:47-58` | Por producto (`cantidad <= stock_minimo`). No se modifica. |

## 2. Regla única

```
consume(pres)        = factor_stock                       (entero >= 1, ya garantizado por la base)
restante(producto)   = stock − Σ (cantidad × factor) de todo lo ya comprometido del mismo producto
disponible(pres)     = restante >= factor_stock
max_unidades(pres)   = floor(restante / factor_stock)     (tope del "+")
```

- **Comprometido** = carrito + cantidades marcadas en pantalla, de **todas** las presentaciones del producto. Si hay 3 porciones en el carrito y stock 10, la caja x8 pasa a no disponible (10 − 3 = 7 < 8).
- **Motivo:** `AGOTADO` (stock <= 0) o `INSUFICIENTE` (hay stock pero no alcanza para esta presentación).
- **Producto que no controla stock:** sin límite, sin leyenda.
- **Promos con componentes:** cada unidad de cada slot elige una presentación; la promo está disponible si **existe** una elección cuyo consumo agregado por producto entra en el stock (backtracking exacto en `promoDisponible`). Un slot con cantidad 2 de la caja x8 necesita 16.
- **Decisión a confirmar por el CTO (poda):** hoy, con el toggle `mostrar_agotados` apagado, el producto con stock 0 se **oculta entero**. Lo dejo igual (es una decisión previa de producto). La regla nueva aplica a lo que **hoy se ve normal y falla al confirmar**: stock > 0 pero insuficiente para esa presentación. Eso nunca se poda: se muestra no disponible.

## 3. Dónde se calcula y contrato de la API

**Servidor (`catalogo/route.ts`)**: ya tiene `stockMap` y le agrega `factor_stock` al select de presentaciones. Campos nuevos, todos opcionales para no romper clientes viejos:

| Objeto | Campo | Tipo | Significado |
| --- | --- | --- | --- |
| presentación | `factor_stock` | number | unidades que consume (1 si no controla stock) |
| presentación | `max_unidades` | number o null | `floor(stock / factor)`; null = sin límite |
| presentación | `disponible` | boolean | `max_unidades !== 0` |
| presentación | `sin_stock_motivo` | `'AGOTADO'`, `'INSUFICIENTE'` o null | para elegir la leyenda |
| producto | `stock_unidades` | number o null | stock físico (tope 999); lo necesita el cliente para restar el carrito |
| promoción | `disponible`, `sin_stock_motivo` | boolean, string o null | resultado de `promoDisponible` |

- `agotado` (producto) sigue exactamente igual. `controla_stock` sigue sin viajar.
- **Cliente**: con `stock_unidades` y `factor_stock` recalcula en vivo contra el carrito y las cantidades marcadas (mismo helper). Sin esto el stock compartido entre presentaciones no se puede reflejar sin pegarle al servidor en cada clic.
- **Privacidad:** `stock_unidades` expone la cantidad real a quien abra el catálogo público. Alternativa si el CTO prefiere no exponerla: topear en 99 y mostrar solo "Quedan N" con N chico; el cálculo contra el carrito sigue siendo correcto mientras el stock real no supere el tope.

## 4. UX por superficie

La presentación **nunca desaparece**. Estado no disponible: fila atenuada, leyenda, botón "+" deshabilitado.

| Superficie | Cambio |
| --- | --- |
| Kiosco, mesa, delivery, takeaway (`KioskCatalogo`) | Fila de presentación: si `!disponible`, leyenda gris en lugar de los botones: **"No disponible"** (con subtexto "Por ahora no alcanza para esta presentación" si es `INSUFICIENTE`) o **"Agotado"**. Si `max_unidades <= 3`: **"Quedan 3"**, **"Queda 1"** junto al precio. El "+" se bloquea al llegar a `max_unidades`. Al subir porciones, las cajas del mismo producto se actualizan en vivo (stock compartido). |
| Promos (tira de inicio y overlay de slots) | La promo se muestra con "No disponible" si `disponible === false`; dentro del overlay, las variedades que no entran se ven atenuadas y no seleccionables. `presDeSlot` filtra por disponibilidad de presentación, no solo por `prod.agotado`. |
| Novedades | Una novedad no disponible se ve con la leyenda en vez de desaparecer de la tira (hoy se filtra por `agotado`). |
| Carrito (todos los canales) | Al abrir el carrito se revalida contra stock fresco (endpoint liviano, sección 5). Las líneas afectadas se marcan con "Ya no hay stock suficiente" y el botón Confirmar queda deshabilitado con el mensaje: "Sacá o cambiá los productos marcados para seguir". El carrito restaurado de mesa pasa por la misma revalidación. |
| Caja (`NuevoPedido`) | Tiles: gris y no clickeables si `!disponible`, leyenda "No disponible" o "Quedan N". Contador de carrito local con el mismo helper. Si el servidor igual rechaza, se muestra el mensaje del 409. La caja nunca decide por el servidor. |
| Admin (catálogo) | En cada presentación de un producto con control de stock: "Consume 8 · con el stock actual alcanza para 1" (rojo si 0). Al guardar un factor mayor al stock de la sucursal elegida: aviso "Con este factor la presentación queda no disponible hasta cargar stock". |

Textos (español rioplatense, cortos): "No disponible", "Agotado", "Quedan 3", "Queda 1", "Por ahora no alcanza para esta presentación", "Ya no hay stock suficiente", "Sacá o cambiá los productos marcados para seguir".

## 5. Confirmación: 409 `SIN_STOCK`, refresco y carrito viejo

1. **Servidor** (`/api/pedidos/route.ts:422-424`): mantener el status 409 y el texto, y agregar al JSON `codigo: 'SIN_STOCK'` y `producto: '<nombre>'`. Es solo el cuerpo de la respuesta HTTP; la RPC no cambia.
2. **Cliente** (confirmaciones de kiosco, mesa, delivery, takeaway y caja): ante `status 409 && codigo === 'SIN_STOCK'`:
   - cierra el spinner, **no** limpia el carrito;
   - pide el catálogo/disponibilidad fresco (ignora el freno de "manos quietas": acá el usuario ya está esperando una respuesta);
   - marca las líneas afectadas y vuelve a la pantalla del carrito con el mensaje: *"Se agotó {producto}. Ajustá tu pedido para continuar."*
   - reutiliza el patrón de `onPreciosDesactualizados` (nueva prop `onSinStock(producto)`).
3. **Endpoint liviano** `GET /api/kiosk/disponibilidad?empresa_id&sucursal_id`: devuelve `{ stock: {producto_id: n}, factores: {presentacion_id: n} }`. Dos lecturas chicas, sin armar el catálogo entero. Se usa al abrir el carrito, al restaurar un carrito guardado y tras un 409. Alternativa de menor código: reusar `/api/kiosk/catalogo` y descartar el resto, a costa de más lectura.
4. **Carrito viejo (mesa, 2 h en localStorage):** no se vacía nunca; se revalida al restaurar. Si algo no alcanza, queda marcado y el cliente decide.
5. **Dos clientes al mismo tiempo:** la disponibilidad mostrada es informativa; la RPC decide. El que pierde ve el flujo del punto 2.

## 6. Qué NO se toca

- `crear_pedido_stock` v1.6 (RPC aprobada): sin cambios. Sigue rechazando con `SIN_STOCK` y haciendo rollback total.
- `/api/pedidos/eliminar`, la migración, los CHECK, `bump_catalogo` y los permisos.
- Precios, pagos, ARCA, Compras y alertas de stock de caja.
- La poda por `mostrar_agotados` para stock 0 (queda como está salvo que el CTO decida otra cosa, ver sección 2).

## 7. Archivos a tocar (todos fuera de la rama Stock V2: rama propia `feature/stock-disponibilidad`)

| Archivo | Cambio |
| --- | --- |
| `src/lib/stock/disponibilidad.ts` (nuevo) + `disponibilidad.test.ts` | Helper puro (propuesto en esta carpeta) |
| `src/app/api/kiosk/catalogo/route.ts` | `factor_stock` en el select; campos nuevos de la sección 3; `disponible` por promo |
| `src/app/api/kiosk/disponibilidad/route.ts` (nuevo) | Endpoint liviano |
| `src/app/api/pedidos/route.ts` | Solo el cuerpo del 409 (`codigo`, `producto`) |
| `src/components/kiosk/KioskCatalogo.tsx` | Interfaces, fila de presentación, `presDeSlot`, novedades, promos, tope del "+" |
| `src/components/kiosk/KioskCarrito.tsx` | Líneas marcadas y Confirmar deshabilitado |
| `src/components/kiosk/KioskConfirmacion.tsx` y `src/components/delivery/KioskConfirmacionDelivery.tsx` | Manejo del 409 `SIN_STOCK` (`onSinStock`) |
| `src/app/[empresa]/kiosk/[sucursal]/page.tsx`, `mesa/[sucursal]/page.tsx`, `delivery/[sucursal]/page.tsx`, `takeaway/[sucursal]/page.tsx` | Revalidar al abrir el carrito y al restaurar; cablear `onSinStock` |
| `src/components/operacion/NuevoPedido.tsx` | Tiles no disponibles, tope local, mensaje del 409 |
| `src/app/[empresa]/admin/catalogo/page.tsx` | Línea "Consume N · alcanza para M" y aviso al guardar |

**Estimación:** 1,5 a 2 días de desarrollo y 1 día de pruebas. Depende de que la migración de Stock V2 esté aplicada solo para el aviso del admin (`factor_stock` ya existe como columna, así que el catálogo funciona igual con factor 1).

**Riesgos:**

- Mostrar `stock_unidades` en un endpoint público (sección 3).
- El realtime solo refresca en reposo: por eso la revalidación explícita al abrir el carrito y tras el 409.
- Cada venta sube `catalogo_version` y dispara refetch en todos los dispositivos de la sucursal (ya ocurre hoy; la carga del catálogo no cambia salvo por el select extra).
- Las promos con muchas variedades y cantidades grandes pueden encarecer el backtracking; con los tamaños reales (pocos slots) es inmediato, y el servidor puede cortar a una elección voraz si hiciera falta.

## 8. Pruebas

- **Helper (hecho):** 13 pruebas de Node en verde (`disponibilidad.test.ts`): caja x8 con 15, 7 y 0; porción disponible con caja no disponible; producto sin control; stock compartido carrito/pantalla; tope del "+"; carrito viejo contra stock fresco; promos con componentes (variedades, cantidad 2, stock agotado, resta del carrito); etiquetas.
- **API:** catálogo con stock 15/7/0 y factor 8: `disponible`, `max_unidades`, `sin_stock_motivo`; cliente viejo ignora los campos nuevos; promo con componente sin stock; con `mostrar_agotados` apagado y encendido.
- **Pantallas (Playwright sobre el entorno aislado):** kiosco y mesa (cajas no disponibles, "Quedan N", "+" bloqueado, stock compartido entre porción y caja), caja (tile gris), carrito restaurado de mesa con stock agotado, admin (línea "alcanza para").
- **409:** dos clientes compitiendo por el último stock: el segundo vuelve al carrito con el mensaje, sin perder el carrito.
- **Realtime/`catalogo_version`:** una venta en un dispositivo cambia la disponibilidad en otro dispositivo en reposo; un dispositivo con carrito en curso no se refresca solo pero revalida al abrir el carrito; reconexión (`SUBSCRIBED`) y despertar de PWA siguen invalidando.
- **Regresión:** productos sin control de stock, toggle `mostrar_agotados`, novedades, promos V2 con cantidad por slot, flujo de precios desactualizados (`onPreciosDesactualizados`) intacto.

## 9. Adjuntos de esta carpeta

- `disponibilidad.ts`: helper propuesto (no está en el repo).
- `disponibilidad.test.ts`: 13 pruebas. Correr con `node --experimental-strip-types --test disponibilidad.test.ts`.
