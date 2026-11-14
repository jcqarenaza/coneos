#!/usr/bin/env python3
"""Devolución por RAMA (CTO 14/11): devolver_stock_pedido_caja REAL (definición leída de producción, solo lectura) + _devolver_pedido_core + helpers,
contra Postgres LOCAL aislado. Fixture: produccion-rama-14-11.sql. Cubre: rama correcta, aislamiento, idempotencia, concurrencia, falla parcial, dispositivo/empresa/sucursal.
Uso: python3 prueba_rama_real.py"""
import os, json, threading, uuid
import psycopg2, psycopg2.extras
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.abspath(os.path.join(HERE, '..', '..'))
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db): c = psycopg2.connect(dbname=db, **CONN); c.autocommit = True; return c
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
BASE = ('stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql', 'stock-sabores-kg.sql')
DB = 'dev_rama'
a = connect('postgres'); a.cursor().execute(f'drop database if exists {DB} with (force)'); a.cursor().execute(f'create database {DB}'); a.close()
c = connect(DB).cursor()
c.execute(open(os.path.join(SUP, 'tests', 'stock-v2', '00-schema-reducido.sql'), encoding='utf-8').read())
c.execute("alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role")
c.execute("alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role")
c.execute("create table empresa_config (empresa_id uuid primary key, primary_color text); alter table pedidos add column if not exists created_at timestamptz not null default now(); create table dispositivos (id uuid primary key default gen_random_uuid(), empresa_id uuid, sucursal_id uuid, tipo text, activo boolean default true, nombre text)")
for f in BASE: c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
c.execute(open(os.path.join(HERE, 'produccion-rama-14-11.sql'), encoding='utf-8').read())
def one(sql, *a): c.execute(sql, a); return c.fetchone()[0]
emp = one("insert into empresas default values returning id"); emp2 = one("insert into empresas default values returning id")
sA = one("insert into sucursales(empresa_id) values(%s) returning id", emp); sB = one("insert into sucursales(empresa_id) values(%s) returning id", emp)
for s in (sA, sB): c.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s)", (s, emp))
cajaA = one("insert into dispositivos(empresa_id,sucursal_id,tipo,nombre) values(%s,%s,'CAJA','Caja A') returning id", emp, sA)
cajaB = one("insert into dispositivos(empresa_id,sucursal_id,tipo,nombre) values(%s,%s,'CAJA','Caja B') returning id", emp, sB)
kiosco = one("insert into dispositivos(empresa_id,sucursal_id,tipo,nombre) values(%s,%s,'KIOSK','Kiosco') returning id", emp, sA)
cajaOff = one("insert into dispositivos(empresa_id,sucursal_id,tipo,nombre,activo) values(%s,%s,'CAJA','Caja off',false) returning id", emp, sA)
cajaOtra = one("insert into dispositivos(empresa_id,sucursal_id,tipo,nombre) values(%s,%s,'CAJA','Caja otra empresa') returning id", emp2, one("insert into sucursales(empresa_id) values(%s) returning id", emp2))
pR = one("insert into productos(empresa_id,nombre,controla_stock,modelo_stock) values(%s,'Rama',false,'rama') returning id", emp)           # producto por rama (hojas)
pP = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Plano',true) returning id", emp)                               # modelo producto
pres1 = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Chica',1000,1) returning id", emp, pR)
pres2 = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Grande',1500,1) returning id", emp, pR)
presP = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Unidad',500,1) returning id", emp, pP)
for s in (sA, sB): c.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,100)", (emp, pP, s))
def rama(s, pres, q=20): return one("insert into stock_rama(empresa_id,sucursal_id,presentacion_id,producto_id,cantidad) values(%s,%s,%s,%s,%s) returning id", emp, s, pres, pR, q)
rA1, rA2, rB1 = rama(sA, pres1), rama(sA, pres2), rama(sB, pres1)
cant = lambda r: float(one("select cantidad from stock_rama where id=%s", r))
stockP = lambda s: float(one("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", pP, s))
def crear(suc, items):
    c.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'delivery', p_tipo_pedido := 'delivery', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := false, p_operacion_id := %s::uuid)", (emp, suc, json.dumps(items), str(uuid.uuid4())))
    r = c.fetchone()[0]; return r['id'] if 'id' in r else r['pedido_id']
def it(pres, q, nombre='x'): return {'presentacion_id': str(pres), 'cantidad': q, 'precio_snap': {pres1: 1000, pres2: 1500, presP: 500}[pres], 'nombre_producto_snap': nombre, 'nombre_presentacion_snap': 'u', 'opciones': []}
def pedido_rama(suc, lineas, plano=0):
    """lineas = [(rama_id, presentacion_id, cantidad)]. Arma el pedido y su libro de venta por rama como lo hace la venta real (flag true, operación de venta, movimientos con rama/item/regla)."""
    items = [it(p, q) for (_, p, q) in lineas] + ([it(presP, plano)] if plano else [])
    pid = crear(suc, items); op = uuid.uuid4()
    c.execute("insert into stock_operaciones(operacion_id,empresa_id,tipo,huella,estado,resultado,completed_at) values(%s,%s,'venta',repeat('a',64),'completada','{}'::jsonb,now())", (op, emp))
    c.execute("select id, presentacion_id from pedido_items where pedido_id=%s", (pid,)); itemde = {r[1]: r[0] for r in c.fetchall()}
    for (r, p, q) in lineas:
        c.execute("update stock_rama set cantidad = cantidad - %s where id=%s", (q, r))
        c.execute("insert into stock_movimientos(empresa_id,sucursal_id,producto_id,delta,motivo,pedido_id,rama_id,pedido_item_id,consumo_regla,operacion_id) values(%s,%s,%s,%s,'venta',%s,%s,%s,'directo',%s)", (emp, suc, pR, -q, pid, r, itemde[p], op))
    c.execute("update pedidos set stock_descontado=true where id=%s", (pid,))
    return pid
def caja(pid, disp=None, e=None, conn=None, op=None):
    cu = conn or c
    cu.execute("select devolver_stock_pedido_caja(%s,%s,%s,%s)", (e or emp, pid, disp or cajaA, op)); return cu.fetchone()[0]
def falla(fn):
    try: fn(); return None
    except psycopg2.Error as ex: return ex.pgerror or str(ex)
def fila(pid): c.execute("select estado,total,numero_pedido,sucursal_id,stock_descontado from pedidos where id=%s", (pid,)); return c.fetchone()

print('=== DEVOLUCIÓN POR RAMA con la función REAL de producción ===')
original = pedido_rama(sA, [(rA1, pres1, 3)])                    # pedido anterior: NO debe tocarse
dup = pedido_rama(sA, [(rA1, pres1, 2), (rA2, pres2, 4)])        # el duplicado
other_suc = pedido_rama(sB, [(rB1, pres1, 5)])                   # otra sucursal: NO debe tocarse
a1, a2, b1 = cant(rA1), cant(rA2), cant(rB1); f_orig = fila(original); f_otro = fila(other_suc)
r1 = caja(dup)
check('B1. devuelve a la MISMA rama de cada línea del libro original (A1 +2, A2 +4); estado «devuelto», 2 grupos', r1['estado'] == 'devuelto' and r1['grupos'] == 2 and cant(rA1) == a1 + 2 and cant(rA2) == a2 + 4, str(r1))
check('B2. NO toca otra rama de la misma sucursal ni otra sucursal (rama B1 intacta)', cant(rB1) == b1)
check('B3. el pedido ORIGINAL y el de otra sucursal quedan idénticos (flag en true, mismos datos)', fila(original) == f_orig and fila(other_suc) == f_otro and f_orig[4] is True)
c.execute("select count(*), bool_and(rama_id is not null), bool_and(operacion_id is not null), min(detalle) from stock_movimientos where pedido_id=%s and motivo='devolucion'", (dup,)); mv = c.fetchone()
check('B4. libro: 2 movimientos de devolución con rama y operación; el duplicado queda con stock_descontado=false', mv[0] == 2 and mv[1] and mv[2] and fila(dup)[4] is False, str(mv))
check('B5. AUDITORÍA: el detalle del libro dice «Devolucion por eliminacion de pedido · caja Caja A» (no menciona duplicado)', mv[3].startswith('Devolucion por eliminacion de pedido') and 'caja Caja A' in mv[3], mv[3])

print('=== IDEMPOTENCIA y CONCURRENCIA ===')
a1, a2 = cant(rA1), cant(rA2)
r2 = caja(dup); r3 = caja(dup, op=uuid.uuid4())
check('B6. 2ª llamada (misma operación determinística) devuelve el resultado registrado y NO acredita de nuevo', r2.get('repetida') is True and cant(rA1) == a1 and cant(rA2) == a2, str(r2))
check('B7. otra operación sobre el mismo pedido ya devuelto → «sin_efecto/ya_devuelto», sin acreditar', r3['estado'] == 'sin_efecto' and r3.get('motivo') == 'ya_devuelto' and cant(rA1) == a1, str(r3))
dup2 = pedido_rama(sA, [(rA1, pres1, 1), (rA2, pres2, 1)]); a1, a2 = cant(rA1), cant(rA2); res = []; errs = []
def hilo():
    try: res.append(caja(dup2, conn=connect(DB).cursor())['estado'])
    except psycopg2.Error as ex: errs.append((ex.pgerror or str(ex))[:60])
ts = [threading.Thread(target=hilo) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
check('B8. 8 devoluciones CONCURRENTES del mismo pedido: cada rama sube UNA vez (+1 y +1) y nadie falla', cant(rA1) == a1 + 1 and cant(rA2) == a2 + 1 and not errs and set(res) == {'devuelto'}, f'{res} {errs}')
c.execute("select count(*) from stock_movimientos where pedido_id=%s and motivo='devolucion'", (dup2,)); check('B9. un solo juego de movimientos de devolución tras la concurrencia (índice único por línea/rama)', c.fetchone()[0] == 2)

print('=== AUTORIZACIÓN del dispositivo, empresa y sucursal ===')
p = pedido_rama(sA, [(rA1, pres1, 1)]); a1 = cant(rA1)
e_kiosco = falla(lambda: caja(p, kiosco)); e_off = falla(lambda: caja(p, cajaOff)); e_otra = falla(lambda: caja(p, cajaOtra)); e_suc = falla(lambda: caja(p, cajaB)); e_inex = falla(lambda: caja(p, uuid.uuid4()))
check('B10. dispositivo no CAJA / inactivo / de otra empresa / inexistente → DISPOSITIVO_NO_AUTORIZADO', all(x and 'DISPOSITIVO_NO_AUTORIZADO' in x for x in (e_kiosco, e_off, e_otra, e_inex)))
check('B11. CAJA de OTRA sucursal → PEDIDO_OTRA_SUCURSAL; el stock no se movió', e_suc and 'PEDIDO_OTRA_SUCURSAL' in e_suc and cant(rA1) == a1 and fila(p)[4] is True, str(e_suc)[:70])
e_emp = falla(lambda: caja(p, cajaOtra, e=emp2)); c.execute("select count(*) from stock_operaciones where tipo='devolucion_pedido' and empresa_id=%s", (emp2,)); n_op_ajena = c.fetchone()[0]
check('B12. empresa ajena (caja y empresa de otra empresa, pedido de la primera) → PEDIDO_NO_ENCONTRADO, nada se mueve ni queda operación colgada', e_emp and 'PEDIDO_NO_ENCONTRADO' in e_emp and cant(rA1) == a1 and n_op_ajena == 0, str(e_emp)[:70])

print('=== FALLA PARCIAL ===')
c.execute("create table falla_rama(on_ boolean); create function trg_falla_rama() returns trigger language plpgsql as $f$ begin if exists (select 1 from falla_rama where on_) and new.motivo='devolucion' and new.rama_id = '%s' then raise exception 'falla simulada en la 2da rama'; end if; return new; end $f$;" % rA2)
c.execute("create trigger t_falla_rama before insert on stock_movimientos for each row execute function trg_falla_rama()")
pf = pedido_rama(sA, [(rA1, pres1, 2), (rA2, pres2, 3)]); a1, a2 = cant(rA1), cant(rA2)
c.execute("insert into falla_rama values(true)"); ef = falla(lambda: caja(pf))
c.execute("select count(*) from stock_operaciones where operacion_id=md5(%s)::uuid", ('devolucion_caja:%s:%s' % (emp, pf),)); op_col = c.fetchone()[0]
c.execute("select count(*) from stock_movimientos where pedido_id=%s and motivo='devolucion'", (pf,)); nmov = c.fetchone()[0]
check('B13. si falla a mitad: ROLLBACK total (ninguna rama acreditada, 0 movimientos, flag en true) y la operación NO queda colgada «en_curso»', ef and cant(rA1) == a1 and cant(rA2) == a2 and nmov == 0 and op_col == 0 and fila(pf)[4] is True, str(ef)[:60])
c.execute("delete from falla_rama"); rr = caja(pf)
check('B14. quitada la causa, el REINTENTO completa y acredita cada rama UNA vez', rr['estado'] == 'devuelto' and cant(rA1) == a1 + 2 and cant(rA2) == a2 + 3, str(rr))

print('=== MIXTO e INCIDENCIA ===')
pm = pedido_rama(sA, [(rA1, pres1, 1)], plano=2)      # la línea plana la descuenta crear_pedido_stock real (libro + flag)
sp0, a1 = stockP(sA), cant(rA1); rm = caja(pm)
check('B15. pedido MIXTO (una línea por rama + una de stock plano): devuelve ambas en su lugar (rama +1, producto +2)', rm['estado'] == 'devuelto' and cant(rA1) == a1 + 1 and stockP(sA) == sp0 + 2, str(rm))
pi_ = pedido_rama(sA, [(rA1, pres1, 2), (rA2, pres2, 2)])
c.execute("select pedido_item_id, operacion_id from stock_movimientos where pedido_id=%s and rama_id=%s", (pi_, rA1)); iti, opv = c.fetchone()
c.execute("update stock_rama set cantidad = cantidad + 2 where id=%s", (rA1,))       # devolución parcial previa: SOLO la línea de A1 ya volvió
c.execute("insert into stock_movimientos(empresa_id,sucursal_id,producto_id,delta,motivo,pedido_id,rama_id,pedido_item_id,consumo_regla,operacion_id) values(%s,%s,%s,2,'devolucion',%s,%s,%s,'directo',%s)", (emp, sA, pR, pi_, rA1, iti, opv))
a1, a2 = cant(rA1), cant(rA2)
ri = caja(pi_); ri2 = caja(pi_)
c.execute("select count(*) from stock_incidencias where pedido_id=%s and estado='abierta'", (pi_,)); ninc = c.fetchone()[0]
check('B16. devolución PARCIAL previa en el libro → «incidencia DEVOLUCION_PARCIAL»: NO mueve stock y deja UNA incidencia abierta (fail-closed)', ri['estado'] == 'incidencia' and ri['tipo'] == 'DEVOLUCION_PARCIAL' and cant(rA2) == a2 and cant(rA1) == a1 and ninc == 1 and fila(pi_)[4] is True, str(ri))
check('B17. HALLAZGO: la incidencia queda REGISTRADA como resultado de la operación determinística: el reintento devuelve la misma incidencia (no reevalúa) hasta resolverla a mano o usar otra operación', ri2['estado'] == 'incidencia' and ri2.get('repetida') is True, str(ri2))
c.execute("select has_function_privilege('anon','devolver_stock_pedido_caja(uuid,uuid,uuid,uuid)','execute'), has_function_privilege('authenticated','devolver_stock_pedido_caja(uuid,uuid,uuid,uuid)','execute'), has_function_privilege('service_role','devolver_stock_pedido_caja(uuid,uuid,uuid,uuid)','execute')")
check('B18. permisos del fixture: solo service_role (los reales de producción NO se verificaron: pendiente consulta de privilegios)', c.fetchone() == (False, False, True))
print(f'\n{sum(R)}/{len(R)} PASS'); raise SystemExit(0 if all(R) else 1)
