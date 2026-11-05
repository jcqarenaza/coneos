#!/usr/bin/env python3
"""Compras: venta contra compra/ajuste. Postgres LOCAL aislado. Uso: run.py  (corre las 4 configuraciones)"""
import os, re, sys, json, uuid, threading, time
import psycopg2, psycopg2.extras
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__))
SUP = os.path.abspath(os.path.join(HERE, '..', '..'))  # carpeta supabase/
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db, ac=True):
    c = psycopg2.connect(dbname=db, **CONN); c.autocommit = ac; return c
LIVE_FN = re.search(r"CREATE OR REPLACE FUNCTION public\._ingresar_compra_stock.*?\$function\$;", open(os.path.join(HERE, '_ingresar_compra_stock.vivo.sql'), encoding='utf-8').read(), re.S).group(0)
ORD_FN = re.search(r"CREATE OR REPLACE FUNCTION public\._ingresar_compra_stock.*?\$function\$;", open(os.path.join(SUP, 'compras-ingresar-stock-orden.sql'), encoding='utf-8').read(), re.S).group(0)
def slow(fn):
    assert fn.count('v_movs := v_movs + 1;') == 1
    return fn.replace('v_movs := v_movs + 1;', 'v_movs := v_movs + 1; perform pg_sleep(0.3);')
EXTRA = """
create table articulos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, producto_id uuid, nombre text not null,
  controla_stock boolean not null default true, activo boolean not null default true, deleted_at timestamptz);
create table articulo_stock (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, articulo_id uuid not null references articulos(id),
  sucursal_id uuid not null, cantidad numeric not null default 0 check (cantidad >= 0), stock_minimo numeric not null default 0, updated_at timestamptz default now(),
  unique (articulo_id, sucursal_id));
"""
SCHEMA = open(os.path.join(HERE, '00-schema-reducido.sql'), encoding='utf-8').read()
AJ = re.search(r"CREATE OR REPLACE FUNCTION public\.ajustar_stock.*?\$function\$;", SCHEMA, re.S).group(0)
AJ_LENTO = AJ.replace('public.ajustar_stock', 'public.ajustar_lento').replace("    for update;\n", "    for update;\n  perform pg_sleep(0.3);\n"); assert AJ_LENTO != AJ
def build(cfg):
    db = 'cmp_' + cfg.replace('+', '_')
    a = connect('postgres'); a.cursor().execute(f'drop database if exists {db} with (force)'); a.cursor().execute(f'create database {db}'); a.close()
    c = connect(db).cursor()
    c.execute(SCHEMA); c.execute(EXTRA)
    c.execute(open(os.path.join(HERE, 'crear_pedido_stock.vivo.sql'), encoding='utf-8').read())  # la venta VIVA (no se modifica)
    ordenado = 'ord' in cfg; diferido = 'def' in cfg
    c.execute((ORD_FN if ordenado else LIVE_FN)); c.execute(AJ_LENTO)
    # variante lenta con otro nombre (se usa en los escenarios; la real queda instalada para el diferencial)
    base = ORD_FN if ordenado else LIVE_FN
    c.execute(slow(base).replace('_ingresar_compra_stock', '_ingresar_lento'))
    if diferido:
        c.execute(open(os.path.join(SUP, 'stock-bump-diferido.sql'), encoding='utf-8').read())
    if os.environ.get('COMB_A'): c.execute(open(os.path.join(HERE, 'parteA.sql'), encoding='utf-8').read())
    return db
PREC = {'p1': 1000, 'lata': 500}
def world(db):
    q = connect(db).cursor(); w = {}
    def one(sql, *a): q.execute(sql, a); return q.fetchone()[0]
    w['emp'] = one("insert into empresas default values returning id"); w['suc'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    q.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s)", (w['suc'], w['emp']))
    for k, nom in (('alf', 'Alfajor'), ('beb', 'Bebida')):
        w[k] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,%s,true) returning id", w['emp'], nom)
        q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,1000)", (w['emp'], w[k], w['suc']))
        w['art_' + k] = one("insert into articulos(empresa_id,producto_id,nombre) values(%s,%s,%s) returning id", w['emp'], w[k], 'Art ' + nom)
    w['p1'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Porción',1000,1) returning id", w['emp'], w['alf'])
    w['lata'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Lata',500,1) returning id", w['emp'], w['beb'])
    ids = sorted([('alf', w['alf']), ('beb', w['beb'])], key=lambda t: str(t[1])); w['lo'], w['hi'] = ids[0][0], ids[1][0]
    return w
def it(w, key): return {'presentacion_id': str(w[key]), 'cantidad': 1, 'precio_snap': PREC[key], 'nombre_producto_snap': key, 'nombre_presentacion_snap': key, 'opciones': []}
PK = {'alf': 'p1', 'beb': 'lata'}
def venta(db, w, keys):
    cn = connect(db)
    try:
        cn.cursor().execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PAID', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := true)", (w['emp'], w['suc'], json.dumps([it(w, PK[k]) for k in keys])))
        return 'ok'
    except psycopg2.Error as e: return e.pgcode
    finally: cn.close()
def compra(db, w, orden):
    cn = connect(db)
    lineas = [{'articulo_id': str(w['art_' + k]), 'cantidad_operativa': 1, 'costo_unitario': 1} for k in orden]
    try:
        cn.cursor().execute("select _ingresar_lento(%s,%s,1,'compra',%s,null,'T',%s::jsonb)", (w['emp'], w['suc'], str(uuid.uuid4()), json.dumps(lineas))); return 'ok'
    except psycopg2.Error as e: return e.pgcode
    finally: cn.close()
def ajuste(db, w, k):
    cn = connect(db)
    try:
        cn.cursor().execute("select ajustar_lento(%s,%s,%s,1,'delta','ajuste',null,'t')", (w['emp'], w['suc'], w[k])); return 'ok'
    except psycopg2.Error as e: return e.pgcode
    finally: cn.close()
def par(db, escritor, vkeys):
    w = world(db); res = {}
    t = threading.Thread(target=lambda: res.__setitem__('escritor', escritor(db, w))); t.start(); time.sleep(0.1)
    res['venta'] = venta(db, w, vkeys(w)); t.join(); return res
ESC = {
 'S_a  compra [hi,lo] (orden inverso) vs venta {lo,hi}': (lambda db, w: compra(db, w, [w['hi'], w['lo']]), lambda w: [w['lo'], w['hi']]),
 'S_b  compra [lo,hi] vs venta {hi}':                      (lambda db, w: compra(db, w, [w['lo'], w['hi']]), lambda w: [w['hi']]),
 'S_c  compra [lo,hi] vs venta {lo,hi} (control)':         (lambda db, w: compra(db, w, [w['lo'], w['hi']]), lambda w: [w['lo'], w['hi']]),
 'S_aj ajustar_stock(hi) vs venta {lo,hi}':                (lambda db, w: ajuste(db, w, w['hi']), lambda w: [w['lo'], w['hi']]),
}
if __name__ == '__main__':
    tabla = {}
    for cfg in (os.environ.get('CFGS','live,ord,def,ord+def').split(',')):
        db = build(cfg)
        for nom, (esc, vk) in ESC.items():
            r = par(db, esc, vk); ok = r['escritor'] == 'ok' and r['venta'] == 'ok'
            tabla[(nom, cfg)] = (ok, r); print(f"{cfg:8} {'PASS' if ok else 'FAIL'}  {nom}  {r}", flush=True)
