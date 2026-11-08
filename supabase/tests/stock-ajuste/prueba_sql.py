#!/usr/bin/env python3
"""Stock Etapa 1 — ajuste general. Postgres LOCAL aislado (nunca Supabase).
Uso: python3 supabase/tests/stock-ajuste/prueba_sql.py"""
import os, sys, uuid, json, hashlib, threading, psycopg2, psycopg2.extras, psycopg2.errors
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.join(HERE, '..', '..')
DB = 'stock_ajuste_t'; CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db=DB): c = psycopg2.connect(dbname=db, **CONN); c.autocommit = True; return c
a = connect('postgres'); a.cursor().execute(f'drop database if exists {DB} with (force)'); a.cursor().execute(f'create database {DB}'); a.close()
db = connect(); c = db.cursor()
c.execute("""do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;""")
c.execute(open(os.path.join(SUP, 'tests/stock-v2/00-schema-reducido.sql'), encoding='utf-8').read())
c.execute("alter table productos add column activo boolean not null default true, add column deleted_at timestamptz")
c.execute("select md5(pg_get_functiondef('public.ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text)'::regprocedure))"); AJ_ANTES = c.fetchone()[0]
SQL = open(os.path.join(SUP, 'stock-ajuste-general.sql'), encoding='utf-8').read()
c.execute(SQL); c.execute(SQL)   # DOS veces: idempotente
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
def err(fn):
    try: fn(); return None
    except psycopg2.Error as e: return (e.pgerror or str(e)).split('\n')[0]

EMP, EMP2, USR = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
c.execute("insert into empresas(id) values (%s),(%s)", (EMP, EMP2))
SUC, SUC2, SUCX = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
c.execute("insert into sucursales(id,empresa_id) values (%s,%s),(%s,%s),(%s,%s)", (SUC, EMP, SUC2, EMP, SUCX, EMP2))
def prod(nombre='P', emp=EMP, controla=True, stock=None, suc=SUC):
    pid = uuid.uuid4(); c.execute("insert into productos(id,empresa_id,nombre,controla_stock) values (%s,%s,%s,%s)", (pid, emp, nombre, controla))
    if stock is not None: c.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values (%s,%s,%s,%s)", (emp, pid, suc, stock))
    return pid
def stk(pid, suc=SUC):
    c.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (pid, suc)); r = c.fetchone(); return None if r is None else r[0]
def items(*t): return json.dumps([{'producto_id': str(p), 'base': b, 'contado': k} for p, b, k in t])
def previ(its, lote=None, motivo='conteo', desc=None, suc=SUC, emp=EMP):
    c.execute("select public.previsualizar_ajuste_stock(%s,%s,%s,%s,%s,%s::jsonb)", (emp, suc, lote or uuid.uuid4(), motivo, desc, its)); return c.fetchone()[0]
def aplicar(its, lote=None, motivo='conteo', desc=None, huella=None, suc=SUC, emp=EMP, conn=None):
    cc = conn or c
    cc.execute("select public.aplicar_ajuste_stock(%s,%s,%s,%s,%s,%s,%s,now(),%s::jsonb,%s)", (emp, suc, lote or uuid.uuid4(), USR, 'Luci', motivo, desc, its, huella)); return cc.fetchone()[0]
def movs(pid): c.execute("select delta, motivo, ajuste_id, usuario_id, detalle from stock_movimientos where producto_id=%s order by created_at, id", (pid,)); return c.fetchall()

# T1 estructura
c.execute("select count(*) from information_schema.columns where table_name='stock_movimientos' and column_name in ('ajuste_id','usuario_id')"); check('T1a columnas ajuste_id y usuario_id (script aplicado 2 veces)', c.fetchone()[0] == 2)
c.execute("select count(*) from pg_tables where tablename in ('stock_ajustes','stock_ajuste_items') and rowsecurity"); check('T1b tablas nuevas con RLS activa y sin políticas', c.fetchone()[0] == 2)

# T2 la regla del CTO: base 20, se venden 3 → 17, cuenta 15 → diferencia −5 → 12 (NUNCA reemplazar por el contado)
p = prod('Ej CTO', stock=20); c.execute("select public.ajustar_stock(%s,%s,%s,-3,'delta','venta',null,null)", (EMP, SUC, p)) if False else None
c.execute("update producto_stock set cantidad=17 where producto_id=%s", (p,))   # las 3 ventas durante el conteo
its2 = items((p, 20, 15)); pv2 = previ(its2, lote=(L2 := uuid.uuid4()))
check('T2-pre el ejemplo del CTO (−5 sobre base 20 = 25%) pide segunda confirmación', pv2['resumen']['requiere_confirmacion'])
r = aplicar(its2, lote=L2, huella=pv2['huella'])
check('T2 ejemplo del CTO: base 20, ventas −3 durante el conteo, contado 15 → stock final 12 (no 15)', stk(p) == 12 and r['items'][0]['diff_aplicada'] == -5, f"stock={stk(p)}")
m = movs(p); check('T2b un movimiento «ajuste» de −5 con lote y usuario', len(m) == 1 and m[0][0] == -5 and m[0][1] == 'ajuste' and m[0][2] is not None and m[0][3] == USR, str(m))
c.execute("select base, contado, actual_antes, diff_pedida, diff_aplicada, stock_final, recortado from stock_ajuste_items where producto_id=%s", (p,))
check('T2c el ítem guarda base, contado, stock anterior, diferencia pedida/aplicada y final', c.fetchone() == (20, 15, 17, -5, -5, 12, False))

# T3 recorte a 0
p = prod('Recorte', stock=17); L3 = uuid.uuid4(); r = previ(items((p, 40, 20)), lote=L3)   # pide −20 sobre 17
it = r['items'][0]
check('T3a recorte: pedida −20, aplicada −17, final 0, marcado', it['diff_pedida'] == -20 and it['diff_aplicada'] == -17 and it['final'] == 0 and it['recortado'])
check('T3b el recorte exige segunda confirmación', r['resumen']['requiere_confirmacion'] and 'recorte_a_cero' in r['resumen']['motivos_confirmacion'])
e = err(lambda: aplicar(items((p, 40, 20)), lote=L3)); check('T3c sin confirmación NO aplica (CONFIRMACION_REQUERIDA) y el stock no cambia', e and 'CONFIRMACION_REQUERIDA' in e and stk(p) == 17, str(e))
r2 = aplicar(items((p, 40, 20)), lote=L3, huella=r['huella'])
c.execute("select diff_pedida, diff_aplicada, stock_final, recortado from stock_ajuste_items where producto_id=%s", (p,))
fi = c.fetchone(); check('T3d con la confirmación aplica: stock 0 y se conservan pedida (−20) y aplicada (−17)', stk(p) == 0 and fi == (-20, -17, 0, True), str(fi))
check('T3e el movimiento guardado es el realmente aplicado (−17) y deja constancia del recorte', movs(p)[0][0] == -17 and 'recortado' in (movs(p)[0][4] or ''), str(movs(p)))
c.execute("select count(*) from producto_stock where cantidad < 0"); check('T3f ningún stock negativo en la base', c.fetchone()[0] == 0)

# T4 producto sin fila
p = prod('Sin fila'); r = aplicar(items((p, 0, 8)))
check('T4a sin fila: base 0, contado 8 → se crea la fila con 8 y movimiento +8', stk(p) == 8 and movs(p)[0][0] == 8 and r['items'][0]['fila_nueva'])
p0 = prod('Sin fila cero'); aplicar(items((p0, 0, 0)))
check('T4b sin fila contado 0 → se da de alta la fila en 0, sin movimiento', stk(p0) == 0 and movs(p0) == [])
p = prod('Fila aparece'); c.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values (%s,%s,%s,5)", (EMP, p, SUC))  # apareció durante el conteo (compra)
aplicar(items((p, 0, 8)))
check('T4c la fila aparece durante el conteo (5): se conserva ese movimiento → 5 + (8−0) = 13', stk(p) == 13)

# T5 idempotencia
p = prod('Idem', stock=10); L = uuid.uuid4(); its = items((p, 10, 13))
r1 = aplicar(its, lote=L); r2 = aplicar(its, lote=L)
check('T5a mismo lote dos veces: se aplica UNA vez (13) y la 2ª devuelve ya_aplicado', stk(p) == 13 and r2['estado'] == 'ya_aplicado' and len(movs(p)) == 1)
e = err(lambda: aplicar(its, lote=L, suc=SUC2)); check('T5b el mismo lote desde otra sucursal se rechaza', e and 'LOTE_DE_OTRO_ALCANCE' in e, str(e))
ths, res = [], []
p = prod('Conc', stock=10); L = uuid.uuid4(); its = items((p, 10, 14))
def w():
    cn = connect()
    try: res.append(aplicar(its, lote=L, conn=cn.cursor())['estado'])
    except Exception as ex: res.append('ERR ' + str(ex)[:60])
    cn.close()
ths = [threading.Thread(target=w) for _ in range(10)]; [t.start() for t in ths]; [t.join() for t in ths]
check('T5c 10 envíos simultáneos del MISMO lote: uno aplica, 9 ya_aplicado, stock una sola vez', stk(p) == 14 and res.count('aplicado') == 1 and res.count('ya_aplicado') == 9 and len(movs(p)) == 1, f"{stk(p)} {res}")

# T6 segunda confirmación: umbrales
def req(base, contado, stock):
    p = prod('U', stock=stock); return previ(items((p, base, contado)))['resumen']['requiere_confirmacion']
check('T6a diferencia chica (2 sobre 100) NO pide confirmación', req(100, 98, 100) is False)
check('T6b 20% y ≥5 unidades (10 → 8… 20 → 15 = 25%, 5 u) SÍ pide', req(20, 15, 20) is True)
check('T6c 20% pero solo 3 unidades (10 → 7) NO pide', req(10, 7, 10) is False)
check('T6d ≥5 unidades pero <20% (5 sobre 100) NO pide', req(100, 95, 100) is False)
check('T6e 50 unidades absolutas SÍ pide (aunque sea <20%)', req(1000, 950, 1000) is True)
check('T6f alta de 6 unidades con base 0 NO pide (el % no aplica a base 0)', req(0, 6, None) is False)
ps = [prod(f'L{i}', stock=1000) for i in range(5)]
rr = previ(items(*[(x, 1000, 1000 - 25) for x in ps]))   # 5 × 25 = 125 ≥ 100, ningún ítem solo califica
check('T6g lote de 125 unidades entre 5 productos (ninguno califica solo) SÍ pide por lote', rr['resumen']['requiere_confirmacion'] and 'lote_grande' in rr['resumen']['motivos_confirmacion'])

# T7 confirmación atada al resumen
p = prod('Conf', stock=200); its = items((p, 200, 100)); pv = previ(its, lote=(L := uuid.uuid4()))
e = err(lambda: aplicar(its, lote=L, huella='0' * 64)); check('T7a huella inventada → CONFIRMACION_INVALIDA', e and 'CONFIRMACION_INVALIDA' in e and stk(p) == 200, str(e))
e = err(lambda: aplicar(items((p, 200, 90)), lote=L, huella=pv['huella'])); check('T7b la confirmación de OTRO conteo (otro contado) no sirve', e and 'CONFIRMACION_INVALIDA' in e and stk(p) == 200, str(e))
e = err(lambda: aplicar(its, lote=L, motivo='merma', huella=pv['huella'])); check('T7c cambiar el motivo invalida la confirmación', e and 'CONFIRMACION_INVALIDA' in e, str(e))
e = err(lambda: aplicar(its, lote=uuid.uuid4(), huella=pv['huella'])); check('T7d la confirmación de un lote no sirve para otro lote', e and 'CONFIRMACION_INVALIDA' in e, str(e))
c.execute("update producto_stock set cantidad=199 where producto_id=%s", (p,))   # una venta mientras se revisa: no cambia lo relevante
r = aplicar(its, lote=L, huella=pv['huella']); check('T7e una venta durante la revisión (sin cambiar recortes) no invalida; aplica por diferencia (199−100=99)', stk(p) == 99 and r['estado'] == 'aplicado', f"stock={stk(p)}")
p = prod('Conf2', stock=30); its = items((p, 60, 20)); pv = previ(its, lote=(L := uuid.uuid4()))   # actual 30, pide −40 → recorta (30−40<0)… diff −40, final 0
check('T7f (preparación) este caso recorta', pv['items'][0]['recortado'])
c.execute("update producto_stock set cantidad=50 where producto_id=%s", (p,))   # entra mercadería: ya NO recorta → cambia lo relevante
e = err(lambda: aplicar(its, lote=L, huella=pv['huella'])); check('T7g si cambia el resultado relevante (deja de recortar) la confirmación se invalida', e and 'CONFIRMACION_INVALIDA' in e and stk(p) == 50, str(e))

# T8 validaciones y atomicidad
p1 = prod('V1', stock=10); pf = prod('Ajena', emp=EMP2, stock=10, suc=SUCX); pn = prod('NoControla', controla=False)
e = err(lambda: aplicar(items((p1, 10, 11), (pf, 10, 11)))); check('T8a producto de otra empresa → PRODUCTO_INVALIDO y NADA se aplica (atómico)', e and 'PRODUCTO_INVALIDO' in e and stk(p1) == 10, str(e))
e = err(lambda: aplicar(items((pn, 0, 5)))); check('T8b producto que no controla stock se rechaza', e and 'PRODUCTO_INVALIDO' in e, str(e))
e = err(lambda: aplicar(items((p1, 10, 11), (p1, 10, 12)))); check('T8c producto repetido en el lote se rechaza', e and 'AJUSTE_PRODUCTO_REPETIDO' in e, str(e))
e = err(lambda: aplicar(items((p1, 10, -1)))); check('T8d contado negativo se rechaza', e and 'AJUSTE_ITEM_INVALIDO' in e, str(e))
e = err(lambda: aplicar(items((p1, 10, 11)), suc=SUCX)); check('T8e sucursal de otra empresa → SUCURSAL_INVALIDA', e and 'SUCURSAL_INVALIDA' in e, str(e))
e = err(lambda: aplicar('[]')); check('T8f lote vacío se rechaza', e and 'AJUSTE_SIN_ITEMS' in e, str(e))
e = err(lambda: aplicar(items((p1, 10, 11)), motivo='otro')); check('T8g motivo «otro» exige descripción', e and 'MOTIVO_OTRO_SIN_DESCRIPCION' in e, str(e))
e = err(lambda: aplicar(items((p1, 10, 11)), motivo='regalo')); check('T8h motivo fuera de la lista se rechaza', e and 'MOTIVO_INVALIDO' in e, str(e))
aplicar(items((p1, 10, 11)), motivo='otro', desc='Se rompió el freezer'); check('T8i motivo «otro» con descripción aplica y la guarda', stk(p1) == 11)
c.execute("select count(*) from stock_ajustes where descripcion='Se rompió el freezer'"); check('T8j la descripción queda en el lote', c.fetchone()[0] == 1)
for mo in ('conteo', 'merma', 'rotura', 'vencimiento'):
    pm = prod('M' + mo, stock=5); aplicar(items((pm, 5, 6)), motivo=mo)
check('T8k los 4 motivos de la lista (+otro con descripción) aplican', True)
e = err(lambda: aplicar(items((p1, 11, 12)), motivo='conciliacion')); check('T8l «conciliacion» ya no es un motivo válido', e and 'MOTIVO_INVALIDO' in e, str(e))

# T9 concurrencia con ventas y entre ajustes
p = prod('Vta', stock=100); its = items((p, 100, 90)); L = uuid.uuid4()
def vender():
    cn = connect(); k = cn.cursor()
    for _ in range(10): k.execute("select public.ajustar_stock(%s,%s,%s,-1,'delta','ajuste',null,'venta simulada')", (EMP, SUC, p))
    cn.close()
def ajustar():
    cn = connect()
    try: aplicar(its, lote=L, conn=cn.cursor())
    except Exception as ex: print('ERR', ex)
    cn.close()
ths = [threading.Thread(target=vender) for _ in range(4)] + [threading.Thread(target=ajustar)]; [t.start() for t in ths]; [t.join() for t in ths]
check('T9a ajuste a la vez que 40 ventas: 100 − 40 − 10 = 50 (ninguna venta se pierde)', stk(p) == 50, f"stock={stk(p)}")
pa, pb = prod('A', stock=50), prod('B', stock=50); out = []
def opuesto(orden):
    cn = connect()
    try: aplicar(items(*[(x, 50, 45) for x in orden]), lote=uuid.uuid4(), conn=cn.cursor()); out.append('ok')
    except Exception as ex: out.append('ERR ' + str(ex)[:60])
    cn.close()
ths = [threading.Thread(target=opuesto, args=([pa, pb] if i % 2 else [pb, pa],)) for i in range(8)]; [t.start() for t in ths]; [t.join() for t in ths]
check('T9b 8 ajustes cruzados (A,B / B,A) a la vez: sin deadlock y todos aplican (50 − 8×5 = 10)', out.count('ok') == 8 and stk(pa) == 10 and stk(pb) == 10, f"{out} {stk(pa)} {stk(pb)}")

# T10 seguridad / no tocar lo existente
c.execute("select md5(pg_get_functiondef('public.ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text)'::regprocedure))"); check('T10a ajustar_stock NO fue modificada', c.fetchone()[0] == AJ_ANTES)
fs = ['public.aplicar_ajuste_stock(uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,text,numeric,integer,integer,integer)', 'public.previsualizar_ajuste_stock(uuid,uuid,uuid,text,text,jsonb,numeric,integer,integer,integer)', 'public._calcular_ajuste_stock(uuid,uuid,uuid,text,text,jsonb,numeric,integer,integer,integer)']
ok = True
for f in fs:
    for rol, esperado in (('anon', False), ('authenticated', False), ('service_role', True)):
        c.execute("select has_function_privilege(%s, %s::regprocedure, 'execute')", (rol, f)); ok &= (c.fetchone()[0] == esperado)
check('T10b solo service_role ejecuta las 3 funciones (anon y authenticated no)', ok)
c.execute("select count(*) from stock_movimientos where motivo='ajuste' and ajuste_id is null and detalle like 'Ajuste general%'"); check('T10c todo movimiento del ajuste general quedó con lote y usuario', c.fetchone()[0] == 0)
c.execute("select count(*) from producto_stock where cantidad < 0"); check('T10d ningún stock negativo al final de todas las pruebas', c.fetchone()[0] == 0)

print(f"\n{sum(R)}/{len(R)}"); sys.exit(0 if all(R) else 1)
