#!/usr/bin/env python3
"""Corrección CTO 14/11: un pedido resuelto como DUPLICADO ya no es candidato activo. Postgres LOCAL aislado (mismo arnés que prueba_sql.py).
Uso: python3 prueba_excluir_resueltos.py   — Pruebas A–E del CTO + control antes/después + reversión. Nunca contra Supabase."""
import os, json, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, 'prueba_sql.py'), encoding='utf-8').read().split("db = build('blq_main')")[0]   # solo los helpers (fresh/build/world/reclamar/comprar...)
exec(compile(_src, 'prueba_sql_helpers', 'exec'))
FIX = 'pedidos-duplicados-excluir-resueltos.sql'; FIX_REV = 'pedidos-duplicados-excluir-resueltos-REVERSION.sql'
TEL = '2302555001'

def rq(db, sql, *a):
    c = connect(db).cursor(); c.execute(sql, a); return c.fetchall() if c.description else None
def dos_pedidos(w, vis='vis-J'):
    """#1 y #2 del mismo teléfono y visitante; #2 entra por «Es otro pedido, continuar» (revisión PENDIENTE). Devuelve (op1,p1,op2,p2)."""
    _, op1, p1 = comprar(w, 'H-1', tel=TEL, vis=vis)
    op2 = uuid.uuid4(); adv = reclamar(w, op2, 'H-1', tel=TEL, vis=vis)
    ok = reclamar(w, op2, 'H-1', tel=TEL, vis=vis, otro=True); p2 = venta(w, op=op2); completar(w, op2, p2)
    assert adv['estado'] == 'PEDIDO_ACTIVO' and ok.get('confirmada_otro') is True, (adv, ok)
    return op1, p1, op2, p2
def resolver(w, p, res): return rq(w['db'], "select resolver_revision_duplicado(%s,%s,%s)", w['emp'], p, res)[0][0]
def stock(w): return rq(w['db'], "select cantidad from producto_stock where empresa_id=%s and sucursal_id=%s", w['emp'], w['suc'])[0][0]

def escenario(db, resolucion, cancelar_1=True):
    """#1 [cancelado o activo] + #2 [resolucion|None=sin revisión]. Devuelve (mundo, datos, decisión del intento #3, revisión del #3 si la hubo)."""
    w = world(db); op1, p1, op2, p2 = dos_pedidos(w)
    if resolucion == 'SIN_REVISION': rq(db, "delete from pedido_revisiones_duplicado where empresa_id=%s and operacion_id=%s", w['emp'], op2)
    elif resolucion in ('LEGITIMO', 'DUPLICADO'): resolver(w, p2, resolucion)
    if cancelar_1: estado(w, p1, 'CANCELLED')
    return w, (op1, p1, op2, p2)

print('=== CONTROL · reproducción del defecto con la función SIN corrección ===')
db = build('exc_ctrl')
w, (op1, p1, op2, p2) = escenario(db, 'DUPLICADO')
r = reclamar(w, uuid.uuid4(), 'H-9', tel=TEL, vis='vis-J')
check('CTRL. sin la corrección: el #2 resuelto como DUPLICADO vuelve a ser candidato (PEDIDO_ACTIVO → «Ver mi pedido #2»)',
      est(r) == 'PEDIDO_ACTIVO' and r['existente'].get('pedido_id') == str(p2), str(r))

print('=== Aplicar la corrección ===')
c = connect(db).cursor(); err, _ = aplicar(c, FIX)
c.execute("select count(*), max(pronargs) from pg_proc where proname='reclamar_operacion_pedido'"); n = c.fetchone()
check('F0. se aplica sin error y queda UNA función de 10 parámetros', err is None and n == (1, 10), f'{err} {n}')

print('=== A · revisión DUPLICADO ===')
w, (op1, p1, op2, p2) = escenario(db, 'DUPLICADO')
r = reclamar(w, uuid.uuid4(), 'H-9', tel=TEL, vis='vis-J')
check('A1. con el #1 cancelado y el #2 DUPLICADO: el pedido nuevo NO recibe aviso (NUEVA); el #2 no es candidato', est(r) == 'NUEVA', str(r))
w, (op1, p1, op2, p2) = escenario(db, 'DUPLICADO', cancelar_1=False)
op3 = uuid.uuid4(); adv = reclamar(w, op3, 'H-1', tel=TEL, vis='vis-J')
check('A2. con el #1 activo y el #2 DUPLICADO: «Ver mi pedido» apunta al #1 (no al #2)',
      est(adv) == 'PEDIDO_ACTIVO' and adv['existente'].get('pedido_id') == str(p1) and adv['existente'].get('numero_pedido') != rq(db, "select numero_pedido from pedidos where id=%s", p2)[0][0], str(adv))
reclamar(w, op3, 'H-1', tel=TEL, vis='vis-J', otro=True)
cand = rq(db, "select candidatos from pedido_revisiones_duplicado where empresa_id=%s and operacion_id=%s", w['emp'], op3)[0][0]
check('A3. la revisión del #3 lista como candidato SOLO al #1 (el #2 duplicado no figura)', [str(x) for x in cand] == [str(op1)], str(cand))
w, (op1, p1, op2, p2) = escenario(db, 'DUPLICADO')
r = reclamar(w, uuid.uuid4(), 'H-1', tel=TEL, vis=None)   # sin visitante (mismo teléfono), contenido idéntico al duplicado
check('A4. mismo teléfono y contenido idéntico al del DUPLICADO (otro visitante): tampoco lo detecta', est(r) == 'NUEVA', str(r))

print('=== B · revisión LEGITIMO ===')
w, (op1, p1, op2, p2) = escenario(db, 'LEGITIMO')
r = reclamar(w, uuid.uuid4(), 'H-9', tel=TEL, vis='vis-J')
check('B1. el #2 LEGITIMO sigue siendo candidato activo (PEDIDO_ACTIVO con su pedido)', est(r) == 'PEDIDO_ACTIVO' and r['existente'].get('pedido_id') == str(p2), str(r))

print('=== C · revisión PENDIENTE ===')
w, (op1, p1, op2, p2) = escenario(db, None)
check('C0. (precondición) la revisión del #2 está PENDIENTE', rq(db, "select estado from pedido_revisiones_duplicado where empresa_id=%s and operacion_id=%s", w['emp'], op2)[0][0] == 'PENDIENTE')
r = reclamar(w, uuid.uuid4(), 'H-9', tel=TEL, vis='vis-J')
check('C1. el #2 con revisión PENDIENTE conserva el comportamiento actual: es candidato', est(r) == 'PEDIDO_ACTIVO' and r['existente'].get('pedido_id') == str(p2), str(r))

print('=== D · sin revisión ===')
w, (op1, p1, op2, p2) = escenario(db, 'SIN_REVISION')
r = reclamar(w, uuid.uuid4(), 'H-9', tel=TEL, vis='vis-J')
check('D1. pedido sin revisión: conserva el comportamiento anterior (candidato)', est(r) == 'PEDIDO_ACTIVO' and r['existente'].get('pedido_id') == str(p2), str(r))
w = world(db); _, _, p = comprar(w, 'H-1', tel=TEL, vis='vis-J'); r = reclamar(w, uuid.uuid4(), 'H-9', tel=TEL, vis='vis-J')
check('D2. un solo pedido activo (sin ninguna revisión en la empresa): PEDIDO_ACTIVO como siempre', est(r) == 'PEDIDO_ACTIVO' and r['existente'].get('pedido_id') == str(p))
w = world(db, bloqueo=False); _, _, p = comprar(w, 'H-1', tel=TEL, vis='vis-J', alcance=False); r = reclamar(w, uuid.uuid4(), 'H-1', tel=TEL, vis='vis-J', alcance=False)
check('D3. llave apagada: el comportamiento anterior (DUPLICADO por contenido) no cambia', est(r) == 'DUPLICADO', str(r))

print('=== E · el duplicado conserva su estado histórico y no hay segunda devolución ===')
w, (op1, p1, op2, p2) = escenario(db, 'DUPLICADO')
rq(db, "update pedido_revisiones_duplicado set stock_devuelto_at = now() where empresa_id=%s and operacion_id=%s", w['emp'], op2)
antes = (rq(db, "select estado from pedidos where id=%s", p2)[0][0], rq(db, "select estado, stock_devuelto_at, reembolso_pendiente, resuelto_at from pedido_revisiones_duplicado where operacion_id=%s", op2)[0], stock(w), npedidos(w))
for h in ('H-9', 'H-1', 'H-7'): reclamar(w, uuid.uuid4(), h, tel=TEL, vis='vis-J')
despues = (rq(db, "select estado from pedidos where id=%s", p2)[0][0], rq(db, "select estado, stock_devuelto_at, reembolso_pendiente, resuelto_at from pedido_revisiones_duplicado where operacion_id=%s", op2)[0], stock(w), npedidos(w))
check('E1. el #2 sigue PENDING_PAYMENT, su revisión (estado, stock_devuelto_at, resuelto_at) no cambia y no se borra ni se crea ningún pedido', antes == despues and antes[0] == 'PENDING_PAYMENT' and antes[1][0] == 'DUPLICADO', f'{antes} / {despues}')
check('E2. el stock no se mueve (ninguna devolución adicional) y re-resolver el #2 es idempotente (YA_RESUELTA, sin repetir)',
      antes[2] == despues[2] and resolver(w, p2, 'DUPLICADO')['estado'] == 'YA_RESUELTA')

print('=== REVERSIÓN ===')
cr = connect(db).cursor(); cr.execute("select md5(pg_get_functiondef('public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean)'::regprocedure))"); md5_fix = cr.fetchone()[0]
err, _ = aplicar(cr, FIX_REV)
cr.execute("select md5(pg_get_functiondef('public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean)'::regprocedure))"); md5_rev = cr.fetchone()[0]
base = build('exc_base'); cb = connect(base).cursor(); cb.execute("select md5(pg_get_functiondef('public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean)'::regprocedure))"); md5_base = cb.fetchone()[0]
cr.execute("select has_function_privilege('anon','reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean)','execute'), has_function_privilege('service_role','reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean)','execute')"); pv = cr.fetchone()
check('R1. la reversión deja el cuerpo EXACTO de pedidos-duplicados-bloqueo.sql (md5 idéntico), distinto del corregido, y los permisos correctos',
      err is None and md5_rev == md5_base and md5_fix != md5_base and pv == (False, True), f'{err} {md5_rev == md5_base} {md5_fix != md5_base} {pv}')
err2, _ = aplicar(cr, FIX); err3, _ = aplicar(cr, FIX); cr.execute("select count(*) from pg_proc where proname='reclamar_operacion_pedido'")
check('R2. la corrección se re-aplica dos veces sin error y deja UNA función', err2 is None and err3 is None and cr.fetchone()[0] == 1)

print(f'\n{sum(R)}/{len(R)} PASS')
raise SystemExit(0 if all(R) else 1)
