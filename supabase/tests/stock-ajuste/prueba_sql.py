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
def items(*t): return json.dumps([{'producto_id': str(p), 'base': b, 'contado': k} for p, b, k in t])   # (producto, base al iniciar, contado)
def sembrar(its, lote, suc=SUC, emp=EMP, usr=USR):
    """Simula «el conteo se inició cuando el stock era `base`»: crea el conteo y su snapshot (lo que hace iniciar_conteo_stock)."""
    c.execute("select 1 from stock_conteos where id=%s", (lote,))
    if c.fetchone() is None:
        c.execute("insert into stock_conteos(id,empresa_id,sucursal_id,usuario_id,usuario_nombre) values (%s,%s,%s,%s,'Luci')", (lote, emp, suc, usr))
        for it in json.loads(its):
            b = it.get('base')
            if isinstance(b, int) and b >= 0:
                c.execute("insert into stock_conteo_base(conteo_id,producto_id,base) values (%s,%s,%s) on conflict do nothing", (lote, it['producto_id'], b))
def sin_base(its): return json.dumps([{k: v for k, v in it.items() if k != 'base'} for it in json.loads(its)])   # el navegador NO manda la base
def previ(its, lote=None, motivo='conteo', desc=None, suc=SUC, emp=EMP):
    lote = lote or uuid.uuid4(); sembrar(its, lote, suc, emp)
    c.execute("select public.previsualizar_ajuste_stock(%s,%s,%s,%s,%s,%s::jsonb)", (emp, suc, lote, motivo, desc, sin_base(its))); return c.fetchone()[0]
def aplicar(its, lote=None, motivo='conteo', desc=None, huella=None, suc=SUC, emp=EMP, conn=None, usr=None):
    lote = lote or uuid.uuid4(); cc = conn or c
    if conn is None: sembrar(its, lote, suc, emp)
    cc.execute("select public.aplicar_ajuste_stock(%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)", (emp, suc, lote, usr or USR, 'Luci', motivo, desc, sin_base(its), huella)); return cc.fetchone()[0]
def movs(pid): c.execute("select delta, motivo, ajuste_id, usuario_id, detalle from stock_movimientos where producto_id=%s order by created_at, id", (pid,)); return c.fetchall()

# T1 estructura
c.execute("select count(*) from information_schema.columns where table_name='stock_movimientos' and column_name in ('ajuste_id','usuario_id')"); check('T1a columnas ajuste_id y usuario_id (script aplicado 2 veces)', c.fetchone()[0] == 2)
c.execute("select count(*) from pg_tables where tablename in ('stock_ajustes','stock_ajuste_items','stock_conteos','stock_conteo_base') and rowsecurity"); check('T1b las 4 tablas nuevas con RLS activa y sin políticas', c.fetchone()[0] == 4)

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
p = prod('Conc', stock=10); L = uuid.uuid4(); its = items((p, 10, 14)); sembrar(its, L)
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
c.execute("update producto_stock set cantidad=199 where producto_id=%s", (p,))   # una venta mientras se revisa: cambia stock actual y final → ya no es lo que vio el administrador
e = err(lambda: aplicar(its, lote=L, huella=pv['huella'])); check('T7e una venta durante la revisión INVALIDA la confirmación (cambió actual y final) y no aplica', e and 'CONFIRMACION_INVALIDA' in e and stk(p) == 199, str(e))
pv = previ(its, lote=L); r = aplicar(its, lote=L, huella=pv['huella']); check('T7e2 con el resumen nuevo se confirma y aplica por diferencia (199−100=99)', stk(p) == 99 and r['estado'] == 'aplicado', f"stock={stk(p)}")
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
p = prod('Vta', stock=100); its = items((p, 100, 90)); L = uuid.uuid4(); sembrar(its, L)
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
LOTES9 = [uuid.uuid4() for _ in range(8)]
for LL in LOTES9: sembrar(items((pa, 50, 45), (pb, 50, 45)), LL)
def opuesto(orden, LL):
    cn = connect()
    try: aplicar(items(*[(x, 50, 45) for x in orden]), lote=LL, conn=cn.cursor()); out.append('ok')
    except Exception as ex: out.append('ERR ' + str(ex)[:60])
    cn.close()
ths = [threading.Thread(target=opuesto, args=([pa, pb] if i % 2 else [pb, pa], LOTES9[i])) for i in range(8)]; [t.start() for t in ths]; [t.join() for t in ths]
check('T9b 8 ajustes cruzados (A,B / B,A) a la vez: sin deadlock y todos aplican (50 − 8×5 = 10)', out.count('ok') == 8 and stk(pa) == 10 and stk(pb) == 10, f"{out} {stk(pa)} {stk(pb)}")


# ═══ CORRECCIONES DEL CTO (3 puntos) — pruebas específicas, con iniciar_conteo_stock REAL ═══
def iniciar(suc=SUC, emp=EMP, usr=USR, conn=None):
    cc = conn or c; cc.execute("select public.iniciar_conteo_stock(%s,%s,%s,'Luci')", (emp, suc, usr)); return cc.fetchone()[0]
def ci(*t): return json.dumps([{'producto_id': str(p), 'contado': k} for p, k in t])    # lo único que manda el navegador
def apl(its, lote, huella=None, motivo='conteo', usr=None, suc=SUC, emp=EMP, conn=None):
    cc = conn or c; cc.execute("select public.aplicar_ajuste_stock(%s,%s,%s,%s,'Luci',%s,null,%s::jsonb,%s)", (emp, suc, lote, usr or USR, motivo, its, huella)); return cc.fetchone()[0]
def prv(its, lote, suc=SUC, emp=EMP):
    c.execute("select public.previsualizar_ajuste_stock(%s,%s,%s,'conteo',null,%s::jsonb)", (emp, suc, lote, its)); return c.fetchone()[0]

# P1 — la base queda congelada en el SERVIDOR
pA = prod('SnapA', stock=20); pB = prod('SnapB'); pN = prod('SnapNoCtl', controla=False); pX = prod('SnapAjena', emp=EMP2, stock=9, suc=SUCX)
ini = iniciar(); LP = uuid.UUID(ini['lote_id']); bases = {i['producto_id']: i for i in ini['items']}
check('P1a iniciar guarda el snapshot: producto con stock = 20, sin fila = 0 (marcado sin_alta)', bases[str(pA)]['base'] == 20 and bases[str(pB)]['base'] == 0 and bases[str(pB)]['sin_alta'] is True)
check('P1b el snapshot solo trae productos con control de stock de la empresa (no los de otra empresa ni los que no controlan)', str(pN) not in bases and str(pX) not in bases)
c.execute("select count(*) from stock_conteo_base where conteo_id=%s and producto_id=%s and base=20", (LP, pA)); check('P1c la base 20 quedó guardada en la base de datos', c.fetchone()[0] == 1)
c.execute("update producto_stock set cantidad=17 where producto_id=%s", (pA,))     # 3 ventas durante el conteo
pvP = prv(ci((pA, 15)), LP)
check('P1d el navegador manda SOLO contado: el servidor usa su base 20 → diferencia −5 sobre stock 17 → final 12', pvP['items'][0]['base'] == 20 and pvP['items'][0]['diff_pedida'] == -5 and pvP['items'][0]['final'] == 12)
falso = json.dumps([{'producto_id': str(pA), 'contado': 15, 'base': 1000}])           # un cliente tramposo manda otra base
pvF = prv(falso, LP); check('P1e una base falsa enviada por el cliente se IGNORA (sigue usando la del servidor)', pvF['items'][0]['base'] == 20 and pvF['huella'] == pvP['huella'])
rP = apl(ci((pA, 15)), LP, huella=pvP['huella']); check('P1f aplicar con la base del servidor: stock final 12 (no 15)', stk(pA) == 12 and rP['estado'] == 'aplicado', f"stock={stk(pA)}")
c.execute("select estado from stock_conteos where id=%s", (LP,)); check('P1g el conteo queda «aplicado»', c.fetchone()[0] == 'aplicado')
check('P1h previsualizar un conteo ya aplicado se rechaza (CONTEO_YA_APLICADO)', 'CONTEO_YA_APLICADO' in (err(lambda: prv(ci((pA, 15)), LP)) or ''))
e = err(lambda: apl(ci((pA, 15)), uuid.uuid4())); check('P1i aplicar sin haber iniciado el conteo → CONTEO_NO_ENCONTRADO', e and 'CONTEO_NO_ENCONTRADO' in e, str(e))
ini2 = iniciar(); L2c = uuid.UUID(ini2['lote_id']); pNew = prod('CreadoDespues', stock=3)
e = err(lambda: apl(ci((pNew, 5)), L2c)); check('P1j producto creado DESPUÉS de iniciar no está en el snapshot → PRODUCTO_FUERA_DEL_CONTEO', e and 'PRODUCTO_FUERA_DEL_CONTEO' in e and stk(pNew) == 3, str(e))
e = err(lambda: apl(ci((pA, 15)), L2c, usr=uuid.uuid4())); check('P1k otro usuario no puede aplicar un conteo ajeno → CONTEO_DE_OTRO_USUARIO', e and 'CONTEO_DE_OTRO_USUARIO' in e, str(e))
e = err(lambda: apl(ci((pA, 15)), L2c, suc=SUC2)); check('P1l conteo de otra sucursal → LOTE_DE_OTRO_ALCANCE', e and 'LOTE_DE_OTRO_ALCANCE' in e, str(e))
e = err(lambda: iniciar(suc=SUCX)); check('P1m iniciar con sucursal de otra empresa → SUCURSAL_INVALIDA', e and 'SUCURSAL_INVALIDA' in e, str(e))

# P1n — un lote fallido NUNCA queda como exitoso: sin confirmación no aplica, el conteo sigue abierto y se puede reintentar
pF = prod('Fallido', stock=100); iniF = iniciar(); LF = uuid.UUID(iniF['lote_id'])
e = err(lambda: apl(ci((pF, 40)), LF)); c.execute("select estado from stock_conteos where id=%s", (LF,)); est = c.fetchone()[0]
c.execute("select count(*) from stock_ajustes where id=%s", (LF,)); n_aj = c.fetchone()[0]
check('P1n lote que falla (CONFIRMACION_REQUERIDA): conteo sigue «abierto», sin lote registrado y stock intacto', e and 'CONFIRMACION_REQUERIDA' in e and est == 'abierto' and n_aj == 0 and stk(pF) == 100, f"{e} {est} {n_aj} {stk(pF)}")
pvF2 = prv(ci((pF, 40)), LF); rF = apl(ci((pF, 40)), LF, huella=pvF2['huella']); rF2 = apl(ci((pF, 40)), LF, huella=pvF2['huella'])
check('P1o el reintento aplica entero una vez y el siguiente devuelve ya_aplicado', rF['estado'] == 'aplicado' and rF2['estado'] == 'ya_aplicado' and stk(pF) == 40)
pG = prod('FalloAtomico', stock=50); pM = prod('FalloMitad', stock=50); iniG = iniciar(); LG = uuid.UUID(iniG['lote_id'])
c.execute("update productos set controla_stock=false where id=%s", (pM,))            # el 2º producto deja de ser válido después de iniciar
e = err(lambda: apl(ci((pG, 49), (pM, 49)), LG)); c.execute("select estado from stock_conteos where id=%s", (LG,)); estG = c.fetchone()[0]
check('P1p si UN producto del lote es inválido no se aplica NINGUNO y el conteo no queda «aplicado»', e and stk(pG) == 50 and estG == 'abierto', str(e))

# P2 — la huella incluye stock ACTUAL y FINAL (ejemplo del CTO: 17 → vista previa final 12 → entra otra venta → 15 → final 10)
pH = prod('HuellaCTO', stock=20); iniH = iniciar(); LH = uuid.UUID(iniH['lote_id'])
c.execute("update producto_stock set cantidad=17 where producto_id=%s", (pH,))
itsH = ci((pH, 15)); pvH = prv(itsH, LH)
check('P2a vista previa: actual 17, diferencia −5, final 12 (pide confirmación)', pvH['items'][0]['actual'] == 17 and pvH['items'][0]['final'] == 12 and pvH['resumen']['requiere_confirmacion'])
c.execute("update producto_stock set cantidad=15 where producto_id=%s", (pH,))      # entra OTRA venta: la diferencia aplicada sigue siendo −5, pero el resultado cambia (final 10)
pvH2 = prv(itsH, LH)
check('P2b la diferencia aplicada es la misma (−5) pero la huella CAMBIA porque cambió actual y final', pvH2['items'][0]['diff_aplicada'] == -5 and pvH2['huella'] != pvH['huella'])
e = err(lambda: apl(itsH, LH, huella=pvH['huella'])); check('P2c la confirmación vieja (final 12) NO sirve: CONFIRMACION_INVALIDA y no se aplica', e and 'CONFIRMACION_INVALIDA' in e and stk(pH) == 15, str(e))
rH = apl(itsH, LH, huella=pvH2['huella']); check('P2d con el resumen nuevo (final 10) se confirma y aplica', stk(pH) == 10 and rH['items'][0]['final'] == 10, f"stock={stk(pH)}")
pH3 = prod('HuellaEstable', stock=100); iniH3 = iniciar(); LH3 = uuid.UUID(iniH3['lote_id']); itsH3 = ci((pH3, 70)); pv1 = prv(itsH3, LH3); pv2 = prv(itsH3, LH3)
check('P2e sin cambios entre vista previa y aplicación la huella es idéntica (determinista)', pv1['huella'] == pv2['huella'])
c.execute("select public.aplicar_ajuste_stock(%s,%s,%s,%s,'Luci','conteo',null,%s::jsonb,%s)", (EMP, SUC, LH3, USR, itsH3, pv1['huella'])); check('P2f y con esa huella aplica', stk(pH3) == 70)

# P3 — productos SIN fila: alta concurrente segura
def concurrente(n, contados, mezcla=False):
    p = prod('SinFilaConc'); lotes = []
    for k in range(n):
        lotes.append(uuid.UUID(iniciar()['lote_id']))                                    # todos parten con base 0 (sin fila)
    out = []
    def w(k):
        cn = connect(); cur = cn.cursor()
        try: apl(ci((p, contados[k])), lotes[k], conn=cur); out.append('ok')
        except Exception as ex: out.append('ERR ' + str(ex).split('\n')[0][:70])
        cn.close()
    ths = [threading.Thread(target=w, args=(k,)) for k in range(n)]; [t.start() for t in ths]; [t.join() for t in ths]
    return p, out
p, out = concurrente(6, [1, 2, 3, 4, 5, 6])
c.execute("select count(*) from producto_stock where producto_id=%s and sucursal_id=%s", (p, SUC)); filas = c.fetchone()[0]
c.execute("select count(*), coalesce(sum(delta),0) from stock_movimientos where producto_id=%s", (p,)); nm, sm = c.fetchone()
check('P3a 6 altas simultáneas del MISMO producto sin fila: todas OK, UNA sola fila, ninguna actualización perdida (1+…+6 = 21)', out.count('ok') == 6 and filas == 1 and stk(p) == 21 and nm == 6 and sm == 21, f"{out} filas={filas} stock={stk(p)} movs={nm}/{sm}")
pa2, pb2 = prod('SF_A'), prod('SF_B'); L1, L2 = uuid.UUID(iniciar()['lote_id']), uuid.UUID(iniciar()['lote_id']); res3 = []
def cruz(orden, LL):
    cn = connect()
    try: apl(ci(*[(x, 4) for x in orden]), LL, conn=cn.cursor()); res3.append('ok')
    except Exception as ex: res3.append('ERR ' + str(ex).split('\n')[0][:70])
    cn.close()
ths = [threading.Thread(target=cruz, args=([pa2, pb2], L1)), threading.Thread(target=cruz, args=([pb2, pa2], L2))]; [t.start() for t in ths]; [t.join() for t in ths]
check('P3b dos lotes cruzados (A,B / B,A) sobre productos sin fila: sin deadlock, ambos aplican (4 + 4 = 8 cada uno)', res3.count('ok') == 2 and stk(pa2) == 8 and stk(pb2) == 8, f"{res3} {stk(pa2)} {stk(pb2)}")
pv3 = prod('SF_Vta'); iv = iniciar(); LV = uuid.UUID(iv['lote_id']); c.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values (%s,%s,%s,5)", (EMP, pv3, SUC))  # una compra crea la fila mientras se cuenta
rV = apl(ci((pv3, 8)), LV); check('P3c la fila la crea una compra durante el conteo (5): se conserva → 5 + (8 − 0) = 13 y no es «alta nueva»', stk(pv3) == 13 and rV['items'][0]['fila_nueva'] is False, f"stock={stk(pv3)}")
c.execute("select count(*) from (select producto_id, sucursal_id from producto_stock group by 1,2 having count(*) > 1) d"); check('P3d ninguna fila de stock duplicada en toda la base', c.fetchone()[0] == 0)
# Informativo (NO cuenta): ajustar_stock, que NO se modifica, no usa ON CONFLICT: dos primeras ventas simultáneas de un producto sin fila pueden chocar con la restricción única.
choques = 0
for _ in range(15):
    pz = prod('Informativo'); r2 = []
    def vv():
        cn = connect(); k = cn.cursor()
        try: k.execute("select public.ajustar_stock(%s,%s,%s,-0,'delta','ajuste',null,'x')", (EMP, SUC, pz)); k.execute("select public.ajustar_stock(%s,%s,%s,1,'delta','ajuste',null,'x')", (EMP, SUC, pz)); r2.append('ok')
        except psycopg2.errors.UniqueViolation: r2.append('23505')
        except Exception as ex: r2.append('otro')
        cn.close()
    ths = [threading.Thread(target=vv) for _ in range(2)]; [t.start() for t in ths]; [t.join() for t in ths]; choques += r2.count('23505')
print(f"INFO ajustar_stock sin ON CONFLICT: {choques} choques 23505 en 15 intentos de doble alta simultánea (comportamiento previo, NO modificado)")


# P4 — el movimiento SIEMPRE se asocia al lote; si no se puede, no queda NADA aplicado (stock, lote, ítems ni conteo cerrado)
c.execute("""create or replace function trg_t_sin_mov() returns trigger language plpgsql as $$ begin
  if new.detalle like 'Ajuste general%' and exists (select 1 from productos where id = new.producto_id and nombre = 'P4_CERO') then return null; end if; return new; end $$;
  create or replace function trg_t_doble_mov() returns trigger language plpgsql as $$ begin
  if new.detalle like 'Ajuste general%' and exists (select 1 from productos where id = new.producto_id and nombre = 'P4_DOBLE') then
    insert into stock_movimientos(empresa_id,sucursal_id,producto_id,delta,motivo,detalle,created_at) values (new.empresa_id,new.sucursal_id,new.producto_id,new.delta,new.motivo,new.detalle,new.created_at); end if; return null; end $$;""")
def estado_lote(L, p):
    c.execute("select estado from stock_conteos where id=%s", (L,)); e = c.fetchone()[0]
    c.execute("select count(*) from stock_ajustes where id=%s", (L,)); a = c.fetchone()[0]
    c.execute("select count(*) from stock_ajuste_items where ajuste_id=%s", (L,)); i = c.fetchone()[0]
    c.execute("select count(*) from stock_movimientos where producto_id=%s", (p,)); m = c.fetchone()[0]
    return e, a, i, m
for nombre, trg_fn, cod in (('P4_CERO', 'trg_t_sin_mov', 'cero'), ('P4_DOBLE', 'trg_t_doble_mov', 'más de uno')):
    pz = prod(nombre, stock=50); pw = prod('P4_OK_' + cod, stock=50)
    ini = iniciar(); LZ = uuid.UUID(ini['lote_id'])
    c.execute(f"create trigger t_p4 before insert on stock_movimientos for each row execute function {trg_fn}()")
    e = err(lambda: apl(ci((pw, 49), (pz, 49)), LZ)); c.execute("drop trigger t_p4 on stock_movimientos")
    est = estado_lote(LZ, pz); estw = estado_lote(LZ, pw)
    check(f"P4 si el movimiento no se puede asociar ({cod} encontrado): MOVIMIENTO_NO_ASOCIADO", e and 'MOVIMIENTO_NO_ASOCIADO' in e, str(e))
    check(f"P4 ({cod}) no queda aplicado NADA: stock intacto en los DOS productos (incluido el que sí se había ajustado antes)", stk(pz) == 50 and stk(pw) == 50, f"{stk(pz)} {stk(pw)}")
    check(f"P4 ({cod}) sin lote, sin ítems, sin movimientos del lote y el conteo sigue «abierto»", est[0] == 'abierto' and est[1] == 0 and est[2] == 0 and est[3] == 0 and estw[3] == 0, f"{est} {estw}")
    r = apl(ci((pw, 49), (pz, 49)), LZ); est2 = estado_lote(LZ, pz)
    check(f"P4 ({cod}) sin el problema, el MISMO conteo se reintenta y aplica entero, cada movimiento con lote y usuario", r['estado'] == 'aplicado' and stk(pz) == 49 and stk(pw) == 49 and est2[0] == 'aplicado', f"{est2}")
c.execute("select count(*) from stock_movimientos where motivo='ajuste' and detalle like 'Ajuste general%' and (ajuste_id is null or usuario_id is null)"); check('P4 todo movimiento de ajuste general quedó con lote y usuario (ninguno huérfano)', c.fetchone()[0] == 0)

# T10 seguridad / no tocar lo existente
c.execute("select md5(pg_get_functiondef('public.ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text)'::regprocedure))"); check('T10a ajustar_stock NO fue modificada', c.fetchone()[0] == AJ_ANTES)
fs = ['public.aplicar_ajuste_stock(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,numeric,integer,integer,integer)', 'public.previsualizar_ajuste_stock(uuid,uuid,uuid,text,text,jsonb,numeric,integer,integer,integer)', 'public._calcular_ajuste_stock(uuid,uuid,uuid,text,text,jsonb,numeric,integer,integer,integer,uuid[])', 'public.iniciar_conteo_stock(uuid,uuid,uuid,text)']
ok = True
for f in fs:
    for rol, esperado in (('anon', False), ('authenticated', False), ('service_role', True)):
        c.execute("select has_function_privilege(%s, %s::regprocedure, 'execute')", (rol, f)); ok &= (c.fetchone()[0] == esperado)
check('T10b solo service_role ejecuta las 4 funciones (anon y authenticated no)', ok)
c.execute("select count(*) from stock_movimientos where motivo='ajuste' and ajuste_id is null and detalle like 'Ajuste general%'"); check('T10c todo movimiento del ajuste general quedó con lote y usuario', c.fetchone()[0] == 0)
c.execute("select count(*) from producto_stock where cantidad < 0"); check('T10d ningún stock negativo al final de todas las pruebas', c.fetchone()[0] == 0)

print(f"\n{sum(R)}/{len(R)}"); sys.exit(0 if all(R) else 1)
