#!/usr/bin/env python3
"""Bloqueo de pedidos duplicados (opción C, CTO 13/11): funciones SQL REALES en Postgres LOCAL aislado.
Uso: python3 prueba_sql.py   (cluster y roles: ver ../stock-v2/README.md; roles service_role/anon/authenticated creados)
Cubre las 10 pruebas mínimas del CTO (marcadas T1..T10) + bordes (ventana, normalización, aislamiento, privilegios, reversión)."""
import os, json, threading, uuid, hashlib
import psycopg2, psycopg2.extras
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.abspath(os.path.join(HERE, '..', '..'))
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db, ac=True):
    c = psycopg2.connect(dbname=db, **CONN); c.autocommit = ac; return c
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
BASE = ('stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql')
NUEVO = 'pedidos-duplicados-bloqueo.sql'; REVERSION = 'pedidos-duplicados-bloqueo-REVERSION.sql'
def fresh(name):
    a = connect('postgres'); a.cursor().execute(f'drop database if exists {name} with (force)'); a.cursor().execute(f'create database {name}'); a.close()
    c = connect(name).cursor()
    c.execute(open(os.path.join(SUP, 'tests', 'stock-v2', '00-schema-reducido.sql'), encoding='utf-8').read())
    c.execute("create table empresa_config (empresa_id uuid primary key, primary_color text)")
    c.execute("alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role")
    c.execute("alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role")
    return c
def build(name, nuevo=True):
    c = fresh(name)
    for f in BASE + ((NUEVO,) if nuevo else ()): c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
    return name
def aplicar(c, f):
    try: c.execute(open(os.path.join(SUP, f), encoding='utf-8').read()); return None, list(c.connection.notices)
    except psycopg2.Error as e:
        try: c.execute('rollback')
        except psycopg2.Error: pass
        return (e.pgerror or str(e)), list(c.connection.notices)
def world(db, bloqueo=True, minutos=30, horas=3, prevenir=True):
    q = connect(db).cursor(); w = {'db': db}
    def one(sql, *a): q.execute(sql, a); return q.fetchone()[0]
    w['emp'] = one("insert into empresas default values returning id"); w['suc'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    w['suc2'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    q.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s),(%s,%s)", (w['suc'], w['emp'], w['suc2'], w['emp']))
    q.execute("insert into empresa_config(empresa_id) values(%s)", (w['emp'],))
    w['prod'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Helado',true) returning id", w['emp'])
    w['pres'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Unidad',1000,1) returning id", w['emp'], w['prod'])
    for s in (w['suc'], w['suc2']): q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,1000)", (w['emp'], w['prod'], s))
    q.execute("update empresa_config set bloquear_pedidos_duplicados=%s, pedidos_repetidos_minutos=%s, pedido_activo_ventana_horas=%s, prevenir_pedidos_repetidos=%s where empresa_id=%s",
              (bloqueo, minutos, horas, prevenir, w['emp']))
    return w
def reclamar(w, op, huella='H-A', tel=None, vis=None, disp=None, confirmar=False, suc=None, alcance=True, otro=False, conn=None, emp=None, ocho=False):
    cu = (conn or connect(w['db'])).cursor()
    if ocho:      # llamador histórico: SOLO los 8 parámetros de pedidos-repetidos.sql (los dos nuevos toman su default)
        cu.execute("select reclamar_operacion_pedido(%s,%s,%s,%s,%s,%s,%s,%s)", (emp or w['emp'], suc or w['suc'], op, huella, tel, vis, disp, confirmar)); return cu.fetchone()[0]
    cu.execute("select reclamar_operacion_pedido(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", (emp or w['emp'], suc or w['suc'], op, huella, tel, vis, disp, confirmar, alcance, otro)); return cu.fetchone()[0]
def venta(w, suc=None, conn=None, op=None):
    cu = (conn or connect(w['db'])).cursor()
    it = [{'presentacion_id': str(w['pres']), 'cantidad': 1, 'precio_snap': 1000, 'nombre_producto_snap': 'a', 'nombre_presentacion_snap': 'u', 'opciones': []}]
    cu.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'delivery', p_tipo_pedido := 'delivery', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := false, p_operacion_id := %s::uuid)", (w['emp'], suc or w['suc'], json.dumps(it), str(op) if op else None))
    r = cu.fetchone()[0]; return r['id'] if 'id' in r else r['pedido_id']
def completar(w, op, pid, conn=None): (conn or connect(w['db'])).cursor().execute("select completar_operacion_pedido(%s,%s,%s)", (w['emp'], op, pid))
def comprar(w, huella='H-A', **kw):
    """Flujo del servidor: reclamar → (si NUEVA) crear pedido → completar. Devuelve (decisión, op, pedido_id)."""
    op = kw.pop('op', None) or uuid.uuid4(); r = reclamar(w, op, huella, **kw); pid = None
    if r['estado'] == 'NUEVA':
        pid = venta(w, suc=kw.get('suc'), op=op); completar(w, op, pid)
    return r, op, pid
def estado(w, pid, e): connect(w['db']).cursor().execute("update pedidos set estado=%s where id=%s", (e, pid))
def npedidos(w):
    cu = connect(w['db']).cursor(); cu.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); return cu.fetchone()[0]
def envejecer(w, minutos):
    connect(w['db']).cursor().execute("update pedido_operaciones set created_at = created_at - make_interval(mins => %s), updated_at = updated_at - make_interval(mins => %s) where empresa_id=%s", (minutos, minutos, w['emp']))
def est(r): return r['estado']

db = build('blq_main')
TEL = '2302514650'

print('=== T1 · CASO REAL #43/#49: mismo teléfono, contenido distinto, otro visitante y otro dispositivo ===')
w = world(db); a, opa, pa = comprar(w, 'H-43', tel=TEL, vis='vis-sandra-celu', disp=uuid.uuid4()); estado(w, pa, 'READY')
r = reclamar(w, uuid.uuid4(), 'H-49', tel=TEL, vis='vis-otro-dispositivo', disp=uuid.uuid4())
check('T1. #43 en READY + #49 (mismo teléfono, otra huella, otro visitante, otro dispositivo): PEDIDO_ACTIVO y NO se crea el segundo pedido',
      est(a) == 'NUEVA' and est(r) == 'PEDIDO_ACTIVO' and r['existente']['pedido_id'] == str(pa) and r['existente']['estado'] == 'READY' and npedidos(w) == 1, str(r))
check('T1b. el aviso trae número de pedido y la ventana', r['existente']['numero_pedido'] is not None and r['ventana_horas'] == 3, str(r['existente']))

print('=== T2/T3 · estados activos ===')
for e in ('READY', 'PENDING_PAYMENT', 'PAID', 'PREPARING'):
    w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, e); r = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL)
    check(f'T2/T3. teléfono con pedido {e}: advertencia fuerte (PEDIDO_ACTIVO)', est(r) == 'PEDIDO_ACTIVO' and r['existente']['estado'] == e, str(r))

print('=== T4/T5 · estados que NO bloquean ===')
for e in ('CANCELLED', 'DELIVERED', 'REJECTED'):
    w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, e); r1 = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL)
    w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, e); r2 = reclamar(w, uuid.uuid4(), 'H-X', tel=TEL)
    check(f'T4/T5. pedido {e}: permite un pedido nuevo, de otro contenido Y del mismo contenido (cada caso en su propia empresa)', est(r1) == 'NUEVA' and est(r2) == 'NUEVA', f'{est(r1)} {est(r2)}')
w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); connect(db).cursor().execute("delete from pedidos where id=%s", (p,)); r1 = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL)
w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); connect(db).cursor().execute("delete from pedidos where id=%s", (p,)); r2 = reclamar(w, uuid.uuid4(), 'H-X', tel=TEL)
check('T4b. pedido ELIMINADO: permite un pedido nuevo (distinto e idéntico)', est(r1) == 'NUEVA' and est(r2) == 'NUEVA', f'{est(r1)} {est(r2)}')
w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, 'CANCELLED'); r1 = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL); r2 = reclamar(w, uuid.uuid4(), 'H-Z', tel=TEL)
check('T4c. (control de carrera) el primer pedido NUEVO deja una operación EN_CURSO: el segundo intento inmediato del mismo teléfono SÍ advierte', est(r1) == 'NUEVA' and est(r2) == 'PEDIDO_ACTIVO')

print('=== T6 · identidad existente y bloqueo duro de idénticos ===')
w = world(db); comprar(w, 'H-X', tel='1111111111'); r = reclamar(w, uuid.uuid4(), 'H-X', tel='2222222222')
check('T6. dos teléfonos DIFERENTES con contenido idéntico: sin cruce', est(r) == 'NUEVA')
w = world(db); comprar(w, 'H-X', tel='1111111111', vis='vis-X'); r = reclamar(w, uuid.uuid4(), 'H-X', tel='2222222222', vis='vis-X')
check('T6b. mismo visitante pero teléfonos distintos: son clientes distintos (identidad existente, solo el teléfono)', est(r) == 'NUEVA')
w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL, vis='vis-1'); r = reclamar(w, uuid.uuid4(), 'H-X', tel=TEL, vis='vis-OTRO')
check('T6c. mismo teléfono + contenido IDÉNTICO (aunque cambie el visitante): BLOQUEADO_IDENTICO, con el pedido detectado', est(r) == 'BLOQUEADO_IDENTICO' and r['existente']['pedido_id'] == str(p) and npedidos(w) == 1, str(r))
op = uuid.uuid4(); b1 = reclamar(w, op, 'H-X', tel=TEL); b2 = reclamar(w, op, 'H-X', tel=TEL, confirmar=True); b3 = reclamar(w, op, 'H-X', tel=TEL, otro=True); b4 = reclamar(w, op, 'H-X', tel=TEL, confirmar=True, otro=True)
check('T6d. el bloqueo de idénticos NO tiene salida: ni confirmar_advertencia ni "es otro pedido" (ni ambos) lo saltean, y no queda ninguna fila ADVERTIDA',
      [est(x) for x in (b1, b2, b3, b4)] == ['BLOQUEADO_IDENTICO'] * 4 and npedidos(w) == 1, str([est(x) for x in (b1, b2, b3, b4)]))
cu = connect(db).cursor(); cu.execute("select count(*) from pedido_operaciones where empresa_id=%s and estado='ADVERTIDA'", (w['emp'],))
check('T6e. el bloqueo duro no deja filas ADVERTIDA (no engorda la tabla ni habilita confirmaciones)', cu.fetchone()[0] == 0)
w = world(db); comprar(w, 'H-X', vis='vis-A'); r1 = reclamar(w, uuid.uuid4(), 'H-X', vis='vis-B'); r2 = reclamar(w, uuid.uuid4(), 'H-X', vis='vis-A')
check('T6f. sin teléfono rige la identidad existente por visitante: visitantes distintos no se cruzan; el mismo visitante, idéntico → bloqueo', est(r1) == 'NUEVA' and est(r2) == 'BLOQUEADO_IDENTICO')
d1, d2 = uuid.uuid4(), uuid.uuid4(); w = world(db); comprar(w, 'H-X', disp=d1)
check('T6g. sin cliente identificado rige el dispositivo (mismo → bloqueo; otro dispositivo o anónimo → no)', est(reclamar(w, uuid.uuid4(), 'H-X', disp=d1)) == 'BLOQUEADO_IDENTICO' and est(reclamar(w, uuid.uuid4(), 'H-X', disp=d2)) == 'NUEVA' and est(reclamar(w, uuid.uuid4(), 'H-X')) == 'NUEVA')
w = world(db); comprar(w, 'H-X', tel=TEL); envejecer(w, 45)       # fuera de los 30 min del nivel 1, pero dentro de las 3 h del nivel 2, y sigue activo
r = reclamar(w, uuid.uuid4(), 'H-X', tel=TEL)
check('T6h. idéntico pero FUERA de la ventana de minutos con el pedido todavía activo: no es nivel 1; cae en el nivel 2 (PEDIDO_ACTIVO)', est(r) == 'PEDIDO_ACTIVO', str(r))
w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, 'DELIVERED')
check('T6i. idéntico con pedido ya ENTREGADO dentro de la ventana: en modo bloqueo NO bloquea (quien ya recibió puede pedir de nuevo)', est(reclamar(w, uuid.uuid4(), 'H-X', tel=TEL)) == 'NUEVA')

print('=== T7 · familiares con el mismo teléfono: advertencia + excepción explícita ===')
w = world(db); _, _, pa = comprar(w, 'H-A', tel=TEL, vis='v-mama'); op = uuid.uuid4()
r1 = reclamar(w, op, 'H-B', tel=TEL, vis='v-hijo'); r2 = reclamar(w, op, 'H-B', tel=TEL, vis='v-hijo')
check('T7. otro familiar (mismo teléfono, otro contenido): advertencia fuerte, y reenviar la MISMA operación sin la excepción sigue advirtiendo', est(r1) == est(r2) == 'PEDIDO_ACTIVO' and npedidos(w) == 1)
r0 = reclamar(w, uuid.uuid4(), 'H-B', tel=TEL, vis='v-hijo', otro=True)
check('T7b. "es otro pedido" SIN advertencia previa de esa operación no autoriza nada (el servidor igual advierte)', est(r0) == 'PEDIDO_ACTIVO' and npedidos(w) == 1)
rl = reclamar(w, op, 'H-B', tel=TEL, vis='v-hijo', confirmar=True)
check('T7c. la confirmación legacy (confirmar_advertencia) NO vale como excepción del nivel 2', est(rl) == 'PEDIDO_ACTIVO' and npedidos(w) == 1)
rx = reclamar(w, op, 'H-OTRA', tel=TEL, vis='v-hijo', otro=True); ry = reclamar(w, op, 'H-B', tel='9999999999', vis='v-hijo', otro=True); rz = reclamar(w, op, 'H-B', tel=TEL, vis='v-hijo', otro=True, suc=w['suc2'])
check('T7d. la excepción atada a otro contenido, otra identidad u otra sucursal: OPERACION_INVALIDA', est(rx) == est(ry) == est(rz) == 'OPERACION_INVALIDA', f'{est(rx)} {est(ry)} {est(rz)}')
r3 = reclamar(w, op, 'H-B', tel=TEL, vis='v-hijo', otro=True); pid = venta(w, op=op); completar(w, op, pid)
check('T7e. con la excepción explícita sobre la operación ya advertida: se permite y se crea el segundo pedido', est(r3) == 'NUEVA' and r3.get('confirmada_otro') and npedidos(w) == 2, str(r3))
check('T7f. un TERCER intento del mismo teléfono vuelve a advertir (la excepción no es una autorización permanente)', est(reclamar(w, uuid.uuid4(), 'H-C', tel=TEL)) == 'PEDIDO_ACTIVO')
r4 = reclamar(w, op, 'H-B', tel=TEL, vis='v-hijo', otro=True)
check('T7g. repetir la operación ya completada devuelve EXISTENTE (idempotencia intacta)', est(r4) == 'EXISTENTE' and r4['pedido_id'] == str(pid))

print('=== T8 · llave apagada: comportamiento anterior sin cambios ===')
w = world(db, bloqueo=False); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, 'READY')
rd = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL); op = uuid.uuid4(); ri = reclamar(w, op, 'H-X', tel=TEL); rc = reclamar(w, op, 'H-X', tel=TEL, confirmar=True)
check('T8. llave apagada: contenido distinto → sin aviso; idéntico → DUPLICADO (advertencia con "Sí, continuar"); la confirmación legacy sigue funcionando', est(rd) == 'NUEVA' and est(ri) == 'DUPLICADO' and est(rc) == 'NUEVA' and rc.get('confirmada'), f'{est(rd)} {est(ri)} {est(rc)}')
w = world(db, bloqueo=False); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, 'DELIVERED')
check('T8b. llave apagada: un pedido ENTREGADO dentro de la ventana sigue advirtiendo (como antes)', est(reclamar(w, uuid.uuid4(), 'H-X', tel=TEL)) == 'DUPLICADO')
cu = connect(db).cursor(); cu.execute("select column_default from information_schema.columns where table_name='empresa_config' and column_name='bloquear_pedidos_duplicados'")
dflt = cu.fetchone()[0]
check('T8c. la llave nace APAGADA por defecto (false) y una empresa nueva no bloquea', dflt == 'false')
we = connect(db).cursor(); we.execute("insert into empresas default values returning id"); e_nueva = we.fetchone()[0]
we.execute("insert into empresa_config(empresa_id) values(%s)", (e_nueva,)); we.execute("select bloquear_pedidos_duplicados, pedido_activo_ventana_horas from empresa_config where empresa_id=%s", (e_nueva,))
check('T8d. empresa_config nueva: bloquear=false, ventana=3 h', we.fetchone() == (False, 3))
wf = world(db, bloqueo=True); wo = world(db, bloqueo=False); comprar(wf, 'H-X', tel=TEL); comprar(wo, 'H-X', tel=TEL)
check('T8e. aislamiento por empresa: la que tiene la llave prendida bloquea; la apagada, no (mismo teléfono y contenido)',
      est(reclamar(wf, uuid.uuid4(), 'H-X', tel=TEL)) == 'BLOQUEADO_IDENTICO' and est(reclamar(wo, uuid.uuid4(), 'H-X', tel=TEL)) == 'DUPLICADO')
w = world(db, bloqueo=True, prevenir=False); comprar(w, 'H-X', tel=TEL)
check('T8f. llave prendida pero prevenir_pedidos_repetidos APAGADO: no hay bloqueo (se respeta la prevención apagada)', est(reclamar(w, uuid.uuid4(), 'H-X', tel=TEL)) == 'NUEVA' and est(reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL)) == 'NUEVA')

print('=== T9 · kiosco, caja y mesas (alcance=false): sin cambios aunque la llave esté prendida ===')
w = world(db, bloqueo=True); _, _, p = comprar(w, 'H-X', tel=TEL, alcance=False); estado(w, p, 'READY')
rd = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL, alcance=False); op = uuid.uuid4(); ri = reclamar(w, op, 'H-X', tel=TEL, alcance=False); rc = reclamar(w, op, 'H-X', tel=TEL, alcance=False, confirmar=True)
check('T9. fuera de alcance: contenido distinto → nuevo; idéntico → DUPLICADO clásico; "Sí, continuar" legacy funciona', est(rd) == 'NUEVA' and est(ri) == 'DUPLICADO' and est(rc) == 'NUEVA', f'{est(rd)} {est(ri)} {est(rc)}')
w = world(db, bloqueo=True); comprar(w, 'H-X', vis='v1', alcance=False); r8 = reclamar(w, uuid.uuid4(), 'H-X', vis='v1', ocho=True)      # los 8 parámetros históricos (los dos nuevos con su default)
check('T9b. el llamador histórico (8 parámetros, sin alcance) sigue funcionando y no entra en modo bloqueo', est(r8) == 'DUPLICADO')
cu = connect(db).cursor(); cu.execute("select count(*) from pg_proc where proname='reclamar_operacion_pedido'")
check('T9c. queda UNA sola función reclamar_operacion_pedido (la llamada por nombre no es ambigua)', cu.fetchone()[0] == 1)

print('=== T10 · concurrencia real (conexiones separadas, barrera) ===')
def correr(n, hacer):
    out = [None] * n; bar = threading.Barrier(n); conns = [connect(db) for _ in range(n)]
    def run(i):
        bar.wait(); out[i] = hacer(i, conns[i])
    ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in ts: t.start()
    for t in ts: t.join()
    for c in conns: c.close()
    return out
def intento(w, huella, tel, conn, vis=None, disp=None):
    op = uuid.uuid4(); r = reclamar(w, op, huella, tel=tel, vis=vis, disp=disp, conn=conn)
    if est(r) == 'NUEVA': p = venta(w, conn=conn, op=op); completar(w, op, p, conn=conn)
    return est(r)
ok_dist = ok_ig = True; detalle = []
for k in range(25):
    w = world(db); tel = f'11{k:08d}'
    res = correr(2, lambda i, c: intento(w, f'H-{i}', tel, c, vis=f'vis-{i}', disp=uuid.uuid4()))
    ok_dist &= sorted(res) == ['NUEVA', 'PEDIDO_ACTIVO'] and npedidos(w) == 1
    if sorted(res) != ['NUEVA', 'PEDIDO_ACTIVO']: detalle.append(res)
check('T10. 25 rondas × 2 solicitudes simultáneas del MISMO teléfono con contenido DISTINTO: siempre exactamente 1 pedido (1 NUEVA + 1 PEDIDO_ACTIVO)', ok_dist, str(detalle[:3]))
detalle = []
for k in range(25):
    w = world(db); tel = f'12{k:08d}'
    res = correr(2, lambda i, c: intento(w, 'H-IGUAL', tel, c, vis=f'vis-{i}', disp=uuid.uuid4()))
    ok_ig &= sorted(res) == ['BLOQUEADO_IDENTICO', 'NUEVA'] and npedidos(w) == 1
    if sorted(res) != ['BLOQUEADO_IDENTICO', 'NUEVA']: detalle.append(res)
check('T10b. 25 rondas × 2 solicitudes simultáneas con contenido IDÉNTICO: siempre exactamente 1 pedido (1 NUEVA + 1 BLOQUEADO_IDENTICO)', ok_ig, str(detalle[:3]))
ok8 = True; detalle = []
for k in range(10):
    w = world(db); tel = f'13{k:08d}'
    res = correr(8, lambda i, c: intento(w, f'H-{i % 4}', tel, c, vis=f'vis-{i}', disp=uuid.uuid4()))
    ok8 &= res.count('NUEVA') == 1 and npedidos(w) == 1 and all(x in ('PEDIDO_ACTIVO', 'BLOQUEADO_IDENTICO') for x in res if x != 'NUEVA')
    if res.count('NUEVA') != 1: detalle.append(res)
check('T10c. 10 rondas × 8 solicitudes simultáneas del mismo teléfono (4 contenidos distintos, repetidos): siempre exactamente 1 pedido', ok8, str(detalle[:2]))
w = world(db); res = correr(6, lambda i, c: intento(w, f'H-{i}', f'14{i:08d}', c, vis=f'vis-{i}'))
check('T10d. 6 solicitudes simultáneas de teléfonos DISTINTOS no se bloquean entre sí (6 pedidos, sin deadlock)', res.count('NUEVA') == 6 and npedidos(w) == 6, str(res))
w = world(db); res = correr(6, lambda i, c: intento(w, f'H-{i}', None, c, vis=f'vis-{i}', disp=uuid.uuid4()))
check('T10e. 6 solicitudes simultáneas SIN teléfono (rama de identidad por visitante, sin lock de teléfono): 6 pedidos, sin deadlock', res.count('NUEVA') == 6 and npedidos(w) == 6, str(res))
w = world(db); tel = '1511111111'; op = uuid.uuid4()
res = correr(4, lambda i, c: est(reclamar(w, op, 'H-MISMA', tel=tel, conn=c)))
check('T10f. la MISMA operación enviada 4 veces a la vez (doble clic): una sola NUEVA, el resto EN_CURSO (idempotencia intacta)', res.count('NUEVA') == 1 and res.count('EN_CURSO') == 3, str(res))

print('=== BORDES · ventana, normalización, aislamiento ===')
w = world(db, horas=1); _, _, p = comprar(w, 'H-X', tel=TEL); envejecer(w, 59); r1 = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL); envejecer(w, 2); r2 = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL)
check('B1. ventana de "pedido activo" configurable (1 h): a los 59 min advierte; a los 61 min no (un pedido viejo colgado no bloquea al teléfono para siempre)', est(r1) == 'PEDIDO_ACTIVO' and est(r2) == 'NUEVA')
w = world(db); _, _, p = comprar(w, 'H-X', tel='2302514650')
fmts = {'+54 9 2302 51-4650': 'PEDIDO_ACTIVO', '02302514650': 'PEDIDO_ACTIVO', '(2302) 514650': 'PEDIDO_ACTIVO', '5492302514650': 'PEDIDO_ACTIVO', '2302514651': 'NUEVA', '12345': 'NUEVA'}
res = {f: est(reclamar(w, uuid.uuid4(), 'H-Y', tel=f)) for f in fmts}
check('B2. el teléfono se NORMALIZA: +54 9…, 0…, con espacios/guiones/paréntesis matchean; otro número no; <6 dígitos no entra al nivel 2', res == fmts, str(res))
cu = connect(db).cursor(); cu.execute("select normalizar_telefono_pedido('+54 9 2302 51-4650'), normalizar_telefono_pedido('02302514650'), normalizar_telefono_pedido('2302514650'), normalizar_telefono_pedido('1234'), normalizar_telefono_pedido(null), normalizar_telefono_pedido('5412345678')")
check('B2b. normalizar_telefono_pedido directa', cu.fetchone() == ('2302514650', '2302514650', '2302514650', None, None, '12345678'))
w = world(db); comprar(w, 'H-X', tel=TEL)
check('B3. otra SUCURSAL de la misma empresa: no se cruza', est(reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL, suc=w['suc2'])) == 'NUEVA')
w2 = world(db); check('B4. otra EMPRESA con el mismo teléfono: no se cruza (aislamiento por empresa_id)', est(reclamar(w2, uuid.uuid4(), 'H-Y', tel=TEL)) == 'NUEVA')
w = world(db); op = uuid.uuid4(); reclamar(w, op, 'H-X', tel=TEL)       # EN_CURSO sin pedido: reciente cuenta, abandonada no
rr = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL); envejecer(w, 1)         # 60 s
rr2 = reclamar(w, uuid.uuid4(), 'H-Z', tel=TEL); connect(db).cursor().execute("update pedido_operaciones set updated_at = now() - interval '5 minutes' where empresa_id=%s and operacion_id=%s", (w['emp'], op))
rr3 = reclamar(w, uuid.uuid4(), 'H-W', tel=TEL)
check('B5. operación EN_CURSO sin pedido: cuenta mientras es reciente (<90 s: es la carrera) y deja de contar si quedó abandonada', est(rr) == 'PEDIDO_ACTIVO' and est(rr2) == 'PEDIDO_ACTIVO' and est(rr3) == 'NUEVA', f'{est(rr)} {est(rr2)} {est(rr3)}')
w = world(db); r = reclamar(w, uuid.uuid4(), 'H-X', tel=None)
check('B6. sin teléfono no hay nivel 2 (no se inventa una identidad)', est(r) == 'NUEVA')
w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, 'READY'); op = uuid.uuid4()
a1 = reclamar(w, op, 'H-Y', tel=TEL); estado(w, p, 'DELIVERED'); a2 = reclamar(w, op, 'H-Y', tel=TEL)
check('B7. operación ADVERTIDA cuyo pedido activo ya se entregó: al reintentar se re-evalúa y pasa como NUEVA (sin pedir excepción)', est(a1) == 'PEDIDO_ACTIVO' and est(a2) == 'NUEVA')

print('=== SEGURIDAD · privilegios y prechecks ===')
cu = connect(db).cursor(); cu.execute("select has_function_privilege(r, 'reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean)', 'execute'), has_function_privilege(r, 'normalizar_telefono_pedido(text)', 'execute') from unnest(array['anon','authenticated','service_role']) r")
priv = cu.fetchall()
check('S1. EXECUTE solo para service_role (anon y authenticated no pueden llamar ni reclamar ni normalizar)', priv == [(False, False), (False, False), (True, True)], str(priv))
cu.execute("select prosecdef, proconfig from pg_proc where proname='reclamar_operacion_pedido'"); sd = cu.fetchone()
check('S2. SECURITY DEFINER con search_path fijo (pg_catalog, pg_temp)', sd[0] is True and any('pg_catalog' in x for x in sd[1]), str(sd))
c = fresh('blq_pre1'); err, _ = aplicar(c, NUEVO)
check('S3. sin pedidos-repetidos.sql aplicado, el script aborta con PRECHECK y no deja nada', err is not None and 'PRECHECK' in err, (err or '')[:90])
c = fresh('blq_pre2')
for f in BASE: c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
c.execute("comment on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) is 'otro'"); err, _ = aplicar(c, NUEVO)
c.execute("select count(*) from information_schema.columns where table_name='empresa_config' and column_name='bloquear_pedidos_duplicados'"); ncol = c.fetchone()[0]
check('S4. función de reclamo ajena (sin la marca): el script aborta y NO deja columnas a medias (todo o nada)', err is not None and 'PRECHECK' in err and ncol == 0, (err or '')[:90])
c = fresh('blq_pre3')
for f in BASE: c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
c.execute("create function public.normalizar_telefono_pedido(t text) returns text language sql as $$ select t $$"); err, _ = aplicar(c, NUEVO)
check('S5. normalizar_telefono_pedido ajena preexistente: el script aborta y no la pisa', err is not None and 'PRECHECK' in err, (err or '')[:90])
c = fresh('blq_pre4')
for f in BASE: c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
c.execute("alter table empresa_config add column bloquear_pedidos_duplicados text"); err, _ = aplicar(c, NUEVO)
check('S6. columna de la llave preexistente con otro tipo: el script aborta', err is not None and 'PRECHECK' in err, (err or '')[:90])
c = fresh('blq_idem')
for f in BASE: c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
e1, _ = aplicar(c, NUEVO); e2, _ = aplicar(c, NUEVO)
c.execute("select count(*), max(pronargs) from pg_proc where proname='reclamar_operacion_pedido'"); n = c.fetchone()
check('S7. el script se puede aplicar dos veces seguidas (idempotente): una sola función de 10 parámetros', e1 is None and e2 is None and n == (1, 10), str(n))

print('=== REVERSIÓN ===')
cc = fresh('blq_ctrl')
for f in BASE: cc.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
cc.execute("select md5(pg_get_functiondef('public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)'::regprocedure))"); md5_orig = cc.fetchone()[0]
c = fresh('blq_rev')
for f in BASE + (NUEVO,): c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
wr = world('blq_rev'); comprar(wr, 'H-X', tel=TEL)
err, _ = aplicar(c, REVERSION)
c.execute("select count(*), max(pronargs) from pg_proc where proname='reclamar_operacion_pedido'"); n = c.fetchone()
c.execute("select md5(pg_get_functiondef('public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)'::regprocedure))"); md5_rev = c.fetchone()[0]
c.execute("select count(*) from information_schema.columns where table_name='empresa_config' and column_name in ('bloquear_pedidos_duplicados','pedido_activo_ventana_horas')"); ncol = c.fetchone()[0]
c.execute("select count(*) from pg_proc where proname='normalizar_telefono_pedido'"); nn = c.fetchone()[0]
c.execute("select count(*) from pedidos"); npd = c.fetchone()[0]
c.execute("select count(*) from pedido_operaciones"); nop = c.fetchone()[0]
c.execute("select has_function_privilege('anon','reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)','execute'), has_function_privilege('service_role','reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)','execute')"); pv = c.fetchone()
check('R1. reversión: vuelve UNA función de 8 parámetros con el cuerpo EXACTO (md5 idéntico al de pedidos-repetidos.sql), sin columnas ni función de teléfono', err is None and n == (1, 8) and md5_rev == md5_orig and ncol == 0 and nn == 0, f'{err} {n} {md5_rev == md5_orig} cols={ncol}')
check('R2. la reversión NO borra pedidos ni operaciones y deja los permisos correctos', npd == 1 and nop == 1 and pv == (False, True), f'pedidos={npd} ops={nop} {pv}')
err2, _ = aplicar(c, NUEVO); c.execute("select count(*), max(pronargs) from pg_proc where proname='reclamar_operacion_pedido'")
check('R3. después de revertir se puede re-aplicar el bloqueo', err2 is None and c.fetchone() == (1, 10))
err3, _ = aplicar(c, REVERSION); err4, _ = aplicar(c, REVERSION)
check('R4. la reversión se puede correr dos veces seguidas sin error', err3 is None and err4 is None)

print(f'\n{sum(R)}/{len(R)} PASS')
raise SystemExit(0 if all(R) else 1)
