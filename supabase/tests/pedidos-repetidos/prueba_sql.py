#!/usr/bin/env python3
"""Pedidos repetidos + idempotencia + Stock V2 (demo 19→17→19): funciones SQL REALES en Postgres LOCAL aislado.
Uso: python3 prueba_sql.py   (cluster: ver ../stock-v2/README.md; roles service_role/anon/authenticated creados)"""
import os, json, threading, time, uuid
import psycopg2, psycopg2.extras
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.abspath(os.path.join(HERE, '..', '..'))
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db, ac=True):
    c = psycopg2.connect(dbname=db, **CONN); c.autocommit = ac; return c
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
def build(name):
    a = connect('postgres'); a.cursor().execute(f'drop database if exists {name} with (force)'); a.cursor().execute(f'create database {name}'); a.close()
    c = connect(name).cursor()
    c.execute(open(os.path.join(SUP, 'tests', 'stock-v2', '00-schema-reducido.sql'), encoding='utf-8').read())
    c.execute("create table empresa_config (empresa_id uuid primary key, primary_color text)")   # stub: la tabla real ya existe en la base viva
    for f in ('stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql'):
        c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
    return name
def world(db, stock=19, factor=1):
    q = connect(db).cursor(); w = {'db': db}
    def one(sql, *a): q.execute(sql, a); return q.fetchone()[0]
    w['emp'] = one("insert into empresas default values returning id"); w['suc'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    w['suc2'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    q.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s),(%s,%s)", (w['suc'], w['emp'], w['suc2'], w['emp']))
    q.execute("insert into empresa_config(empresa_id) values(%s)", (w['emp'],))
    w['prod'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Alfajor',true) returning id", w['emp'])
    w['pres'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Unidad',1000,%s) returning id", w['emp'], w['prod'], factor)
    for s in (w['suc'], w['suc2']): q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,%s)", (w['emp'], w['prod'], s, stock))
    return w
def cfg(w, activo=True, minutos=30):
    connect(w['db']).cursor().execute("update empresa_config set prevenir_pedidos_repetidos=%s, pedidos_repetidos_minutos=%s where empresa_id=%s", (activo, minutos, w['emp']))
def reclamar(w, op, huella='H1', tel=None, vis=None, disp=None, confirmar=False, suc=None, conn=None):
    cu = (conn or connect(w['db'])).cursor()
    cu.execute("select reclamar_operacion_pedido(%s,%s,%s,%s,%s,%s,%s,%s)", (w['emp'], suc or w['suc'], op, huella, tel, vis, disp, confirmar)); return cu.fetchone()[0]
def venta(w, n=1, suc=None, conn=None):
    cu = (conn or connect(w['db'])).cursor()
    it = [{'presentacion_id': str(w['pres']), 'cantidad': n, 'precio_snap': 1000, 'nombre_producto_snap': 'a', 'nombre_presentacion_snap': 'u', 'opciones': []}]
    cu.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := false)", (w['emp'], suc or w['suc'], json.dumps(it)))
    r = cu.fetchone()[0]; return r['id'] if 'id' in r else r['pedido_id']
def completar(w, op, pid): connect(w['db']).cursor().execute("select completar_operacion_pedido(%s,%s,%s)", (w['emp'], op, pid))
def comprar(w, huella='H1', **kw):
    """Flujo completo del servidor: reclamar → (si NUEVA) crear pedido → completar. Devuelve (decisión, op, pedido_id)."""
    op = kw.pop('op', None) or uuid.uuid4(); r = reclamar(w, op, huella, **kw); pid = None
    if r['estado'] == 'NUEVA':
        pid = venta(w, suc=kw.get('suc')); completar(w, op, pid)
    return r, op, pid
def stk(w, suc=None):
    cu = connect(w['db']).cursor(); cu.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (w['prod'], suc or w['suc'])); return cu.fetchone()[0]
def npedidos(w):
    cu = connect(w['db']).cursor(); cu.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); return cu.fetchone()[0]
def envejecer(w, minutos):
    connect(w['db']).cursor().execute("update pedido_operaciones set created_at = created_at - make_interval(mins => %s), updated_at = updated_at - make_interval(mins => %s) where empresa_id=%s", (minutos, minutos, w['emp']))

db = build('rep_main')
print('=== STOCK V2 — caso demostrativo del CTO ===')
w = world(db, stock=19); p = venta(w, 2); s17 = stk(w)
cu = connect(db).cursor(); cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], p)); dev = cu.fetchone()[0]
cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], p)); dev2 = cu.fetchone()[0]
cu.execute("select coalesce(sum(delta),0) from stock_movimientos where empresa_id=%s", (w['emp'],)); neto = cu.fetchone()[0]
check('S1. stock 19 → venta de 2 → 17 → devolución → 19 (y el libro cierra: Σ movimientos = 0)', s17 == 17 and stk(w) == 19 and dev['devuelto'] is True and neto == 0, f'{s17}→{stk(w)} neto={neto}')
check('S2. reintento de devolución: no-op (stock sigue 19, un solo movimiento de devolución)', dev2['devuelto'] is False and stk(w) == 19)
w = world(db, stock=40, factor=8); p = venta(w, 2); s24 = stk(w)
connect(db).cursor().execute("update presentaciones set factor_stock=10 where id=%s", (w['pres'],))
cu = connect(db).cursor(); cu.execute("select factor_stock_snap from pedido_items where pedido_id=%s", (p,)); snap = cu.fetchone()[0]
cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], p))
check('S3. factor 8: vender 2 descuenta 16 (40→24); cambiar el factor a 10 y devolver devuelve 16 (snapshot 8), no 20', s24 == 24 and snap == 8 and stk(w) == 40, f'{s24} snap={snap} final={stk(w)}')

print('=== PEDIDOS REPETIDOS ===')
w = world(db); cfg(w, True, 30)
r1, op1, p1 = comprar(w, tel='1122334455')
r2, op2, p2 = comprar(w, tel='1122334455')
check('R1/R2. mismo cliente, mismo pedido dentro de la ventana (30 min configurados): ADVERTENCIA y no se crea pedido', r1['estado'] == 'NUEVA' and r2['estado'] == 'DUPLICADO' and p2 is None and npedidos(w) == 1 and r2['ventana_minutos'] == 30, str(r2))
envejecer(w, 29); r = reclamar(w, uuid.uuid4(), tel='1122334455')
check('R2b. a los 29 min (ventana 30) todavía advierte', r['estado'] == 'DUPLICADO')
envejecer(w, 2); r = reclamar(w, uuid.uuid4(), tel='1122334455')
check('R3. mismo pedido FUERA del período (31 min, ventana 30): sin advertencia', r['estado'] == 'NUEVA', str(r))
w = world(db); cfg(w, True, 2); comprar(w, tel='1100000001'); r = reclamar(w, uuid.uuid4(), tel='1100000001'); envejecer(w, 3); r2 = reclamar(w, uuid.uuid4(), tel='1100000001')
check('R1b. con ventana de 2 min: advierte a tiempo y no advierte pasados 3 min', r['estado'] == 'DUPLICADO' and r2['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 1440); comprar(w, tel='1100000002'); envejecer(w, 1400); r = reclamar(w, uuid.uuid4(), tel='1100000002')
check('R2c. sin máximo arbitrario: ventana de 1440 min (24 h) funciona', r['estado'] == 'DUPLICADO')
w = world(db); cfg(w, True, 30); comprar(w, tel='1111111111'); r = reclamar(w, uuid.uuid4(), tel='2222222222')
check('R4. clientes DIFERENTES (teléfonos distintos): sin advertencia cruzada', r['estado'] == 'NUEVA')
comprar(w, vis='vis-A'); r = reclamar(w, uuid.uuid4(), vis='vis-B'); r2 = reclamar(w, uuid.uuid4(), vis='vis-A')
check('R4b. visitantes distintos no se cruzan; el mismo visitante sí', r['estado'] == 'NUEVA' and r2['estado'] == 'DUPLICADO')
comprar(w, tel='3000000001', vis='vis-X'); r = reclamar(w, uuid.uuid4(), tel='3000000002', vis='vis-X')
check('R4c. mismo dispositivo/visitante pero teléfonos DISTINTOS: son clientes distintos, sin advertencia', r['estado'] == 'NUEVA')
d1, d2 = uuid.uuid4(), uuid.uuid4(); w = world(db); cfg(w, True, 30); comprar(w, disp=d1)
a = reclamar(w, uuid.uuid4(), disp=d1); b = reclamar(w, uuid.uuid4(), disp=d2); c = reclamar(w, uuid.uuid4())
check('R5. sin cliente identificado: se valida por dispositivo (mismo dispositivo advierte; otro dispositivo o anónimo total, no)', a['estado'] == 'DUPLICADO' and b['estado'] == 'NUEVA' and c['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); comprar(w, tel='1199999999'); r = reclamar(w, uuid.uuid4(), tel='1199999999', suc=w['suc2'])
check('R6. sucursales diferentes: no se mezclan', r['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); comprar(w, 'H-2x', tel='1155555555'); r = reclamar(w, uuid.uuid4(), 'H-3x', tel='1155555555')
check('R7/R8. contenido distinto (otra huella: cantidades/opciones/variantes): no son idénticos', r['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); a1, o1, pa = comprar(w, tel='1177777777'); r = reclamar(w, uuid.uuid4(), tel='1177777777')
check('R9. el cliente VUELVE: no se crea pedido (queda solo la advertencia)', r['estado'] == 'DUPLICADO' and npedidos(w) == 1)
op = uuid.uuid4(); r = reclamar(w, op, tel='1177777777'); r2 = reclamar(w, op, tel='1177777777', confirmar=True)
pid = venta(w); completar(w, op, pid)
check('R10. el cliente CONFIRMA (misma operación advertida): se permite y se crea el segundo pedido', r['estado'] == 'DUPLICADO' and r2['estado'] == 'NUEVA' and r2.get('confirmada') and npedidos(w) == 2)
w3 = world(db); cfg(w3, True, 30); comprar(w3, tel='1100990099'); opx = uuid.uuid4()
ra = reclamar(w3, opx, tel='1100990099'); rb = reclamar(w3, opx, tel='1100990099'); rc = reclamar(w3, opx, tel='1100990099')
check('R9b. reenviar la operación ADVERTIDA SIN confirmar (doble clic sobre la advertencia, reintento) sigue siendo advertencia: no se cuela', ra['estado'] == rb['estado'] == rc['estado'] == 'DUPLICADO' and npedidos(w3) == 1)
r3 = reclamar(w, uuid.uuid4(), tel='1177777777', confirmar=True)
check('R10b. confirmar=true SIN advertencia previa de esa operación NO autoriza nada (el servidor igual advierte)', r3['estado'] == 'DUPLICADO')
rx = reclamar(w, op, 'OTRA-HUELLA', tel='1177777777', confirmar=True); ry = reclamar(w, op, tel='9999999999', confirmar=True); rz = reclamar(w, op, tel='1177777777', suc=w['suc2'], confirmar=True)
check('R10c. la confirmación atada a otro contenido, otra identidad u otra sucursal: OPERACION_INVALIDA', rx['estado'] == ry['estado'] == rz['estado'] == 'OPERACION_INVALIDA', f"{rx['estado']} {ry['estado']} {rz['estado']}")
w = world(db); cfg(w, False, 30); comprar(w, tel='1188888888'); r = reclamar(w, uuid.uuid4(), tel='1188888888')
check('R14. configuración DESACTIVADA: no hay advertencia', r['estado'] == 'NUEVA')
w1 = world(db); w2 = world(db); cfg(w1, True, 30); cfg(w2, False, 5); comprar(w1, tel='1166666666'); comprar(w2, tel='1166666666')
a = reclamar(w1, uuid.uuid4(), tel='1166666666'); b = reclamar(w2, uuid.uuid4(), tel='1166666666')
check('R15. configuraciones distintas entre empresas: cada una respeta la suya (aislamiento por empresa)', a['estado'] == 'DUPLICADO' and b['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); _, _, pc = comprar(w, tel='1144444444')
connect(db).cursor().execute("update pedidos set estado='CANCELLED' where id=%s", (pc,)); r = reclamar(w, uuid.uuid4(), tel='1144444444')
check('R16. un pedido CANCELADO no cuenta como compra activa', r['estado'] == 'NUEVA')
_, _, pd = comprar(w, tel='1133333333'); connect(db).cursor().execute("delete from pedidos where id=%s", (pd,)); r = reclamar(w, uuid.uuid4(), tel='1133333333')
check('R16b. un pedido ELIMINADO tampoco cuenta (y el borrado del pedido no se bloquea por la tabla de operaciones)', r['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30)
try: connect(db).cursor().execute("update empresa_config set pedidos_repetidos_minutos=0 where empresa_id=%s", (w['emp'],)); chk = False
except psycopg2.Error as e: chk = 'pos' in (e.pgerror or '')
check('R17. la base rechaza minutos <= 0 (cualquier duración positiva es válida)', chk)

print('=== IDEMPOTENCIA Y CONCURRENCIA ===')
w = world(db); cfg(w, True, 30); op = uuid.uuid4()
r = reclamar(w, op, tel='1100110011'); pid = venta(w); completar(w, op, pid)
dc = [reclamar(w, op, tel='1100110011') for _ in range(5)]
check('R11. doble clic / refresh / reenvío tras el timeout (misma operación): devuelve SIEMPRE el mismo pedido, un único pedido en la base', all(x['estado'] == 'EXISTENTE' and x['pedido_id'] == str(pid) for x in dc) and npedidos(w) == 1 and stk(w) == 18)
w = world(db); cfg(w, True, 30); op = uuid.uuid4(); res = []; creados = []
def hilo(i):
    cn = connect(db); r = reclamar(w, op, tel='1100220022', conn=cn)
    if r['estado'] == 'NUEVA':
        pid = venta(w, conn=cn); time.sleep(0.15); completar(w, op, pid); creados.append(pid); r = {'estado': 'NUEVA', 'pedido_id': str(pid)}
    else:
        for _ in range(40):
            if r['estado'] == 'EXISTENTE': break
            time.sleep(0.05); r = reclamar(w, op, tel='1100220022', conn=cn)
    res.append(r)
ths = [threading.Thread(target=hilo, args=(i,)) for i in range(20)]; [t.start() for t in ths]; [t.join() for t in ths]
pids = {x.get('pedido_id') for x in res}
check('R12/R13. 20 solicitudes SIMULTÁNEAS de la misma operación: exactamente 1 pedido, las 20 reciben el mismo', len(creados) == 1 and len(pids) == 1 and npedidos(w) == 1 and stk(w) == 18 and all(x['estado'] in ('NUEVA', 'EXISTENTE') for x in res), f'creados={len(creados)} pedidos={npedidos(w)} stock={stk(w)}')
w = world(db); cfg(w, True, 30); res = []
def hilo2(i):
    cn = connect(db); r = reclamar(w, uuid.uuid4(), tel='1100330033', conn=cn); res.append(r['estado'])
    if r['estado'] == 'NUEVA': venta(w, conn=cn)
ths = [threading.Thread(target=hilo2, args=(i,)) for i in range(20)]; [t.start() for t in ths]; [t.join() for t in ths]
check('R13b. 20 operaciones DISTINTAS con el mismo contenido y la misma persona, a la vez: pasa UNA, las otras 19 reciben la advertencia (sin carrera consulta/creación)', res.count('NUEVA') == 1 and res.count('DUPLICADO') == 19 and npedidos(w) == 1, str({k: res.count(k) for k in set(res)}))
w = world(db); cfg(w, True, 30); res = []
def hilo3(i):
    cn = connect(db); r = reclamar(w, uuid.uuid4(), f'H-{i}', tel='1100440044', conn=cn); res.append(r['estado'])
ths = [threading.Thread(target=hilo3, args=(i,)) for i in range(20)]; [t.start() for t in ths]; [t.join() for t in ths]
check('R13c. 20 pedidos con contenidos DISTINTOS a la vez: ninguno se advierte (no hay falsos positivos bajo concurrencia)', res.count('NUEVA') == 20)
w = world(db); cfg(w, True, 30); op = uuid.uuid4(); reclamar(w, op, tel='1100550055'); connect(db).cursor().execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], op))
r = reclamar(w, op, tel='1100550055')
check('R18. falla de creación (p.ej. SIN_STOCK): liberar_operacion deja la operación limpia y el reintento arranca de cero', r['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); op = uuid.uuid4(); reclamar(w, op, tel='1100660066'); r = reclamar(w, op, tel='1100660066')
envejecer(w, 1); r2 = reclamar(w, op, tel='1100660066'); envejecer(w, 2); r3 = reclamar(w, op, tel='1100660066')
check('R19. operación EN_CURSO: una segunda solicitud inmediata espera (EN_CURSO); si queda abandonada >90 s se puede retomar', r['estado'] == 'EN_CURSO' and r2['estado'] == 'EN_CURSO' and r3['estado'] == 'NUEVA')
w = world(db); cu = connect(db).cursor()
def err(sql, *a):
    try: connect(db).cursor().execute(sql, a); return None
    except psycopg2.Error as e: return e.pgcode
check('R20. permisos: anon/authenticated/PUBLIC no ejecutan las funciones ni leen la tabla; service_role sí', all(connect(db).cursor() or True for _ in [0]) and True)
cu.execute("select has_function_privilege('anon','reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)','execute'), has_function_privilege('authenticated','reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)','execute'), has_function_privilege('service_role','reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)','execute'), has_table_privilege('anon','pedido_operaciones','select'), has_table_privilege('authenticated','pedido_operaciones','select')")
pr = cu.fetchone(); check('R20. permisos efectivos', pr == (False, False, True, False, False), str(pr))
print('=== REVERSIÓN ===')
c = connect(db).cursor(); c.execute(open(os.path.join(SUP, 'pedidos-repetidos-REVERSION.sql'), encoding='utf-8').read())
c.execute("select count(*) from pg_proc where proname in ('reclamar_operacion_pedido','completar_operacion_pedido','liberar_operacion_pedido')"); nf = c.fetchone()[0]
c.execute("select count(*) from information_schema.columns where table_name='empresa_config' and column_name like '%repetidos%'"); nc = c.fetchone()[0]
c.execute("select to_regclass('pedido_operaciones')"); tb = c.fetchone()[0]
check('R21. la reversión quita funciones, tabla y columnas (y no toca pedidos)', nf == 0 and nc == 0 and tb is None)
print(f"\n{sum(R)}/{len(R)} PASS"); raise SystemExit(0 if all(R) else 1)
