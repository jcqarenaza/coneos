# ⚠️ FA-2 (FACTURA A/B) — PREPARADA PERO APAGADA — NO ACTIVAR ⚠️
# Decisión CTO 08/09/2026 — este archivo es el candado documental.

## Estado
- La Edge arca-facturar en producción incluye el código de Factura A/B
  DETRÁS del flag facturacion_config.emite_factura_a (DEFAULT false).
- Con el flag en false, TODO comercio emite Factura C exactamente como
  siempre (regresión certificada con facturas reales de producción).
- Este branch (feature/factura-a-b) contiene además el toggle de Admin,
  el ticket A/B y la route extendida. NO MERGEADO a main a propósito.
- El armado del XML A/B fue validado contra la Edge de Piamonte en
  producción (Factura A con CAE real): reduce la incertidumbre técnica,
  PERO NO REEMPLAZA LA HOMOLOGACIÓN.

## REGLAS (obligatorias, sin excepciones)
1. emite_factura_a permanece en FALSE para TODAS las sucursales.
2. NINGUNA sucursal puede emitir Factura A/B hasta:
   a) completar la MATRIZ DE HOMOLOGACIÓN completa
      (ver guia-homologacion-fa2.md), y
   b) recibir APROBACIÓN EXPLÍCITA DEL CTO para activar el flag.
3. Ver el switch "Permite Factura A/B" en el Admin NO significa que la
   funcionalidad esté lista para usar: significa que está preparada.
   La homologación es CONDICIÓN DE ENTRADA del primer RI real.
4. Este branch no se mergea a main sin OK explícito del CTO.

## Cuándo se descongela
Cuando aparezca el primer prospecto Responsable Inscripto:
homologación completa (matriz verde + registro por emisión) → informe →
OK del CTO → merge → activación del flag SOLO para ese comercio.
