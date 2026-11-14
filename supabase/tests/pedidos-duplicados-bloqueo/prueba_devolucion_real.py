#!/usr/bin/env python3
"""Validación de las funciones REALES de devolución usadas al marcar DUPLICADO (CTO 14/11, ajuste 2). Postgres LOCAL aislado, SIN dobles:
  devolver_stock_pedido (devolver-stock-pedido.sql), crear_pedido_stock (v1.7), descontar_sabores_pedido / devolver_sabores_pedido (stock-sabores-kg.sql).
NO cubre devolver_stock_pedido_caja (rama producción): su SQL no está en el repo -> PENDIENTE de que el CTO/JC lo aporten.
Uso: python3 prueba_devolucion_real.py"""
import os, json, threading, uuid
import psycopg2, psycopg2.extras
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.abspath(os.path.join(HERE, '..', '..'))
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db): c = psycopg2.connect(dbname=db, **CONN); c.autocommit = True; return c
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
BASE = ('stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql', 'stock-sabores-kg.sql')
DB = 'dev_real'
a = connect('postgres'); a.cursor().execute(f'drop database if exists {DB} with (force)'); a.cursor().execute(f'create database {DB}'); a.close()
c = connect(DB).cursor()
c.execute(open(os.path.join(SUP, 'tests', 'stock-v2', '00-schema-reducido.sql'), encoding='utf-8').read())
c.execute("alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role")
c.execute("alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role")
c.execute("create table empresa_config (empresa_id uuid primary key, primary_color text); alter table pedidos add column if not exists created_at timestamptz not null default now()")
for f in BASE: c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
def one(sql, *a): c.execute(sql, a); return c.fetchone()[0]
emp = one("insert into empresas default values returning id"); suc = one("insert into sucursales(empresa_id) values(%s) returning id", emp)
c.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s)", (suc, emp))
prod = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Helado',true) returning id", emp)
pres = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock,kg_por_unidad) values(%s,%s,'1 Kg',1000,1,1.000) returning id", emp, prod)
c.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,100)", (emp, prod, suc))
grp = one("insert into grupos_opciones(empresa_id,nombre) values(%s,'Sabores') returning id", emp); c.execute("insert into presentacion_grupos values(%s,%s)", (pres, grp))
opA = one("insert into opciones(empresa_id,grupo_id,nombre) values(%s,%s,'Dulce de leche') returning id", emp, grp); opB = one("insert into opciones(empresa_id,grupo_id,nombre) values(%s,%s,'Chocolate') returning id", emp, grp)
for o in (opA, opB): c.execute("insert into stock_sabor(empresa_id,sucursal_id,opcion_id,kg) values(%s,%s,%s,10)", (emp, suc, o))
def pedido(con_sabores=True):
    it = [{'presentacion_id': str(pres), 'cantidad': 1, 'precio_snap': 1000, 'nombre_producto_snap': 'Helado', 'nombre_presentacion_snap': '1 Kg', 'opciones': []}]
    c.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'delivery', p_tipo_pedido := 'delivery', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := false, p_operacion_id := %s::uuid)", (emp, suc, json.dumps(it), str(uuid.uuid4())))
    r = c.fetchone()[0]; pid = r['id'] if 'id' in r else r['pedido_id']
    if con_sabores:
        iid = one("select id from pedido_items where pedido_id=%s", pid)
        for o in (opA, opB): c.execute("insert into pedido_item_opciones(pedido_item_id, opcion_id, nombre_snap) values(%s,%s,'s')", (iid, o))
        c.execute("select descontar_sabores_pedido(%s,%s)", (emp, pid))
    return pid
stock = lambda: float(one("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", prod, suc))
sabor = lambda o: float(one("select kg from stock_sabor where opcion_id=%s and sucursal_id=%s", o, suc))
dev_stock = lambda pid: (c.execute("select devolver_stock_pedido(%s,%s)", (emp, pid)), c.fetchone()[0])[1]
dev_sab = lambda pid, cu=None: ((cu or c).execute("select devolver_sabores_pedido(%s,%s)", (emp, pid)), (cu or c).fetchone()[0])[1]

print('=== STOCK real: devolver_stock_pedido ===')
original = pedido(False); target = pedido(False); s0 = stock()
c.execute("select md5(row(estado,total,numero_pedido,metodo_pago,codigo_retiro)::text) from pedidos where id=%s", (original,)); h_orig = c.fetchone()[0]
r1 = dev_stock(target); s1 = stock(); r2 = dev_stock(target); s2 = stock()
check('S1. devolver_stock_pedido devuelve el stock del pedido duplicado UNA vez y es idempotente (2ª llamada sin efecto)', s1 == s0 + 1 and s2 == s1 and r1.get('devuelto') is True and r2.get('devuelto') is False, f'{s0}->{s1}->{s2} {r1} {r2}')
c.execute("select md5(row(estado,total,numero_pedido,metodo_pago,codigo_retiro)::text), stock_descontado from pedidos where id=%s", (original,)); ho = c.fetchone()
check('S2. el pedido ORIGINAL no se toca (mismos datos y su stock sigue descontado)', ho[0] == h_orig and ho[1] is True)
c.execute("select detalle from stock_movimientos where pedido_id=%s and tipo ilike %s", (target, '%dev%')) if False else None
c.execute("select * from stock_movimientos where pedido_id=%s order by 1", (target,)); cols = [d[0] for d in c.description]; movs = [dict(zip(cols, r)) for r in c.fetchall()]
det = [m.get('detalle') for m in movs if (m.get('delta') or m.get('cantidad') or 0) is not None and 'evoluci' in str(m.get('detalle'))]
check('S3. HALLAZGO: el detalle del libro dice «eliminación» aunque la causa sea un duplicado (la función real NO se modifica sin autorización)', len(det) == 1 and 'eliminación' in det[0], str(det))

print('=== SABORES real: descontar/devolver_sabores_pedido ===')
p = pedido(True); sa, sb = sabor(opA), sabor(opB)
check('F1. el descuento real de sabores reparte 1 kg en 0,5 + 0,5', abs(sa - 9.5) < 1e-9 and abs(sb - 9.5) < 1e-9, f'{sa} {sb}')
d1 = dev_sab(p); d2 = dev_sab(p)
check('F2. devolver_sabores_pedido: 1ª llamada «devuelto», 2ª «ya_devuelto»; los kilos vuelven exactamente una vez', d1['estado'] == 'devuelto' and d2['estado'] == 'ya_devuelto' and sabor(opA) == 10 and sabor(opB) == 10, f'{d1} {d2}')
sin = pedido(False)
check('F3. pedido SIN sabores descontados → «sin_efecto» (no toca nada)', dev_sab(sin)['estado'] == 'sin_efecto' and sabor(opA) == 10)
q = pedido(True); res = []
def hilo():
    cu = connect(DB).cursor(); res.append(dev_sab(q, cu)['estado'])
ts = [threading.Thread(target=hilo) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
check('F4. 8 devoluciones CONCURRENTES: una sola «devuelto», el resto «ya_devuelto»; los kilos vuelven una vez', sorted(res) == ['devuelto'] + ['ya_devuelto'] * 7 and sabor(opA) == 10 and sabor(opB) == 10, str(sorted(res)))
other = pedido(True); sa_o = sabor(opA); dev_sab(q)
check('F5. devolver un pedido NO toca los movimientos/kilos de otro pedido (el original sigue descontado)', abs(sa_o - 9.5) < 1e-9 and abs(sabor(opA) - 9.5) < 1e-9)
c.execute("select detalle from stock_sabor_movimientos where pedido_id=%s and motivo='devolucion' limit 1", (p,)); dd = c.fetchone()[0]
check('F6. HALLAZGO: el detalle de sabores también dice «eliminación del pedido» aunque la causa sea un duplicado', 'eliminación' in dd, dd)


print('=== OBSERVACIÓN DEL CTO: UPDATE de stock_sabor sin verificar filas ===')
m = pedido(True)
c.execute("delete from stock_sabor where opcion_id=%s and sucursal_id=%s", (opA, suc))      # inconsistencia: el sabor ya no tiene fila de stock
r = dev_sab(m)
c.execute("select count(*) from stock_sabor_movimientos where pedido_id=%s and motivo='devolucion' and opcion_id=%s", (m, opA)); mov_sin_fila = c.fetchone()[0]
c.execute("select count(*) from stock_sabor where opcion_id=%s and sucursal_id=%s", (opA, suc)); hay_fila = c.fetchone()[0]
check('F7. HALLAZGO CONFIRMADO: sin fila en stock_sabor, la función real informa «devuelto» y registra el movimiento de devolución pero NO aumenta ningún stock (el libro queda sin respaldo)', r['estado'] == 'devuelto' and mov_sin_fila == 1 and hay_fila == 0, f'{r} mov={mov_sin_fila} fila={hay_fila}')
c.execute("select tc.constraint_type, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu using (constraint_name, table_schema) where tc.table_name='stock_sabor' and tc.constraint_type in ('UNIQUE','PRIMARY KEY') order by 1,2"); rs = c.fetchall()
c.execute("select indexdef from pg_indexes where indexname='ux_ssm_pedido_opcion_motivo'"); ix = c.fetchone()
check('F8. restricciones: stock_sabor es único por (sucursal_id, opcion_id) y existe el índice único (pedido, opción, motivo) del libro', ('UNIQUE', 'opcion_id') in rs and ('UNIQUE', 'sucursal_id') in rs and ix is not None and 'UNIQUE' in ix[0], str(rs) + ' ' + str(ix))
c.execute("insert into stock_sabor(empresa_id,sucursal_id,opcion_id,kg) values(%s,%s,%s,10)", (emp, suc, opA))

print('=== FALLA PARCIAL con funciones reales: stock devuelto, sabores falla, reintento ===')
z = pedido(True); sz0, ssa = stock(), sabor(opA)
dev_stock(z); sz1 = stock()
c.execute("alter table stock_sabor rename to stock_sabor_x")
try: dev_sab(z); fallo = False
except psycopg2.Error: fallo = True
c.execute("alter table stock_sabor_x rename to stock_sabor")
c.execute("select count(*) from stock_sabor_movimientos where pedido_id=%s and motivo='devolucion'", (z,)); n_dev_fallo = c.fetchone()[0]
check('P1. si la devolución de sabores FALLA no deja nada a medias (rollback: 0 movimientos de devolución, kilos intactos)', fallo and n_dev_fallo == 0 and sabor(opA) == ssa, f'fallo={fallo} movs={n_dev_fallo}')
r3 = dev_stock(z); r4 = dev_sab(z)
check('P2. el REINTENTO completa sin duplicar: stock no se devuelve de nuevo (idempotente) y los sabores vuelven una vez', r3.get('devuelto') is False and stock() == sz1 and r4['estado'] == 'devuelto' and abs(sabor(opA) - (ssa + 0.5)) < 1e-9, f'{r3} {r4} stock={stock()}')

print('=== PRIVILEGIOS ===')
c.execute("select has_function_privilege('anon','devolver_sabores_pedido(uuid,uuid)','execute'), has_function_privilege('authenticated','devolver_stock_pedido(uuid,uuid)','execute'), has_function_privilege('service_role','devolver_sabores_pedido(uuid,uuid)','execute')")
check('G1. las funciones de devolución son SOLO de service_role', c.fetchone() == (False, False, True))

print('=== PROPUESTA F7 (NO autorizada; se prueba sobre la base de prueba, el repo no cambia) ===')
c.execute(open(os.path.join(SUP, 'propuestas', 'PROPUESTA-F7-devolver-sabores-pedido.sql'), encoding='utf-8').read())
c.execute("delete from stock_sabor where opcion_id=%s and sucursal_id=%s", (opA, suc)); m2 = pedido(True) if False else None
c.execute("insert into stock_sabor(empresa_id,sucursal_id,opcion_id,kg) values(%s,%s,%s,10)", (emp, suc, opA))
m3 = pedido(True); sa3, sb3 = sabor(opA), sabor(opB)
c.execute("delete from stock_sabor where opcion_id=%s and sucursal_id=%s", (opA, suc))
try: dev_sab(m3); err = None
except psycopg2.Error as e: err = e.pgerror
c.execute("select count(*) from stock_sabor_movimientos where pedido_id=%s and motivo='devolucion'", (m3,)); n_mov = c.fetchone()[0]
check('F7-fix-1. con la corrección, sin fila de stock → SABOR_SIN_STOCK, 0 movimientos de devolución y NINGÚN sabor se tocó (rollback total, incluso el que sí tenía fila)', err is not None and 'SABOR_SIN_STOCK' in err and n_mov == 0 and abs(sabor(opB) - sb3) < 1e-9, str(err)[:80])
c.execute("insert into stock_sabor(empresa_id,sucursal_id,opcion_id,kg) values(%s,%s,%s,%s)", (emp, suc, opA, sa3))
r5 = dev_sab(m3); r6 = dev_sab(m3)
check('F7-fix-2. corregida la causa, el reintento devuelve UNA vez (y luego «ya_devuelto»)', r5['estado'] == 'devuelto' and r6['estado'] == 'ya_devuelto' and abs(sabor(opA) - (sa3 + 0.5)) < 1e-9, f'{r5} {r6}')
c.execute("select has_function_privilege('anon','devolver_sabores_pedido(uuid,uuid)','execute'), has_function_privilege('service_role','devolver_sabores_pedido(uuid,uuid)','execute')")
check('F7-fix-3. mismos permisos: solo service_role', c.fetchone() == (False, True))

print(f'\n{sum(R)}/{len(R)} PASS'); raise SystemExit(0 if all(R) else 1)
