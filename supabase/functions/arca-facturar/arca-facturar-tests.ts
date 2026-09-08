// Tests puros FA-2 — correr con: deno test supabase/functions/arca-facturar/arca-facturar-tests.ts
// (importa desde el index; no toca red ni base)
import { assertEquals } from 'jsr:@std/assert@1';
import { determinarTipoCbte, calcularImportes, validarCoherencia, round2, cuitValido } from './index.ts';

Deno.test('determinarTipoCbte — matriz completa del CTO', () => {
  // Mono o flag OFF → 11 siempre
  assertEquals(determinarTipoCbte('monotributo', false, 5, false), 11);
  assertEquals(determinarTipoCbte('monotributo', true, 1, false), 11); // flag no alcanza sin RI
  assertEquals(determinarTipoCbte('ri', false, 1, false), 11);
  // RI + flag ON
  assertEquals(determinarTipoCbte('ri', true, 1, false), 1);  // RI→RI = A
  assertEquals(determinarTipoCbte('ri', true, 6, false), 1);  // RI→Mono = A (Ley 27.618)
  assertEquals(determinarTipoCbte('ri', true, 5, false), 6);  // RI→CF = B
  assertEquals(determinarTipoCbte('ri', true, 4, false), 6);  // RI→Exento = B
  // NC derivadas de la original
  assertEquals(determinarTipoCbte('ri', true, 1, true, 1), 3);
  assertEquals(determinarTipoCbte('ri', true, 5, true, 6), 8);
  assertEquals(determinarTipoCbte('monotributo', false, 5, true, 11), 13);
});

Deno.test('calcularImportes — invariante neto+iva=total, centavo a centavo', () => {
  for (const total of [121, 999.99, 1000.01, 0.01, 48000, 12345.67, 0.03]) {
    const { neto, iva } = calcularImportes(1, total);
    assertEquals(round2(neto + iva), round2(total), `total ${total}`);
  }
  assertEquals(calcularImportes(1, 121), { neto: 100, iva: 21, conIva: true });
  // C: sin IVA, neto = total
  assertEquals(calcularImportes(11, 121), { neto: 121, iva: 0, conIva: false });
  assertEquals(calcularImportes(13, 50), { neto: 50, iva: 0, conIva: false });
  // NC A/B con IVA
  assertEquals(calcularImportes(3, 121).conIva, true);
  assertEquals(calcularImportes(8, 121).conIva, true);
});

Deno.test('validarCoherencia — la Edge como autoridad final', () => {
  assertEquals(validarCoherencia({ condicion_fiscal: 'ri', emite_factura_a: true }), null);
  assertEquals(validarCoherencia({ condicion_fiscal: 'monotributo', emite_factura_a: false }), null);
  assertEquals(typeof validarCoherencia({ condicion_fiscal: 'monotributo', emite_factura_a: true }), 'string');
});

Deno.test('cuitValido — dígito verificador', () => {
  assertEquals(cuitValido('20306127145'), true);
  assertEquals(cuitValido('20-30612714-5'), true);
  assertEquals(cuitValido('20111111111'), false);
  assertEquals(cuitValido('123'), false);
});
