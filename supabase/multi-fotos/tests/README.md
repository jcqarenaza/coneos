# Tests multi-fotos

Todo corre en entornos AISLADOS (PostgreSQL local, Supabase simulado). Nada toca la base compartida.

| Archivo | Qué prueba | Cómo |
|---|---|---|
| `00-base-sintetica.sql` | Réplica mínima del esquema real (verificado por catálogo el 07/11) | la usa `run-all.sh` |
| `run-all.sh` + `test-integridad.py` | 30 pruebas de integridad, seguridad (RLS, permisos), concurrencia, deadlocks | PostgreSQL 16 en `/tmp:54399` |
| `test-migracion-reversion.sh` | 59 pruebas: migración, compat `imagen_url`, reversión con respaldos acumulativos (2 ciclos), bump, acceso a respaldos, mutaciones que deben abortar | idem |
| `test-api-catalogo.ts` | 14 pruebas de `/api/kiosk/catalogo` (herencia, fallback sin tabla, paginación) | `npx tsx supabase/multi-fotos/tests/test-api-catalogo.ts` desde la raíz del repo |
| `test-ui-galeria.js` + `fake-supabase.js` + `harness-galeria.page.tsx.txt` | 22 pruebas en navegador real (Playwright): galería del admin y carrusel | levantar `fake-supabase.js`, `next dev -p 3111` con `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54500`, copiar el harness, `node test-ui-galeria.js` |
