#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PRUEBA HTTP REAL — pedidos duplicados (CTO 14/11/2026)

Ejecuta solicitudes HTTP reales contra Auth y PostgREST de la base unica cones-prod (project ref wpiwjpvjqshsgrxxwsld),
usando EXCLUSIVAMENTE el LAB: empresa /cecchetto (empresa A) y la empresa demo /demoburger (empresa B, para el aislamiento).
NUNCA toca /federal (produccion real): el script se niega a correr si algun id coincide con el de Federal.
Se niega a correr si las claves no pertenecen a cones-prod. No usa dependencias externas (solo libreria estandar de Python 3.8+).

Las claves se toman de las variables de entorno SB_* o, si faltan, del .env.local del repo (las mismas de la app; ese archivo no se versiona):
  SB_ANON_KEY            clave anon (legacy JWT) de la rama
  SB_SERVICE_ROLE_KEY    clave service_role (legacy JWT) de la rama

service_role se usa SOLO para: crear/borrar usuarios y datos ficticios, y para las llamadas de servidor
(pedidos_en_revision, resolver_revision_duplicado, reclamar_operacion_pedido). El aislamiento RLS se prueba
exclusivamente con JWT reales de usuario obtenidos por Supabase Auth.

Escribe el detalle (sin tokens ni claves) en resultado_http_<fecha>.json en el directorio actual. NO lo versiones.
"""
import base64
import datetime
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

REF = 'wpiwjpvjqshsgrxxwsld'          # cones-prod (base unica)
BASE = 'https://%s.supabase.co' % REF
EMP_A = 'cdd77401-6b81-474f-b96c-8faaca1476fd'   # LAB: /cecchetto
EMP_B = '3dffcc70-eff0-4966-885b-a67a0dc1078f'   # demo: /demoburger (solo para probar aislamiento entre empresas)
SLUG_A, SLUG_B = 'cecchetto', 'demoburger'
FEDERAL = 'ce000000-0000-0000-0000-000000000001'  # produccion real: PROHIBIDO tocar

def _leer_env_local():
    """Si faltan las variables SB_*, toma las claves del .env.local / .env del repo (las mismas que usa la app). Nunca las imprime."""
    aqui = os.path.dirname(os.path.abspath(__file__))
    raiz = os.path.abspath(os.path.join(aqui, '..', '..', '..'))
    vistos = {}
    for d in (os.getcwd(), raiz):
        for nombre in ('.env.local', '.env'):
            ruta = os.path.join(d, nombre)
            if os.path.isfile(ruta):
                try:
                    for linea in open(ruta, encoding='utf-8-sig'):
                        linea = linea.strip()
                        if not linea or linea.startswith('#') or '=' not in linea:
                            continue
                        k, v = linea.split('=', 1)
                        vistos.setdefault(k.strip(), v.strip().strip('"').strip("'"))
                except OSError:
                    pass
    return vistos


_ENV = _leer_env_local()
ANON = (os.environ.get('SB_ANON_KEY') or _ENV.get('NEXT_PUBLIC_SUPABASE_ANON_KEY') or '').strip()
SVC = (os.environ.get('SB_SERVICE_ROLE_KEY') or _ENV.get('SUPABASE_SERVICE_ROLE_KEY') or '').strip()

EVID = []        # evidencia de cada solicitud (sin secretos)
RESULTS = []     # (grupo, caso, esperado, obtenido, ok)
CREADOS = {'auth': [], 'sucursales': [], 'usuarios': [], 'pedidos': [], 'operaciones': [], 'revisiones_ops': []}
CONFIG_PREVIA = {'existia': None, 'valor': None}
CON_LLAVE = '--con-llave-lab' in sys.argv   # por defecto NO se activa ninguna llave (limite CTO)


# ───────────────────────── utilidades ─────────────────────────
def _jwt_ref(key):
    """Devuelve el 'ref' de un JWT legacy de Supabase, o None si no es un JWT."""
    try:
        p = key.split('.')[1]
        p += '=' * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get('ref')
    except Exception:
        return None


def _jwt_claim(key, name):
    try:
        p = key.split('.')[1]
        p += '=' * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get(name)
    except Exception:
        return None


def guardas():
    faltan = [n for n, v in (('SB_ANON_KEY', ANON), ('SB_SERVICE_ROLE_KEY', SVC)) if not v]
    if faltan:
        print('FALTAN claves: %s. No estan en las variables SB_* ni en el .env.local del repo (ver README_HTTP.md)' % ', '.join(faltan))
        sys.exit(2)
    for nombre, k in (('SB_ANON_KEY', ANON), ('SB_SERVICE_ROLE_KEY', SVC)):
        ref = _jwt_ref(k)
        if ref is None:
            print('%s no es un JWT legacy de Supabase (usar las "Legacy API keys" de cones-prod).' % nombre)
            sys.exit(2)
        if ref != REF:
            print('%s NO pertenece a cones-prod (%s). ABORTO sin hacer ninguna solicitud.' % (nombre, REF))
            sys.exit(3)
    if FEDERAL in (EMP_A, EMP_B):
        print('Una de las empresas de prueba es Federal. ABORTO.')
        sys.exit(3)
    if _jwt_claim(ANON, 'role') != 'anon' or _jwt_claim(SVC, 'role') != 'service_role':
        print('Las claves estan cruzadas: SB_ANON_KEY debe ser role=anon y SB_SERVICE_ROLE_KEY role=service_role.')
        sys.exit(2)


def scrub(o):
    if isinstance(o, dict):
        return {k: ('<oculto>' if any(s in k.lower() for s in ('token', 'password', 'secret', 'apikey', 'jwt')) else scrub(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(x) for x in o]
    return o


def http(metodo, ruta, *, key=None, bearer='__default__', body=None, prefer=None, evidencia=True, nota=None):
    """Solicitud HTTP real. key = apikey; bearer = JWT (None = sin cabecera Authorization)."""
    key = key or ANON
    h = {'apikey': key, 'Content-Type': 'application/json', 'Accept': 'application/json'}
    if bearer == '__default__':
        bearer = key
    if bearer:
        h['Authorization'] = 'Bearer ' + bearer
    if prefer:
        h['Prefer'] = prefer
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + ruta, data=data, method=metodo, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            status, txt = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        status, txt = e.code, e.read().decode()
    except Exception as e:  # sin conexion, DNS, etc.
        print('ERROR DE RED: %s. Este script necesita salida a Internet hacia %s.' % (e, BASE))
        sys.exit(4)
    try:
        js = json.loads(txt) if txt else None
    except ValueError:
        js = txt
    if evidencia:
        quien = 'service_role' if key == SVC and bearer == SVC else ('anon' if bearer == ANON else ('sin-auth' if not bearer else 'JWT'))
        EVID.append({'metodo': metodo, 'ruta': ruta.split('?')[0] + ('?...' if '?' in ruta else ''), 'rol': quien, 'cuerpo_enviado': scrub(body),
                     'status': status, 'respuesta': scrub(js), 'nota': nota})
    return status, js


def rec(grupo, caso, esperado, obtenido, ok):
    # ok = True (PASS) | False (FAIL) | None (NO VERIFICABLE)
    RESULTS.append((grupo, caso, esperado, obtenido, None if ok is None else bool(ok)))
    if ok is None:
        print('  N/V   ' + caso)
    else:
        print(('  PASS  ' if ok else '  FAIL  ') + caso + ('' if ok else '   -> esperado: %s | obtenido: %s' % (esperado, obtenido)))


def svc(metodo, ruta, body=None, prefer=None, evidencia=True, nota=None):
    return http(metodo, ruta, key=SVC, bearer=SVC, body=body, prefer=prefer, evidencia=evidencia, nota=nota)


def code(js):
    return js.get('code') if isinstance(js, dict) else None


def q(v):
    return urllib.parse.quote(str(v), safe='')


# ───────────────────────── fixtures ficticios ─────────────────────────
def verificar_destinos():
    """Resuelve por slug los negocios de prueba y exige que coincidan con los ids configurados. No lee Federal."""
    for emp, slug in ((EMP_A, SLUG_A), (EMP_B, SLUG_B)):
        st, js = svc('GET', '/rest/v1/empresas?select=id,slug&id=eq.%s' % emp, evidencia=False)
        if not (st == 200 and isinstance(js, list) and len(js) == 1 and js[0].get('slug') == slug and js[0].get('id') != FEDERAL):
            print('El id %s no corresponde al negocio de prueba /%s. ABORTO sin crear nada.' % (emp, slug))
            sys.exit(3)
    print('Destinos verificados por slug: /%s y /%s (Federal excluida).' % (SLUG_A, SLUG_B))


def crear_fixtures(run):
    U = {}
    for nombre in ('aa', 'ab', 'sa', 'no'):
        email = 't-http-%s-%s@example.test' % (run, nombre)   # usuarios ficticios
        pw = secrets.token_urlsafe(18)
        st, js = svc('POST', '/auth/v1/admin/users', {'email': email, 'password': pw, 'email_confirm': True}, evidencia=True, nota='alta de usuario ficticio')
        if st not in (200, 201) or not isinstance(js, dict) or 'id' not in js:
            print('No se pudo crear el usuario de Auth ficticio (%s): status %s' % (nombre, st))
            sys.exit(5)
        U[nombre] = {'email': email, 'pw': pw, 'id': js['id']}
        CREADOS['auth'].append(js['id'])
    F = {'sA1': str(uuid.uuid4()), 'sA2': str(uuid.uuid4()), 'sB1': str(uuid.uuid4()),
         'pA1': str(uuid.uuid4()), 'pA2': str(uuid.uuid4()), 'pB1': str(uuid.uuid4()),
         'oA1': str(uuid.uuid4()), 'oA2': str(uuid.uuid4()), 'oB1': str(uuid.uuid4())}
    ok = lambda st: st in (200, 201, 204)
    st, js = svc('POST', '/rest/v1/sucursales', [
        {'id': F['sA1'], 'empresa_id': EMP_A, 'nombre': 'T-HTTP A1', 'slug': 't-http-%s-a1' % run},
        {'id': F['sA2'], 'empresa_id': EMP_A, 'nombre': 'T-HTTP A2', 'slug': 't-http-%s-a2' % run},
        {'id': F['sB1'], 'empresa_id': EMP_B, 'nombre': 'T-HTTP B1', 'slug': 't-http-%s-b1' % run}], prefer='return=minimal')
    assert ok(st), ('sucursales', st, js)
    CREADOS['sucursales'] += [F['sA1'], F['sA2'], F['sB1']]
    st, js = svc('POST', '/rest/v1/usuarios_admin', [
        {'id': U['aa']['id'], 'empresa_id': EMP_A, 'nombre': 'tAA'},
        {'id': U['ab']['id'], 'empresa_id': EMP_B, 'nombre': 'tAB'},
        {'id': U['sa']['id'], 'empresa_id': EMP_A, 'nombre': 'tSA'}], prefer='return=minimal')
    assert ok(st), ('usuarios_admin', st, js)
    CREADOS['usuarios'] += [U['aa']['id'], U['ab']['id'], U['sa']['id']]
    st, js = svc('POST', '/rest/v1/usuario_admin_roles', [
        {'usuario_id': U['aa']['id'], 'empresa_id': EMP_A, 'sucursal_id': None, 'rol': 'ADMIN_EMPRESA'},
        {'usuario_id': U['ab']['id'], 'empresa_id': EMP_B, 'sucursal_id': None, 'rol': 'ADMIN_EMPRESA'},
        {'usuario_id': U['sa']['id'], 'empresa_id': EMP_A, 'sucursal_id': F['sA1'], 'rol': 'ADMIN_SUCURSAL'}], prefer='return=minimal')
    assert ok(st), ('usuario_admin_roles', st, js)
    n0 = 990000 + secrets.randbelow(5000) * 10
    st, js = svc('POST', '/rest/v1/pedidos', [
        {'id': F['pA1'], 'empresa_id': EMP_A, 'numero_pedido': n0 + 1, 'sucursal_id': F['sA1'], 'operacion_id': F['oA1'], 'estado': 'PENDING_PAYMENT', 'origen': 'DELIVERY', 'metodo_pago': 'mp'},
        {'id': F['pA2'], 'empresa_id': EMP_A, 'numero_pedido': n0 + 2, 'sucursal_id': F['sA2'], 'operacion_id': F['oA2'], 'estado': 'PENDING_PAYMENT', 'origen': 'DELIVERY', 'metodo_pago': 'mp'},
        {'id': F['pB1'], 'empresa_id': EMP_B, 'numero_pedido': n0 + 3, 'sucursal_id': F['sB1'], 'operacion_id': F['oB1'], 'estado': 'PENDING_PAYMENT', 'origen': 'DELIVERY', 'metodo_pago': 'mp'}], prefer='return=minimal')
    assert ok(st), ('pedidos', st, js)
    CREADOS['pedidos'] += [F['pA1'], F['pA2'], F['pB1']]
    ahora = datetime.datetime.utcnow().isoformat() + 'Z'
    # una fila por solicitud: PostgREST exige las mismas claves en cada objeto de un insert masivo
    for fila in (
        {'empresa_id': EMP_A, 'sucursal_id': F['sA1'], 'operacion_id': F['oA1'], 'coincidencia': 'DISTINTA'},
        {'empresa_id': EMP_A, 'sucursal_id': F['sA2'], 'operacion_id': F['oA2'], 'coincidencia': 'IDENTICA', 'estado': 'DUPLICADO', 'resuelto_at': ahora},
        {'empresa_id': EMP_B, 'sucursal_id': F['sB1'], 'operacion_id': F['oB1'], 'coincidencia': 'DISTINTA'}):
        st, js = svc('POST', '/rest/v1/pedido_revisiones_duplicado', fila, prefer='return=minimal')
        assert ok(st), ('revisiones', st, js)
    CREADOS['revisiones_ops'] += [F['oA1'], F['oA2'], F['oB1']]
    return U, F, n0


# ───────────────────────── pruebas ─────────────────────────
def bloque_auth_rls(U, F):
    print('\n== AUTH REAL + RLS (solo JWT de usuario; service_role NO se usa para demostrar aislamiento) ==')
    for k in U:
        st, js = http('POST', '/auth/v1/token?grant_type=password', body={'email': U[k]['email'], 'password': U[k]['pw']}, evidencia=False)
        tok = js.get('access_token') if isinstance(js, dict) else None
        sub = _jwt_claim(tok, 'sub') if tok else None
        U[k]['jwt'] = tok
        EVID.append({'metodo': 'POST', 'ruta': '/auth/v1/token?grant_type=password', 'rol': 'anon', 'cuerpo_enviado': '<credenciales ficticias ocultas>', 'status': st, 'respuesta': {'jwt_emitido': bool(tok), 'sub_coincide': sub == U[k]['id']}})
        rec('AUTH', 'Auth real: login de %s devuelve JWT cuyo sub es el usuario' % k, '200 + JWT con sub correcto', 'status %s, jwt=%s, sub_ok=%s' % (st, bool(tok), sub == U[k]['id']), st == 200 and tok and sub == U[k]['id'])
    st, js = http('POST', '/auth/v1/token?grant_type=password', body={'email': U['aa']['email'], 'password': 'incorrecta-xyz'}, evidencia=True)
    rec('AUTH', 'Auth real: contraseña incorrecta es rechazada', '400 invalid_credentials', 'status %s, %s' % (st, (js or {}).get('error_code') if isinstance(js, dict) else js), st == 400)

    def empresas(u):
        st, js = http('GET', '/rest/v1/empresas?select=slug&order=slug', bearer=U[u]['jwt'])
        return st, ([r['slug'] for r in js] if isinstance(js, list) else js)

    for u, grupo, esp in (('aa', 'RLS_A', [SLUG_A]), ('ab', 'RLS_B', [SLUG_B]), ('sa', 'RLS_SUC', [SLUG_A])):
        st, vis = empresas(u)
        rec(grupo, 'RLS: %s ve solo su empresa (empresas)' % u, '200 %s' % esp, '%s %s' % (st, vis), st == 200 and vis == esp)
    st, vis = empresas('no')
    rec('SINPERM', 'RLS: usuario autenticado sin permisos administrativos no ve ninguna empresa (el endpoint respondera 401)', '200 []', '%s %s' % (st, vis), st == 200 and vis == [])
    st, js = http('GET', '/rest/v1/empresas?select=id&id=eq.%s' % EMP_B, bearer=U['aa']['jwt'])
    rec('RLS_A', 'RLS: ADMIN_EMPRESA A pidiendo explicitamente la empresa B obtiene 0 filas', '200 []', '%s %s' % (st, js), st == 200 and js == [])
    st, js = http('GET', '/rest/v1/empresas?select=id&id=eq.%s' % EMP_A, bearer=U['ab']['jwt'])
    rec('RLS_B', 'RLS: ADMIN_EMPRESA B pidiendo explicitamente la empresa A obtiene 0 filas', '200 []', '%s %s' % (st, js), st == 200 and js == [])
    st, js = http('GET', '/rest/v1/empresas?select=slug', bearer='token.invalido.xyz')
    rec('TOKEN_ANON', 'Token invalido es rechazado', '401', '%s %s' % (st, code(js)), st == 401)
    st, js = http('GET', '/rest/v1/empresas?select=slug', bearer=ANON)
    rec('TOKEN_ANON', 'Sesion anonima (clave anon sin usuario) no obtiene empresas', '200 [] (o error)', '%s %s' % (st, js if st != 200 else len(js)), (st == 200 and js == []) or st >= 400)
    st, js = http('GET', '/rest/v1/empresas?select=slug', bearer=None)
    rec('TOKEN_ANON', 'Sin cabecera Authorization (solo apikey anon) no obtiene empresas', '200 [] (o error)', '%s' % st, (st == 200 and js == []) or st >= 400)

    # no exposicion de pedidos (UUID) ajenos
    st, js = http('GET', '/rest/v1/pedidos?select=id&id=eq.%s' % F['pB1'], bearer=U['aa']['jwt'])
    rec('RLS_A', 'ADMIN_EMPRESA A no obtiene el UUID de un pedido de la empresa B', '200 [] o 401/403', '%s %s' % (st, (len(js) if isinstance(js, list) else js)), (st == 200 and js == []) or st in (401, 403))
    st, js = http('GET', '/rest/v1/pedidos?select=id&id=eq.%s' % F['pA1'], bearer=U['ab']['jwt'])
    rec('RLS_B', 'ADMIN_EMPRESA B no obtiene el UUID de un pedido de la empresa A', '200 [] o 401/403', '%s %s' % (st, (len(js) if isinstance(js, list) else js)), (st == 200 and js == []) or st in (401, 403))
    st, js = http('GET', '/rest/v1/pedidos?select=id&id=eq.%s' % F['pA1'], bearer=ANON)
    rec('TOKEN_ANON', 'Sesion anonima no obtiene el UUID de ningun pedido', '200 [] o 401/403', '%s %s' % (st, (len(js) if isinstance(js, list) else js)), (st == 200 and js == []) or st in (401, 403))
    st, js = http('GET', '/rest/v1/pedidos?select=id&id=eq.%s' % F['pA1'], bearer=U['no']['jwt'])
    rec('SINPERM', 'Usuario sin permisos no obtiene el UUID de ningun pedido', '200 [] o 401/403', '%s %s' % (st, (len(js) if isinstance(js, list) else js)), (st == 200 and js == []) or st in (401, 403))

    # tabla y funciones de servidor: inaccesibles con JWT de usuario y con anon
    for etiqueta, bearer in (('authenticated (admin A)', U['aa']['jwt']), ('anon', ANON)):
        st, js = http('GET', '/rest/v1/pedido_revisiones_duplicado?select=id&limit=1', bearer=bearer)
        rec('RLS_A', 'Tabla pedido_revisiones_duplicado no legible por %s' % etiqueta, '401/403 code 42501', '%s %s' % (st, code(js)), st in (401, 403))
        for fn, cuerpo in (('pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': [F['pA1']]}),
                           ('resolver_revision_duplicado', {'p_empresa': EMP_A, 'p_pedido': F['pA1'], 'p_resolucion': 'LEGITIMO'}),
                           ('reclamar_operacion_pedido', {'p_empresa_id': EMP_A, 'p_sucursal_id': F['sA1'], 'p_operacion_id': str(uuid.uuid4()), 'p_huella': 'h', 'p_telefono': None, 'p_visitante': None, 'p_dispositivo_id': None})):
            st, js = http('POST', '/rest/v1/rpc/' + fn, bearer=bearer, body=cuerpo)
            rec('RLS_A', 'RPC %s no ejecutable por %s' % (fn, etiqueta), '401/403 code 42501', '%s %s' % (st, code(js)), st in (401, 403, 404))

    # marcas que entrega el endpoint: empresa sale de la sesion (JWT de usuario) y las marcas del servidor (service_role)
    print('  (emulacion del endpoint /api/admin/pedidos-revision: paso 1 con JWT de usuario, paso 2 service_role; la ruta Next no se despliega aqui)')
    ids = [F['pA1'], F['pA2'], F['pB1']]
    nombre = {F['pA1']: 'pA1', F['pA2']: 'pA2', F['pB1']: 'pB1'}
    for u, grupo, esp in (('aa', 'RLS_A', {'pA1': 'PENDIENTE', 'pA2': 'DUPLICADO'}), ('ab', 'RLS_B', {'pB1': 'PENDIENTE'}), ('sa', 'RLS_SUC', {'pA1': 'PENDIENTE', 'pA2': 'DUPLICADO'})):
        st, js = http('GET', '/rest/v1/empresas?select=id&limit=1', bearer=U[u]['jwt'])
        emp = js[0]['id'] if isinstance(js, list) and js else None
        st2, marcas = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': emp, 'p_pedidos': ids})
        got = {nombre.get(m['pedido_id'], 'otro'): m['revision_estado'] for m in marcas} if isinstance(marcas, list) else marcas
        extra = ' (ALCANCE: toda la empresa, sin filtro por sucursal)' if u == 'sa' else ''
        rec(grupo, 'Marcas para %s: solo de su empresa%s' % (u, extra), str(esp), '%s %s' % (st2, got), st2 == 200 and got == esp)
    rec('RLS_SUC', 'ADMIN_SUCURSAL A1: alcance observado = marcas de toda su empresa (incluye sucursal A2)', 'documentado (sin cambiar politicas)', 'ver caso anterior', True)


def bloque_postgrest(U, F, n0, run):
    print('\n== POSTGREST REAL: uuid[] y jsonb (service_role, operaciones de servidor) ==')
    u1, u2 = str(uuid.uuid4()), str(uuid.uuid4())

    def nueva_rev(extra, nota):
        op = str(uuid.uuid4())
        cuerpo = {'empresa_id': EMP_A, 'sucursal_id': F['sA1'], 'operacion_id': op, 'coincidencia': 'DISTINTA'}
        cuerpo.update(extra)
        st, js = svc('POST', '/rest/v1/pedido_revisiones_duplicado', cuerpo, prefer='return=representation', nota=nota)
        if st in (200, 201):
            CREADOS['revisiones_ops'].append(op)
        return st, js

    # uuid[]
    st, js = nueva_rev({'candidatos': [u1, u2]}, 'uuid[] como array JSON')
    c = js[0]['candidatos'] if isinstance(js, list) and js else None
    rec('UUID_ARR', 'uuid[] escrito como array JSON y leido como array de 2 UUID (no string)', 'list [u1,u2]', '%s %s' % (st, c), st in (200, 201) and isinstance(c, list) and c == [u1, u2])
    st, js = nueva_rev({'candidatos': '{%s,%s}' % (u1, u2)}, 'uuid[] como literal Postgres')
    c = js[0]['candidatos'] if isinstance(js, list) and js else None
    rec('UUID_ARR', 'uuid[] escrito como literal "{a,b}" se guarda como array de 2', 'list [u1,u2]', '%s %s' % (st, c), st in (200, 201) and c == [u1, u2])
    st, js = nueva_rev({'candidatos': []}, 'uuid[] vacio')
    c = js[0]['candidatos'] if isinstance(js, list) and js else 'NOHAY'
    rec('UUID_ARR', 'uuid[] vacio [] vuelve como [] (no null, no string)', '[]', '%s %r' % (st, c), st in (200, 201) and c == [])
    st, js = nueva_rev({}, 'uuid[] omitido')
    c = js[0]['candidatos'] if isinstance(js, list) and js else 'NOHAY'
    rec('UUID_ARR', 'uuid[] omitido toma el default [] ', '[]', '%s %r' % (st, c), st in (200, 201) and c == [])
    st, js = nueva_rev({'candidatos': None}, 'uuid[] null')
    rec('UUID_ARR', 'uuid[] null explicito es rechazado (NOT NULL), no se confunde con vacio', '400 code 23502', '%s %s' % (st, code(js)), st == 400 and code(js) == '23502')
    st, js = nueva_rev({'candidatos': ['no-es-uuid']}, 'uuid[] elemento invalido')
    rec('UUID_ARR', 'uuid[] con elemento invalido devuelve error de tipo (nunca exito)', '400 code 22P02', '%s %s' % (st, code(js)), st == 400 and code(js) == '22P02')

    # jsonb
    snap = [{'operacion_id': u1, 'numero_pedido': 12, 'estado': 'PENDING_PAYMENT', 'created_at': '2026-11-14T10:00:00+00:00', 'cliente': None,
             'items': [], 'opciones': [None, 'x'], 'total': 1.5, 'activo': True, 'detalle': {'a': [1, {'b': None}]}}]
    st, js = nueva_rev({'candidatos_snapshot': snap}, 'jsonb estructura completa')
    s = js[0]['candidatos_snapshot'] if isinstance(js, list) and js else 'NOHAY'
    rec('JSONB', 'jsonb: estructura (null, [], mixtos, numeros, bool, anidados) vuelve identica en la respuesta de escritura', 'igual a lo enviado', '%s igual=%s' % (st, s == snap), st in (200, 201) and s == snap)
    op = CREADOS['revisiones_ops'][-1]
    st, js = svc('GET', '/rest/v1/pedido_revisiones_duplicado?select=candidatos_snapshot&operacion_id=eq.%s' % op)
    s2 = js[0]['candidatos_snapshot'] if isinstance(js, list) and js else 'NOHAY'
    rec('JSONB', 'jsonb: lectura posterior (GET) devuelve la misma estructura; cliente null, items [], opciones [null,"x"]', 'igual a lo enviado', '%s igual=%s' % (st, s2 == snap), st == 200 and s2 == snap)
    st, js = svc('GET', '/rest/v1/pedido_revisiones_duplicado?select=candidatos_snapshot->0->cliente,candidatos_snapshot->0->items&operacion_id=eq.%s' % op)
    rec('JSONB', 'jsonb: operadores -> de PostgREST sobre el snapshot', '200 con cliente null e items []', '%s %s' % (st, js), st == 200 and isinstance(js, list) and js and js[0].get('cliente', 'X') is None and js[0].get('items') == [])
    st, js = nueva_rev({}, 'jsonb omitido')
    s = js[0]['candidatos_snapshot'] if isinstance(js, list) and js else 'NOHAY'
    rec('JSONB', 'jsonb omitido toma el default [] ', '[]', '%s %r' % (st, s), st in (200, 201) and s == [])
    st, js = nueva_rev({'candidatos_snapshot': None}, 'jsonb null')
    rec('JSONB', 'jsonb null explicito es rechazado (NOT NULL)', '400 code 23502', '%s %s' % (st, code(js)), st == 400 and code(js) == '23502')
    st, js = nueva_rev({'candidatos_snapshot': json.dumps(snap)}, 'jsonb enviado como TEXTO JSON (observacion)')
    s = js[0]['candidatos_snapshot'] if isinstance(js, list) and js else 'NOHAY'
    rec('JSONB', 'OBSERVACION: jsonb enviado como string JSON queda como %s (el codigo real envia objetos, no strings)' % type(s).__name__, 'informativo', '%s tipo=%s' % (st, type(s).__name__), st in (200, 201, 400))

    print('\n== RPC REALES ==')
    if CON_LLAVE:  # SOLO con --con-llave-lab (requiere autorizacion explicita): enciende la llave unicamente en /cecchetto y la restaura
        # llave encendida SOLO en la rama de pruebas, para la empresa A; se restaura al final
        st, js = svc('GET', '/rest/v1/empresa_config?select=bloquear_pedidos_duplicados&empresa_id=eq.%s' % EMP_A)
        if isinstance(js, list) and js:
            CONFIG_PREVIA.update(existia=True, valor=js[0]['bloquear_pedidos_duplicados'])
            svc('PATCH', '/rest/v1/empresa_config?empresa_id=eq.%s' % EMP_A, {'bloquear_pedidos_duplicados': True}, prefer='return=minimal', nota='llave encendida SOLO en la rama de pruebas')
        else:
            CONFIG_PREVIA.update(existia=False, valor=None)
            svc('POST', '/rest/v1/empresa_config', {'empresa_id': EMP_A, 'bloquear_pedidos_duplicados': True}, prefer='return=minimal', nota='llave encendida SOLO en la rama de pruebas')

    o1, o2 = str(uuid.uuid4()), str(uuid.uuid4())
    CREADOS['operaciones'] += [o1, o2]
    P = lambda **kw: dict({'p_empresa_id': EMP_A, 'p_sucursal_id': F['sA1'], 'p_operacion_id': o1, 'p_huella': 'h-%s-1' % run, 'p_telefono': '+54 9 2302 51-4650',
                           'p_visitante': 'vis1', 'p_dispositivo_id': None, 'p_confirmar': False, 'p_alcance_bloqueo': True, 'p_confirmar_otro': False}, **kw)
    st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', P())
    rec('RPC', 'reclamar_operacion_pedido con sus 10 parametros: NUEVA', '200 {"estado":"NUEVA"}', '%s %s' % (st, js), st == 200 and isinstance(js, dict) and js.get('estado') == 'NUEVA')
    n_ped = n0 + 9
    st, js = svc('POST', '/rest/v1/pedidos', {'empresa_id': EMP_A, 'numero_pedido': n_ped, 'sucursal_id': F['sA1'], 'operacion_id': o1, 'estado': 'PENDING_PAYMENT', 'origen': 'DELIVERY', 'metodo_pago': 'mp'}, prefer='return=representation')
    if st in (200, 201) and isinstance(js, list):
        CREADOS['pedidos'].append(js[0]['id'])
    pedido_o1 = js[0]['id'] if st in (200, 201) and isinstance(js, list) else None
    if CON_LLAVE:
        st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', P(p_operacion_id=o2, p_huella='h-%s-2' % run, p_telefono='02302514650', p_visitante='vis2'))
        ex = js.get('existente') if isinstance(js, dict) else None
        rec('RPC', 'reclamar: mismo telefono (otro formato) y otro visitante -> PEDIDO_ACTIVO/DISTINTA, existente={"mismo_visitante":false} sin pedido_id', 'PEDIDO_ACTIVO DISTINTA, sin pedido_id',
            '%s %s' % (st, js), st == 200 and js.get('estado') == 'PEDIDO_ACTIVO' and js.get('coincidencia') == 'DISTINTA' and ex == {'mismo_visitante': False})
        st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', P(p_operacion_id=o2, p_huella='h-%s-2' % run, p_telefono='02302514650', p_visitante='vis2', p_confirmar_otro=True))
        rec('RPC', 'reclamar con p_confirmar_otro=true -> NUEVA confirmada_otro', '200 NUEVA confirmada_otro=true', '%s %s' % (st, js), st == 200 and js == {'estado': 'NUEVA', 'confirmada_otro': True})
        CREADOS['revisiones_ops'].append(o2)
        st, js = svc('GET', '/rest/v1/pedido_revisiones_duplicado?select=estado,coincidencia,candidatos,candidatos_snapshot&operacion_id=eq.%s' % o2)
        r0 = js[0] if isinstance(js, list) and js else {}
        s0 = (r0.get('candidatos_snapshot') or [{}])[0]
        rec('JSONB', 'snapshot generado por la funcion real: revision PENDIENTE, candidatos [o1] (uuid[]), snapshot con numero/estado/items del pedido', 'PENDIENTE, [o1], numero %s, PENDING_PAYMENT, items []' % n_ped,
            '%s' % json.dumps(r0)[:300], r0.get('estado') == 'PENDIENTE' and r0.get('candidatos') == [o1] and s0.get('numero_pedido') == n_ped and s0.get('estado') == 'PENDING_PAYMENT' and isinstance(s0.get('items'), list) and 'cliente' in s0)
    else:
        for caso in ('reclamar con llave: mismo telefono y otro visitante -> PEDIDO_ACTIVO sin pedido_id',
                     'reclamar con p_confirmar_otro -> NUEVA confirmada_otro y revision con snapshot generado por la funcion',
                     'snapshot generado por la funcion real (pedido 99xxxx en el candidato)'):
            rec('RPC' if 'snapshot' not in caso else 'JSONB', 'NO VERIFICABLE (llave apagada, no se activa): ' + caso, 'requiere bloquear_pedidos_duplicados=true', 'omitido por limite CTO: no activar ninguna llave', None)

    o3 = str(uuid.uuid4())
    CREADOS['operaciones'].append(o3)
    st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', {k: v for k, v in P(p_operacion_id=o3, p_huella='h-%s-3' % run, p_telefono=None, p_visitante=None).items() if k in ('p_empresa_id', 'p_sucursal_id', 'p_operacion_id', 'p_huella', 'p_telefono', 'p_visitante', 'p_dispositivo_id')})
    rec('RPC', 'reclamar con 7 parametros (defaults de los otros 3) sigue funcionando', '200 NUEVA', '%s %s' % (st, js), st == 200 and isinstance(js, dict) and js.get('estado') == 'NUEVA')
    # errores
    st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', P(p_parametro_inexistente=1))
    rec('RPC', 'reclamar con parametro inexistente: error, no exito', '404 PGRST202', '%s %s' % (st, code(js)), st == 404 and code(js) == 'PGRST202')
    bad = P(); bad.pop('p_huella')
    st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', bad)
    rec('RPC', 'reclamar sin parametro obligatorio: error, no exito', '404 PGRST202', '%s %s' % (st, code(js)), st == 404 and code(js) == 'PGRST202')
    st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', P(p_confirmar='no-es-booleano'))
    rec('RPC', 'reclamar con tipo incorrecto (boolean): error de tipo', '400 22P02', '%s %s' % (st, code(js)), st == 400 and code(js) == '22P02')
    st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', P(p_operacion_id='xyz'))
    rec('RPC', 'reclamar con uuid invalido: error de tipo', '400 22P02', '%s %s' % (st, code(js)), st == 400 and code(js) == '22P02')
    st, js = svc('POST', '/rest/v1/rpc/reclamar_operacion_pedido', P(p_huella='', p_operacion_id=str(uuid.uuid4())))
    rec('RPC', 'reclamar con huella vacia: excepcion de la funcion (P0001), no exito', '400 P0001 OPERACION_DATOS_INVALIDOS', '%s %s %s' % (st, code(js), (js or {}).get('message') if isinstance(js, dict) else js), st == 400 and code(js) == 'P0001')

    ids = [F['pA1'], F['pA2'], F['pB1']]
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': ids})
    rec('RPC', 'pedidos_en_revision(uuid, uuid[]): array JSON -> marcas de A (2 filas, ninguna de B)', '2 filas', '%s %s' % (st, js), st == 200 and isinstance(js, list) and len(js) == 2 and F['pB1'] not in [m['pedido_id'] for m in js])
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': '{%s}' % F['pA1']})
    rec('RPC', 'pedidos_en_revision: uuid[] como literal "{uuid}" tambien se interpreta como array', '1 fila', '%s %s' % (st, js), st == 200 and isinstance(js, list) and len(js) == 1)
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': []})
    rec('UUID_ARR', 'pedidos_en_revision con array vacio: 200 y []', '200 []', '%s %s' % (st, js), st == 200 and js == [])
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': None})
    rec('UUID_ARR', 'pedidos_en_revision con array null: 200 y [] (distinguible por el codigo: el servidor nunca envia null)', '200 []', '%s %s' % (st, js), st == 200 and js == [])
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': ['x']})
    rec('UUID_ARR', 'pedidos_en_revision con elemento no-uuid: error de tipo', '400 22P02', '%s %s' % (st, code(js)), st == 400 and code(js) == '22P02')
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': 'abc'})
    rec('UUID_ARR', 'pedidos_en_revision con string que no es array: error', '400 22P02', '%s %s' % (st, code(js)), st == 400 and code(js) == '22P02')
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': [str(uuid.uuid4())]})
    rec('RPC', 'pedidos_en_revision sin registros: 200 y []', '200 []', '%s %s' % (st, js), st == 200 and js == [])

    R = lambda emp, ped, res: svc('POST', '/rest/v1/rpc/resolver_revision_duplicado', {'p_empresa': emp, 'p_pedido': ped, 'p_resolucion': res})
    s1, j1 = R(EMP_A, F['pA1'], 'LEGITIMO'); s2, j2 = R(EMP_A, F['pA1'], 'LEGITIMO'); s3, j3 = R(EMP_A, F['pA1'], 'DUPLICADO'); s4, j4 = R(EMP_B, F['pA1'], 'LEGITIMO')
    est = lambda j: j.get('estado') if isinstance(j, dict) else j
    rec('RPC', 'resolver_revision_duplicado: RESUELTA / YA_RESUELTA / YA_RESUELTA_DISTINTA / PEDIDO_NO_ENCONTRADO (otra empresa)', 'RESUELTA/YA_RESUELTA/YA_RESUELTA_DISTINTA/PEDIDO_NO_ENCONTRADO',
        '%s/%s/%s/%s' % (est(j1), est(j2), est(j3), est(j4)), (s1, s2, s3, s4) == (200, 200, 200, 200) and (est(j1), est(j2), est(j3), est(j4)) == ('RESUELTA', 'YA_RESUELTA', 'YA_RESUELTA_DISTINTA', 'PEDIDO_NO_ENCONTRADO'))
    st, js = R(EMP_A, F['pA2'], 'XX')
    rec('RPC', 'resolver con resolucion invalida: excepcion P0001 RESOLUCION_INVALIDA (no exito)', '400 P0001', '%s %s %s' % (st, code(js), (js or {}).get('message') if isinstance(js, dict) else js), st == 400 and code(js) == 'P0001')
    st, js = R(EMP_A, 'zz', 'LEGITIMO')
    rec('RPC', 'resolver con p_pedido no-uuid: error de tipo', '400 22P02', '%s %s' % (st, code(js)), st == 400 and code(js) == '22P02')
    st, js = svc('POST', '/rest/v1/rpc/pedidos_en_revision', {'p_empresa': EMP_A, 'p_pedidos': ids})
    rec('RPC', 'tras resolver LEGITIMO, pA1 deja de estar retenido (solo queda pA2 DUPLICADO)', '1 fila (pA2)', '%s %s' % (st, [m['pedido_id'] == F['pA2'] for m in js] if isinstance(js, list) else js), st == 200 and isinstance(js, list) and len(js) == 1 and js[0]['pedido_id'] == F['pA2'])


def limpiar(run):
    print('\n== LIMPIEZA (solo los datos ficticios de esta corrida) ==')
    ops = [o for o in CREADOS['revisiones_ops'] if o]
    todas_ops = ops + [o for o in CREADOS['operaciones'] if o]
    inn = lambda L: '(' + ','.join(L) + ')'
    if ops:
        svc('DELETE', '/rest/v1/pedido_revisiones_duplicado?operacion_id=in.' + inn(ops), prefer='return=minimal', evidencia=False)
    if CREADOS['pedidos']:
        svc('DELETE', '/rest/v1/pedidos?id=in.' + inn(CREADOS['pedidos']), prefer='return=minimal', evidencia=False)
    if todas_ops:
        svc('DELETE', '/rest/v1/pedido_operaciones?operacion_id=in.' + inn(todas_ops), prefer='return=minimal', evidencia=False)
    if CREADOS['usuarios']:
        svc('DELETE', '/rest/v1/usuario_admin_roles?usuario_id=in.' + inn(CREADOS['usuarios']), prefer='return=minimal', evidencia=False)
        svc('DELETE', '/rest/v1/usuarios_admin?id=in.' + inn(CREADOS['usuarios']), prefer='return=minimal', evidencia=False)
    for uid in CREADOS['auth']:
        svc('DELETE', '/auth/v1/admin/users/' + uid, evidencia=False)
    # barrido: sucursales ficticias (slug t-http-*) de esta o de corridas anteriores, solo en las 2 empresas de prueba
    st_s, js_s = svc('GET', '/rest/v1/sucursales?select=id&slug=like.t-http-*&empresa_id=in.(%s,%s)' % (EMP_A, EMP_B), evidencia=False)
    suc_ids = list(CREADOS['sucursales'])
    if isinstance(js_s, list):
        suc_ids += [x['id'] for x in js_s if x.get('id') not in suc_ids]
    if suc_ids:
        # catalogo_version se crea sola al dar de alta una sucursal y bloquea el borrado
        svc('DELETE', '/rest/v1/catalogo_version?sucursal_id=in.' + inn(suc_ids), prefer='return=minimal', evidencia=False)
        svc('DELETE', '/rest/v1/sucursales?id=in.' + inn(suc_ids), prefer='return=minimal', evidencia=False)
    if CON_LLAVE and CONFIG_PREVIA['existia'] is True:
        svc('PATCH', '/rest/v1/empresa_config?empresa_id=eq.%s' % EMP_A, {'bloquear_pedidos_duplicados': CONFIG_PREVIA['valor']}, prefer='return=minimal', evidencia=False)
    elif CON_LLAVE and CONFIG_PREVIA['existia'] is False:
        svc('DELETE', '/rest/v1/empresa_config?empresa_id=eq.%s' % EMP_A, prefer='return=minimal', evidencia=False)
    # verificacion de residuos
    st, js = svc('GET', '/rest/v1/pedido_revisiones_duplicado?select=id&operacion_id=in.' + inn(todas_ops or [str(uuid.uuid4())]), evidencia=False)
    st2, js2 = svc('GET', '/rest/v1/empresa_config?select=bloquear_pedidos_duplicados&bloquear_pedidos_duplicados=eq.true', evidencia=False)
    print('  revisiones residuales: %s | empresas con la llave en true: %s' % (len(js) if isinstance(js, list) else js, len(js2) if isinstance(js2, list) else js2))


def main():
    guardas()
    run = secrets.token_hex(3)
    print('PRUEBA HTTP REAL — rama %s — corrida %s — %s' % (REF, run, datetime.datetime.now().isoformat(timespec='seconds')))
    st, _ = http('GET', '/auth/v1/health', evidencia=False)
    print('Conectividad con Auth: status %s' % st)
    verificar_destinos()
    U = F = None
    try:
        U, F, n0 = crear_fixtures(run)
        bloque_auth_rls(U, F)
        bloque_postgrest(U, F, n0, run)
    except AssertionError as e:
        print('FALLO LA PREPARACION de datos ficticios: %s' % (e,))
        rec('SETUP', 'preparacion de fixtures', 'ok', str(e), False)
    finally:
        limpiar(run)

    grupos = [('Auth real', ['AUTH']), ('RLS ADMIN_EMPRESA A', ['RLS_A']), ('RLS ADMIN_EMPRESA B', ['RLS_B']), ('RLS ADMIN_SUCURSAL', ['RLS_SUC']),
              ('Usuario sin permisos', ['SINPERM']), ('Token invalido / anon', ['TOKEN_ANON']), ('PostgREST uuid[]', ['UUID_ARR']), ('PostgREST jsonb', ['JSONB']), ('RPC reales', ['RPC'])]
    print('\n================ RESUMEN ================')
    todo_ok = True
    for nombre, gs in grupos:
        rs = [r for r in RESULTS if r[0] in gs]
        fails = [r for r in rs if r[4] is False]
        nvs = [r for r in rs if r[4] is None]
        ok = bool(rs) and not fails
        todo_ok &= ok
        estado = 'FAIL' if fails else ('SIN DATOS' if not rs else ('PASS (con %d caso(s) NO VERIFICABLE)' % len(nvs) if nvs else 'PASS'))
        print('%-26s %s  (%d PASS / %d FAIL / %d N/V de %d)' % (nombre, estado, sum(1 for r in rs if r[4] is True), len(fails), len(nvs), len(rs)))
    print('ADMIN_SUCURSAL: alcance = marcas de TODA su empresa (documentado, sin cambiar politicas).')
    nombre_arch = 'resultado_http_%s.json' % datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    with open(nombre_arch, 'w', encoding='utf-8') as f:
        json.dump({'rama_supabase': REF, 'corrida': run, 'casos': [dict(grupo=r[0], caso=r[1], esperado=r[2], obtenido=r[3], ok=r[4]) for r in RESULTS], 'solicitudes': EVID}, f, ensure_ascii=False, indent=2)
    print('Detalle (sin tokens ni claves) en %s — enviarlo al CTO. No versionarlo.' % nombre_arch)
    sys.exit(0 if todo_ok else 1)


if __name__ == '__main__':
    main()
