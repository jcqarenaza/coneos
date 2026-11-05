#!/usr/bin/env python3
"""Estrés mixto: ventas / compras / ajustes concurrentes, funciones REALES (sin instrumentar). Cuenta 40P01 y concilia el libro."""
import os, sys, json, uuid, random, threading, time
import psycopg2
import run as R
N = 600; HILOS = 24
def correr(cfg):
    db = R.build(cfg); w = R.world(db); random.seed(7)
    errs = {}; lock = threading.Lock(); cola = list(range(N))
    def op(i):
        k = random.choice(['v1', 'v2', 'v2', 'c1', 'c2', 'cinv', 'aj'])
        cn = R.connect(db); cu = cn.cursor()
        try:
            if k in ('v1', 'v2'):
                keys = [random.choice(['alf', 'beb'])] if k == 'v1' else ['alf', 'beb']
                cu.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PAID', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := true)", (w['emp'], w['suc'], json.dumps([R.it(w, R.PK[x]) for x in keys])))
            elif k in ('c1', 'c2', 'cinv'):
                orden = [random.choice(['alf', 'beb'])] if k == 'c1' else (['alf', 'beb'] if k == 'c2' else ['beb', 'alf'])
                cu.execute("select _ingresar_compra_stock(%s,%s,1,'compra',%s,null,'T',%s::jsonb)", (w['emp'], w['suc'], str(uuid.uuid4()), json.dumps([{'articulo_id': str(w['art_' + x]), 'cantidad_operativa': 1, 'costo_unitario': 1} for x in orden])))
            else:
                cu.execute("select ajustar_stock(%s,%s,%s,1,'delta','ajuste',null,'t')", (w['emp'], w['suc'], w[random.choice(['alf', 'beb'])]))
            r = 'ok'
        except psycopg2.Error as e: r = e.pgcode
        finally: cn.close()
        with lock: errs[(k, r)] = errs.get((k, r), 0) + 1
    def worker():
        while True:
            with lock:
                if not cola: return
                i = cola.pop()
            op(i)
    t0 = time.time(); ts = [threading.Thread(target=worker) for _ in range(HILOS)]
    [t.start() for t in ts]; [t.join() for t in ts]
    q = R.connect(db).cursor()
    q.execute("select p.nombre, ps.cantidad, 1000 + coalesce((select sum(delta) from stock_movimientos m where m.producto_id=ps.producto_id and m.sucursal_id=ps.sucursal_id),0) from producto_stock ps join productos p on p.id=ps.producto_id where ps.sucursal_id=%s", (w['suc'],))
    conc = q.fetchall()
    dl = sum(v for (k, r), v in errs.items() if r == '40P01')
    print(f"{cfg:8} {time.time()-t0:5.1f}s  deadlocks(40P01)={dl}  otros_errores={sum(v for (k,r),v in errs.items() if r not in ('ok','40P01'))}  libro_cierra={all(a==b for _,a,b in conc)}  {conc}", flush=True)
    return dl, all(a == b for _, a, b in conc)
for cfg in os.environ.get('CFGS','live,ord+def').split(','): correr(cfg)
