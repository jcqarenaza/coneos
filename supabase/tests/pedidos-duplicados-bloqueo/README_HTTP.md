# Prueba HTTP real — pedidos duplicados (LAB `/cecchetto` en la base `cones-prod`)

Hay UNA sola base de datos: `cones-prod` (ref `wpiwjpvjqshsgrxxwsld`). El LAB es la empresa `/cecchetto`; producción real es `/federal`.
Script: `prueba_http_supabase.py` (Python 3.8+, sin dependencias). Habla por HTTP con Auth y PostgREST reales.
Usa solo `/cecchetto` (empresa A) y `/demoburger` (empresa B, para probar aislamiento). **Nunca toca `/federal`**: se niega a correr si un id coincide con Federal o si las claves no son de `cones-prod`.

## 1. Variables de entorno (las claves NO van en el comando ni en el repo)
Supabase → proyecto `cones-prod` → Project Settings → API → "Legacy API keys":
- `SB_ANON_KEY` = clave `anon`
- `SB_SERVICE_ROLE_KEY` = clave `service_role`

PowerShell (Windows):
```powershell
$env:SB_ANON_KEY = Read-Host "anon"
$env:SB_SERVICE_ROLE_KEY = Read-Host "service_role"
```
bash (Mac/Linux):
```bash
read -rs SB_ANON_KEY && export SB_ANON_KEY
read -rs SB_SERVICE_ROLE_KEY && export SB_SERVICE_ROLE_KEY
```

## 2. Comando
Desde la raíz del repo:
```
python supabase/tests/pedidos-duplicados-bloqueo/prueba_http_supabase.py
```
Genera `resultado_http_<fecha>.json` en la carpeta actual (sin tokens ni claves). Enviarlo al CTO; **no versionarlo**.
Código de salida: 0 = todo PASS, 1 = algún FAIL, 2-5 = faltan claves / claves ajenas / sin red / fallo de preparación.

## 3. Qué hace
1. Crea usuarios de Auth ficticios (`@example.test`) y datos ficticios (sucursales `T-HTTP`, `usuarios_admin`, roles, pedidos 99xxxx y revisiones) en `/cecchetto` y `/demoburger`.
2. RLS con **JWT reales de usuario** (login por Auth): ADMIN_EMPRESA A, ADMIN_EMPRESA B, ADMIN_SUCURSAL A1, usuario sin permisos; token inválido y anónimo; tabla y funciones de servidor inaccesibles para `anon`/`authenticated`. `service_role` no se usa para demostrar aislamiento: solo para fixtures y para la parte de servidor de las marcas.
3. PostgREST: `uuid[]` (array JSON, literal, vacío, omitido, null, inválido), `jsonb` (`candidatos_snapshot` con `cliente` null, `items` [], `opciones` [null,"x"], anidados), RPC `reclamar_operacion_pedido` (10 parámetros), `pedidos_en_revision`, `resolver_revision_duplicado`, y errores de tipo/argumentos/permisos.
4. Enciende `bloquear_pedidos_duplicados` SOLO en `/cecchetto` y lo restaura al final (Federal queda siempre apagada).
5. Limpia únicamente lo que creó (usuarios, datos y la llave) y muestra los residuos.

## 4. Notas
- La ruta Next `/api/admin/pedidos-revision` no se despliega: el script emula sus dos pasos (empresa desde el JWT del usuario y marcas por `service_role`).
- ADMIN_SUCURSAL: se espera y se documenta alcance de toda su empresa (sin cambiar políticas).
- Sin conexión a Internet hacia `*.supabase.co` el script termina con error de red (código 4).
