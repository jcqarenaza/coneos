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
    c.execute("alter table pedidos add column if not exists mp_payment_id text")   # existe en producción (lo graba el webhook MP); el esquema reducido no la trae
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
      est(a) == 'NUEVA' and est(r) == 'PEDIDO_ACTIVO' and npedidos(w) == 1, str(r))
check('T1b. PRIVACIDAD (CTO 14/11): por teléfono solo, la base NO devuelve id, número ni estado del pedido ajeno; solo mismo_visitante=false y la ventana',
      r['existente'] == {'mismo_visitante': False} and r['ventana_horas'] == 3 and str(pa) not in json.dumps(r), str(r))
r_mismo = reclamar(w, uuid.uuid4(), 'H-49b', tel=TEL, vis='vis-sandra-celu', disp=uuid.uuid4())
check('T1c. mismo teléfono + MISMO visitante (la dueña en su navegador): PEDIDO_ACTIVO y SÍ trae su pedido (id, número, estado) para «Ver mi pedido»',
      est(r_mismo) == 'PEDIDO_ACTIVO' and r_mismo['existente']['mismo_visitante'] is True and r_mismo['existente']['pedido_id'] == str(pa)
      and r_mismo['existente']['numero_pedido'] is not None and r_mismo['existente']['estado'] == 'READY', str(r_mismo))
w = world(db); a2, _, pa2 = comprar(w, 'H-43', tel=TEL, vis=None); estado(w, pa2, 'READY'); r_nulo = reclamar(w, uuid.uuid4(), 'H-49', tel=TEL, vis=None)
check('T1d. visitante NULL en ambos NO es coincidencia (null = null no autoriza nada): PEDIDO_ACTIVO sin pedido_id',
      est(r_nulo) == 'PEDIDO_ACTIVO' and r_nulo['existente'] == {'mismo_visitante': False}, str(r_nulo))
dsp = uuid.uuid4(); w = world(db); a3, _, pa3 = comprar(w, 'H-43', tel=TEL, vis='vis-A', disp=dsp); estado(w, pa3, 'READY'); r_disp = reclamar(w, uuid.uuid4(), 'H-49', tel=TEL, vis='vis-B', disp=dsp)
check('T1e. delivery real: MISMO dispositivo compartido pero otro visitante → no se entrega el pedido (el dispositivo no es criterio de acceso)',
      est(r_disp) == 'PEDIDO_ACTIVO' and r_disp['existente'] == {'mismo_visitante': False}, str(r_disp))

print('=== T2/T3 · estados activos ===')
for e in ('READY', 'PENDING_PAYMENT', 'PAID', 'PREPARING'):
    w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL, vis='vis-T'); estado(w, p, e); r = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL, vis='vis-T')
    check(f'T2/T3. teléfono con pedido {e}: advertencia fuerte (PEDIDO_ACTIVO)', est(r) == 'PEDIDO_ACTIVO' and r['existente']['estado'] == e, str(r))
    w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL, vis='vis-T'); estado(w, p, e); r = reclamar(w, uuid.uuid4(), 'H-Y', tel=TEL, vis='vis-OTRO')
    check(f'T2/T3b. teléfono con pedido {e} y OTRO visitante: se detecta igual, sin entregar el pedido', est(r) == 'PEDIDO_ACTIVO' and r['existente'] == {'mismo_visitante': False}, str(r))

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
check('T6c. (D1 CTO 14/11) mismo teléfono + contenido IDÉNTICO, otro visitante: aviso PEDIDO_ACTIVO con coincidencia IDENTICA, SIN entregar el pedido ajeno',
      est(r) == 'PEDIDO_ACTIVO' and r['coincidencia'] == 'IDENTICA' and r['existente'] == {'mismo_visitante': False} and str(p) not in json.dumps(r) and npedidos(w) == 1, str(r))
r_id = reclamar(w, uuid.uuid4(), 'H-X', tel=TEL, vis='vis-1')
check('T6c2. mismo teléfono + contenido idéntico + MISMO visitante: PEDIDO_ACTIVO (IDENTICA) y trae su pedido para «Ver mi pedido»',
      est(r_id) == 'PEDIDO_ACTIVO' and r_id['coincidencia'] == 'IDENTICA' and r_id['existente']['mismo_visitante'] is True and r_id['existente']['pedido_id'] == str(p) and r_id['existente']['numero_pedido'] is not None, str(r_id))
op = uuid.uuid4(); bs = reclamar(w, uuid.uuid4(), 'H-X', tel=TEL, otro=True)
b1 = reclamar(w, op, 'H-X', tel=TEL); b2 = reclamar(w, op, 'H-X', tel=TEL, confirmar=True); b3 = reclamar(w, op, 'H-X', tel=TEL, otro=True)
check('T6d. (D1) el contenido idéntico YA NO se bloquea: «es otro pedido» sin advertencia previa no vale, la confirmación legacy tampoco, y SÍ vale sobre la operación advertida',
      [est(x) for x in (bs, b1, b2, b3)] == ['PEDIDO_ACTIVO', 'PEDIDO_ACTIVO', 'PEDIDO_ACTIVO', 'NUEVA'] and npedidos(w) == 1, str([est(x) for x in (bs, b1, b2, b3)]))
pid_b = venta(w, op=op); completar(w, op, pid_b)
cu = connect(db).cursor(); cu.execute("select r.estado, r.coincidencia, array_length(r.candidatos,1) from pedido_revisiones_duplicado r where r.empresa_id=%s and r.operacion_id=%s", (w['emp'], op))
check('T6e. al continuar con un pedido idéntico queda UNA revisión PENDIENTE (IDENTICA) con su candidato, y el pedido nuevo es independiente', cu.fetchone() == ('PENDIENTE', 'IDENTICA', 1) and npedidos(w) == 2)
w = world(db); comprar(w, 'H-X', vis='vis-A'); r1 = reclamar(w, uuid.uuid4(), 'H-X', vis='vis-B'); r2 = reclamar(w, uuid.uuid4(), 'H-X', vis='vis-A')
check('T6f. sin teléfono rige la identidad existente por visitante: visitantes distintos no se cruzan; el mismo visitante, idéntico → aviso', est(r1) == 'NUEVA' and est(r2) == 'PEDIDO_ACTIVO' and r2['coincidencia'] == 'IDENTICA')
d1, d2 = uuid.uuid4(), uuid.uuid4(); w = world(db); comprar(w, 'H-X', disp=d1)
check('T6g. sin cliente identificado rige el dispositivo (mismo → aviso; otro dispositivo o anónimo → no)', est(reclamar(w, uuid.uuid4(), 'H-X', disp=d1)) == 'PEDIDO_ACTIVO' and est(reclamar(w, uuid.uuid4(), 'H-X', disp=d2)) == 'NUEVA' and est(reclamar(w, uuid.uuid4(), 'H-X')) == 'NUEVA')
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

print('=== T11 · CORRECCIÓN DE PRIVACIDAD (CTO 14/11): escenario real #43/#49 de punta a punta ===')
DISP = uuid.uuid4()                                   # en delivery el dispositivo es UNO solo, compartido por todos los clientes
w = world(db); _, op43, p43 = comprar(w, 'H-43', tel=TEL, vis='vis-sandra', disp=DISP)       # #43: PENDING_PAYMENT (estado inicial)
cu = connect(db).cursor(); cu.execute("select estado, numero_pedido from pedidos where id=%s", (p43,)); est43_antes, num43 = cu.fetchone()
op49 = uuid.uuid4(); r49 = reclamar(w, op49, 'H-49', tel=TEL, vis='vis-segundo-cliente', disp=DISP)
check('T11a. #49 (mismo teléfono, otro visitante, contenido distinto): se detecta el pedido activo y NO se entrega acceso al #43',
      est43_antes == 'PENDING_PAYMENT' and est(r49) == 'PEDIDO_ACTIVO' and r49['existente'] == {'mismo_visitante': False} and str(p43) not in json.dumps(r49) and npedidos(w) == 1, str(r49))
r49v = reclamar(w, op49, 'H-49', tel=TEL, vis='vis-segundo-cliente', disp=DISP)
check('T11b. «Volver»: no se crea ningún pedido y la operación queda solo ADVERTIDA (nada de stock ni pedido)', est(r49v) == 'PEDIDO_ACTIVO' and npedidos(w) == 1)
r49c = reclamar(w, op49, 'H-49', tel=TEL, vis='vis-segundo-cliente', disp=DISP, otro=True); p49 = venta(w, op=op49); completar(w, op49, p49)
check('T11c. «Es otro pedido, continuar» sin haber visto el link: confirma sobre la operación ya advertida y crea un pedido NUEVO e independiente',
      est(r49c) == 'NUEVA' and p49 != p43 and npedidos(w) == 2, str(r49c))
cu.execute("select estado, numero_pedido, operacion_id from pedidos where id=%s", (p43,)); e43, n43, o43 = cu.fetchone()
cu.execute("select operacion_id, estado from pedidos where id=%s", (p49,)); o49, e49 = cu.fetchone()
check('T11d. el #43 no se modificó ni se reutilizó (mismo estado, número y operación); el #49 tiene su propia operación', (e43, n43, str(o43)) == (est43_antes, num43, str(op43)) and str(o49) == str(op49) and str(o49) != str(o43))
cu.execute("select count(*) from pedido_operaciones where empresa_id=%s and estado='COMPLETADA'", (w['emp'],))
check('T11e. quedan DOS operaciones completadas, una por pedido (cada pedido con su propia llave de seguimiento)', cu.fetchone()[0] == 2)
r43 = reclamar(w, op43, 'H-43', tel=TEL, vis='vis-sandra', disp=DISP)
check('T11f. el primer cliente repite su misma operación: sigue devolviendo SU pedido (EXISTENTE), el #43 intacto', est(r43) == 'EXISTENTE' and r43['pedido_id'] == str(p43))
w = world(db); _, _, pm1 = comprar(w, 'H-1', tel=TEL, vis='vis-A'); estado(w, pm1, 'READY')
opb = uuid.uuid4(); reclamar(w, opb, 'H-2', tel=TEL, vis='vis-B'); reclamar(w, opb, 'H-2', tel=TEL, vis='vis-B', otro=True); pm2 = venta(w, op=opb); completar(w, opb, pm2)   # el 2º pedido del teléfono sale por la excepción explícita
rA = reclamar(w, uuid.uuid4(), 'H-3', tel=TEL, vis='vis-A'); rB = reclamar(w, uuid.uuid4(), 'H-3', tel=TEL, vis='vis-B'); rC = reclamar(w, uuid.uuid4(), 'H-3', tel=TEL, vis='vis-C')
check('T11g. con varios pedidos activos del mismo teléfono cada visitante recibe SU pedido (aunque no sea el más reciente); un tercero no recibe ninguno',
      rA['existente'].get('pedido_id') == str(pm1) and rB['existente'].get('pedido_id') == str(pm2) and rC['existente'] == {'mismo_visitante': False}, f"{rA['existente']} {rB['existente']} {rC['existente']}")

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
check('T8e. aislamiento por empresa: la que tiene la llave prendida avisa (PEDIDO_ACTIVO); la apagada usa la advertencia de siempre (DUPLICADO) (mismo teléfono y contenido)',
      est(reclamar(wf, uuid.uuid4(), 'H-X', tel=TEL)) == 'PEDIDO_ACTIVO' and est(reclamar(wo, uuid.uuid4(), 'H-X', tel=TEL)) == 'DUPLICADO')
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
    ok_ig &= sorted(res) == ['NUEVA', 'PEDIDO_ACTIVO'] and npedidos(w) == 1
    if sorted(res) != ['NUEVA', 'PEDIDO_ACTIVO']: detalle.append(res)
check('T10b. 25 rondas × 2 solicitudes simultáneas con contenido IDÉNTICO: siempre exactamente 1 pedido (1 NUEVA + 1 PEDIDO_ACTIVO)', ok_ig, str(detalle[:3]))
ok8 = True; detalle = []
for k in range(10):
    w = world(db); tel = f'13{k:08d}'
    res = correr(8, lambda i, c: intento(w, f'H-{i % 4}', tel, c, vis=f'vis-{i}', disp=uuid.uuid4()))
    ok8 &= res.count('NUEVA') == 1 and npedidos(w) == 1 and all(x == 'PEDIDO_ACTIVO' for x in res if x != 'NUEVA')
    if res.count('NUEVA') != 1: detalle.append(res)
check('T10c. 10 rondas × 8 solicitudes simultáneas del mismo teléfono (4 contenidos distintos, repetidos): siempre exactamente 1 pedido', ok8, str(detalle[:2]))
w = world(db); res = correr(6, lambda i, c: intento(w, f'H-{i}', f'14{i:08d}', c, vis=f'vis-{i}'))
check('T10d. 6 solicitudes simultáneas de teléfonos DISTINTOS no se bloquean entre sí (6 pedidos, sin deadlock)', res.count('NUEVA') == 6 and npedidos(w) == 6, str(res))
w = world(db); res = correr(6, lambda i, c: intento(w, f'H-{i}', None, c, vis=f'vis-{i}', disp=uuid.uuid4()))
check('T10e. 6 solicitudes simultáneas SIN teléfono (rama de identidad por visitante, sin lock de teléfono): 6 pedidos, sin deadlock', res.count('NUEVA') == 6 and npedidos(w) == 6, str(res))
w = world(db); tel = '1511111111'; op = uuid.uuid4()
res = correr(4, lambda i, c: est(reclamar(w, op, 'H-MISMA', tel=tel, conn=c)))
check('T10f. la MISMA operación enviada 4 veces a la vez (doble clic): una sola NUEVA, el resto EN_CURSO (idempotencia intacta)', res.count('NUEVA') == 1 and res.count('EN_CURSO') == 3, str(res))

print('=== T12 · REVISIÓN DE POSIBLE DUPLICADO (CTO 14/11, D4): relación, resolución, carreras y ciclo completo ===')
def revision(w, op):
    cu = connect(w['db']).cursor(); cu.execute("select estado, coincidencia, candidatos, reembolso_pendiente, stock_devuelto_at, resuelto_por from pedido_revisiones_duplicado where empresa_id=%s and operacion_id=%s", (w['emp'], op)); return cu.fetchone()
def resolver(w, pid, res, oper=None, nota=None, conn=None):
    cu = (conn or connect(w['db'])).cursor(); cu.execute("select resolver_revision_duplicado(%s,%s,%s,%s,%s)", (w['emp'], pid, res, oper, nota)); return cu.fetchone()[0]
def en_revision(w, pids):
    cu = connect(w['db']).cursor(); cu.execute("select pedido_id from pedidos_en_revision(%s, %s::uuid[])", (w['emp'], [str(x) for x in pids])); return {str(r[0]) for r in cu.fetchall()}
def continuar(w, huella, conn=None, **kw):
    """Flujo del cliente de punta a punta: avisa → «Es otro pedido, continuar» → crea el pedido → completa la operación. Devuelve (op, pedido_id)."""
    op = uuid.uuid4(); a = reclamar(w, op, huella, conn=conn, **kw); assert est(a) == 'PEDIDO_ACTIVO', a
    b = reclamar(w, op, huella, otro=True, conn=conn, **kw); assert est(b) == 'NUEVA', b
    pid = venta(w, conn=conn, op=op); completar(w, op, pid, conn=conn); return op, pid
OPERADOR = uuid.uuid4()
def errc(sql, *a):
    try: connect(db).cursor().execute(sql, a or None); return None
    except psycopg2.Error as e: return e.pgcode

w = world(db); opA, pA, = comprar(w, 'H-43', tel=TEL, vis='vis-sandra', disp=DISP)[1:]
opB, pB = continuar(w, 'H-49', tel=TEL, vis='vis-segundo', disp=DISP)
rv = revision(w, opB)
check('T12a. #43/#49: al continuar queda UNA revisión PENDIENTE del pedido nuevo con el candidato anterior (DISTINTA); el pedido original NO tiene revisión',
      rv is not None and rv[0] == 'PENDIENTE' and rv[1] == 'DISTINTA' and [str(x) for x in rv[2]] == [str(opA)] and revision(w, opA) is None and npedidos(w) == 2, str(rv))
check('T12b. la compuerta (pedidos_en_revision) marca SOLO al pedido nuevo', en_revision(w, [pA, pB]) == {str(pB)}, str(en_revision(w, [pA, pB])))
w = world(db); opA, pA = comprar(w, 'H-X', tel=TEL, vis='vis-1')[1:]; opB, pB = continuar(w, 'H-X', tel=TEL, vis='vis-2')
rv = revision(w, opB)
check('T12c. contenido IDÉNTICO: la revisión queda como IDENTICA con el candidato', rv[1] == 'IDENTICA' and [str(x) for x in rv[2]] == [str(opA)])

w = world(db); opA, pA = comprar(w, 'H-1', tel=TEL, vis='vis-A')[1:]; opB, pB = continuar(w, 'H-2', tel=TEL, vis='vis-B'); opC, pC = continuar(w, 'H-3', tel=TEL, vis='vis-B')
rc = revision(w, opC); rb = revision(w, opB)
check('T12d. varios activos: el tercer pedido lista TODOS los candidatos (el del mismo visitante primero); el segundo solo al primero',
      sorted(str(x) for x in rc[2]) == sorted([str(opA), str(opB)]) and str(rc[2][0]) == str(opB) and [str(x) for x in rb[2]] == [str(opA)], f'{rc} {rb}')

w = world(db); comprar(w, 'H-X', tel='1111111111'); r = reclamar(w, uuid.uuid4(), 'H-Y', tel='2222222222')
cu = connect(db).cursor(); cu.execute("select count(*) from pedido_revisiones_duplicado where empresa_id=%s", (w['emp'],))
check('T12e. teléfonos diferentes: no se cruzan y no se crea ninguna revisión', est(r) == 'NUEVA' and cu.fetchone()[0] == 0)
for e in ('CANCELLED', 'DELIVERED'):
    w = world(db); _, _, p = comprar(w, 'H-X', tel=TEL); estado(w, p, e); op = uuid.uuid4(); r = reclamar(w, op, 'H-Y', tel=TEL); r2 = reclamar(w, op, 'H-Y', tel=TEL, otro=True)
    check(f'T12f. pedido {e}: no hay candidato, no hay aviso ni revisión', est(r) == 'NUEVA' and revision(w, op) is None)

# carrera: el candidato todavía no tiene pedido (operación EN_CURSO) cuando el cliente confirma; la relación se guarda por OPERACIÓN
w = world(db); opA = uuid.uuid4(); rA = reclamar(w, opA, 'H-A', tel=TEL, vis='vis-a')                 # A reclamó y todavía no creó el pedido
opB = uuid.uuid4(); a = reclamar(w, opB, 'H-B', tel=TEL, vis='vis-b'); b = reclamar(w, opB, 'H-B', tel=TEL, vis='vis-b', otro=True)
pB = venta(w, op=opB); completar(w, opB, pB)
pA = venta(w, op=opA); completar(w, opA, pA)                                                           # recién ahora nace el pedido de A
rv = revision(w, opB)
check('T12g. CARRERA: B confirma mientras A aún no tiene pedido → la revisión guarda la OPERACIÓN de A y, cuando A termina de crearse, la relación queda completa',
      est(rA) == 'NUEVA' and est(a) == 'PEDIDO_ACTIVO' and est(b) == 'NUEVA' and [str(x) for x in rv[2]] == [str(opA)] and en_revision(w, [pA, pB]) == {str(pB)}, str(rv))
cu = connect(db).cursor(); cu.execute("select p.id from pedidos p join pedido_operaciones o on o.operacion_id = p.operacion_id where o.operacion_id = any(%s::uuid[])", ([str(x) for x in rv[2]],))
check('T12h. el candidato guardado por operación se resuelve al pedido real (pedidos.operacion_id)', [str(r[0]) for r in cu.fetchall()] == [str(pA)])

# resolución
w = world(db); opA, pA = comprar(w, 'H-1', tel=TEL, vis='vis-A')[1:]; opB, pB = continuar(w, 'H-2', tel=TEL, vis='vis-B')
cu = connect(db).cursor(); cu.execute("select estado from pedidos where id in (%s,%s) order by numero_pedido", (pA, pB)); antes = cu.fetchall()
r1 = resolver(w, pB, 'LEGITIMO', OPERADOR, 'es de otro familiar'); r2 = resolver(w, pB, 'LEGITIMO', OPERADOR); r3 = resolver(w, pB, 'DUPLICADO', OPERADOR)
rv = revision(w, opB); cu.execute("select estado from pedidos where id in (%s,%s) order by numero_pedido", (pA, pB)); despues = cu.fetchall()
check('T12i. LEGITIMO: se resuelve UNA vez (quién y cuándo), repetirlo no hace nada, un DUPLICADO posterior no pisa la decisión, y los pedidos no cambian de estado',
      est(r1) == 'RESUELTA' and est(r2) == 'YA_RESUELTA' and est(r3) == 'YA_RESUELTA_DISTINTA' and rv[0] == 'LEGITIMO' and str(rv[5]) == str(OPERADOR) and antes == despues and en_revision(w, [pA, pB]) == set(), f'{r1} {r2} {r3} {rv}')
w = world(db); opA, pA = comprar(w, 'H-1', tel=TEL, vis='vis-A')[1:]; opB, pB = continuar(w, 'H-2', tel=TEL, vis='vis-B')
cu = connect(db).cursor(); cu.execute("update pedidos set metodo_pago='mp', pagado=true, mp_payment_id='9001' where id=%s", (pB,))
rd = resolver(w, pB, 'DUPLICADO', OPERADOR); rv = revision(w, opB)
check('T12j. DUPLICADO de un pedido ya pagado por MP: queda reembolso_pendiente=true (gestión MANUAL); el SQL no toca ni el pedido ni el stock',
      est(rd) == 'RESUELTA' and rd['reembolso_pendiente'] is True and rv[0] == 'DUPLICADO' and rv[3] is True and rv[4] is None, str(rd))
w = world(db); opA, pA = comprar(w, 'H-1', tel=TEL, vis='vis-A')[1:]; opB, pB = continuar(w, 'H-2', tel=TEL, vis='vis-B')
cu = connect(db).cursor(); cu.execute("update pedidos set metodo_pago='mp', pagado=true where id=%s", (pB,))   # MP elegido pero SIN pago confirmado (pagado nace TRUE igual)
rd = resolver(w, pB, 'DUPLICADO', OPERADOR)
check('T12j2. DUPLICADO de un pedido MP que NUNCA se pagó (pagado=true de nacimiento, sin mp_payment_id): NO marca reembolso (no se simula plata que no existe)',
      est(rd) == 'RESUELTA' and rd['reembolso_pendiente'] is False, str(rd))
w = world(db); opA, pA = comprar(w, 'H-1', tel=TEL, vis='vis-A')[1:]; opB, pB = continuar(w, 'H-2', tel=TEL, vis='vis-B')
rd = resolver(w, pB, 'DUPLICADO', OPERADOR); cu = connect(db).cursor(); cu.execute("update pedido_revisiones_duplicado set estado=estado where operacion_id=%s", (opB,))
check('T12k. DUPLICADO en efectivo/transferencia (sin pago MP): reembolso_pendiente=false; el pedido sigue RETENIDO (no se puede cobrar ni preparar) y el original no',
      est(rd) == 'RESUELTA' and rd['reembolso_pendiente'] is False and en_revision(w, [pA, pB]) == {str(pB)})
w = world(db); opA, pA = comprar(w, 'H-1', tel=TEL, vis='vis-A')[1:]; opB, pB = continuar(w, 'H-2', tel=TEL, vis='vis-B')
res2 = correr(2, lambda i, c: est(resolver(w, pB, ['LEGITIMO', 'DUPLICADO'][i], OPERADOR, conn=c)))
check('T12l. dos Lucis resuelven a la vez (uno LEGITIMO, otro DUPLICADO): una sola decisión gana, la otra recibe YA_RESUELTA_DISTINTA', sorted(res2) == ['RESUELTA', 'YA_RESUELTA_DISTINTA'], str(res2))
check('T12m. pedido sin revisión → SIN_REVISION; pedido inexistente → PEDIDO_NO_ENCONTRADO; resolución inválida → error (P0001)',
      est(resolver(w, pA, 'LEGITIMO')) == 'SIN_REVISION' and est(resolver(w, uuid.uuid4(), 'LEGITIMO')) == 'PEDIDO_NO_ENCONTRADO' and errc("select resolver_revision_duplicado(%s,%s,'BORRAR',null,null)", w['emp'], pB) == 'P0001')

# CTO B: ciclo completo (reclamo → aviso → confirmación → creación del pedido → completar) con DOS clientes simultáneos y un pedido activo previo
ok_cic = True; det = []
for k in range(20):
    w = world(db); tel = f'14{k:08d}'; opA, pA = comprar(w, 'H-A', tel=tel, vis='vis-A')[1:]
    def ciclo(i, c, w=w, tel=tel):
        return continuar(w, f'H-{"BC"[i]}', conn=c, tel=tel, vis=f'vis-{"BC"[i]}')
    try: (opB, pB), (opC, pC) = correr(2, ciclo)
    except Exception as e: ok_cic = False; det.append(repr(e)[:120]); continue
    rb, rc = revision(w, opB), revision(w, opC)
    cb, cc = {str(x) for x in rb[2]}, {str(x) for x in rc[2]}
    ok = npedidos(w) == 3 and str(opA) in cb and str(opA) in cc and ((str(opC) in cb) != (str(opB) in cc)) and en_revision(w, [pA, pB, pC]) == {str(pB), str(pC)}
    ok_cic &= ok
    if not ok: det.append((str(opA)[:4], cb, cc))
check('T12n. CICLO COMPLETO concurrente (20 rondas): 2 clientes con el mismo teléfono y un pedido previo → 3 pedidos, las DOS revisiones existen, ambas apuntan al previo y entre ellas una (y solo una) apunta a la otra; sin deadlocks',
      ok_cic, str(det[:2]))
ok_cic3 = True; det = []
for k in range(10):
    w = world(db); tel = f'15{k:08d}'; opA, pA = comprar(w, 'H-A', tel=tel, vis='vis-A')[1:]
    def ciclo3(i, c, w=w, tel=tel): return continuar(w, f'H-{"BCD"[i]}', conn=c, tel=tel, vis=f'vis-{"BCD"[i]}')
    try: rs = correr(3, ciclo3)
    except Exception as e: ok_cic3 = False; det.append(repr(e)[:120]); continue
    revs = [revision(w, op) for op, _ in rs]
    ok = npedidos(w) == 4 and all(r is not None and str(opA) in {str(x) for x in r[2]} for r in revs) and en_revision(w, [pA] + [p for _, p in rs]) == {str(p) for _, p in rs}
    ok_cic3 &= ok
    if not ok: det.append(revs)
check('T12o. CICLO COMPLETO con TRES clientes simultáneos: 4 pedidos, 3 revisiones, todas conservan la relación con el pedido previo', ok_cic3, str(det[:1]))
w = world(db); opA, pA = comprar(w, 'H-1', tel=TEL, vis='vis-A')[1:]; op = uuid.uuid4()
reclamar(w, op, 'H-2', tel=TEL, vis='vis-B'); x1 = reclamar(w, op, 'H-2', tel=TEL, vis='vis-B', otro=True); x2 = reclamar(w, op, 'H-2', tel=TEL, vis='vis-B', otro=True)
cu = connect(db).cursor(); cu.execute("select count(*) from pedido_revisiones_duplicado where empresa_id=%s", (w['emp'],))
check('T12p. reintento de la confirmación (respuesta perdida): sigue habiendo UNA sola revisión y la operación no se duplica (EN_CURSO)', est(x1) == 'NUEVA' and est(x2) == 'EN_CURSO' and cu.fetchone()[0] == 1, f'{est(x1)} {est(x2)}')

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
cu = connect(db).cursor()
cu.execute("select has_table_privilege('anon','public.pedido_revisiones_duplicado','select'), has_table_privilege('authenticated','public.pedido_revisiones_duplicado','select'), has_table_privilege('service_role','public.pedido_revisiones_duplicado','select'), has_table_privilege('service_role','public.pedido_revisiones_duplicado','insert')")
tp = cu.fetchone()
cu.execute("select relrowsecurity from pg_class where oid='public.pedido_revisiones_duplicado'::regclass"); rls = cu.fetchone()[0]
cu.execute("select has_function_privilege('anon','public.resolver_revision_duplicado(uuid,uuid,text,uuid,text)','execute'), has_function_privilege('authenticated','public.resolver_revision_duplicado(uuid,uuid,text,uuid,text)','execute'), has_function_privilege('service_role','public.resolver_revision_duplicado(uuid,uuid,text,uuid,text)','execute'), has_function_privilege('anon','public.pedidos_en_revision(uuid,uuid[])','execute'), has_function_privilege('authenticated','public.pedidos_en_revision(uuid,uuid[])','execute'), has_function_privilege('service_role','public.pedidos_en_revision(uuid,uuid[])','execute')")
fp = cu.fetchone()
check('S1b. la tabla de revisiones y sus funciones: SOLO service_role (anon y authenticated no leen ni resuelven) y la tabla tiene RLS activada', tp == (False, False, True, True) and rls is True and fp == (False, False, True, False, False, True), f'{tp} {rls} {fp}')
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
c.execute("select to_regclass('public.pedido_revisiones_duplicado') is null, (select count(*) from pg_proc where proname in ('resolver_revision_duplicado','pedidos_en_revision'))"); rv_gone = c.fetchone()
check('R5. la reversión borra la tabla de revisiones y sus dos funciones (y SOLO eso: pedidos y operaciones siguen)', err is None and rv_gone == (True, 0) and npd == 1 and nop == 1, str(rv_gone))
err2, _ = aplicar(c, NUEVO); c.execute("select count(*), max(pronargs) from pg_proc where proname='reclamar_operacion_pedido'")
check('R3. después de revertir se puede re-aplicar el bloqueo', err2 is None and c.fetchone() == (1, 10))
err3, _ = aplicar(c, REVERSION); err4, _ = aplicar(c, REVERSION)
check('R4. la reversión se puede correr dos veces seguidas sin error', err3 is None and err4 is None)

print(f'\n{sum(R)}/{len(R)} PASS')
raise SystemExit(0 if all(R) else 1)
