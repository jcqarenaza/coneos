#!/usr/bin/env python3
"""Tiempo promedio de entrega (cierre CTO 08/11). Postgres LOCAL aislado, nunca Supabase.
Uso: python3 supabase/tests/tiempo-entrega/prueba_sql.py"""
import os, sys, uuid, threading, psycopg2, psycopg2.extras, psycopg2.errors
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.join(HERE, '..', '..')
DB = 'tiempo_entrega_t'; CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db=DB): c = psycopg2.connect(dbname=db, **CONN); c.autocommit = True; return c
a = connect('postgres'); a.cursor().execute(f'drop database if exists {DB} with (force)'); a.cursor().execute(f'create database {DB}'); a.close()
db = connect(); c = db.cursor()
# base mínima: pedidos como en producción ANTES de esta entrega (con entregado_at, sin salio_at) + roles de Supabase
c.execute("""do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
create table pedidos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null,
  estado text, colaborador_id uuid, colaborador_nombre text, entregado_at timestamptz);
create table reparto_posiciones (colaborador_id uuid primary key, empresa_id uuid, lat double precision, lng double precision, updated_at timestamptz default now());
grant select, insert, update, delete on pedidos to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;""")
SQL = open(os.path.join(SUP, 'tiempo-entrega.sql'), encoding='utf-8').read()
c.execute(SQL); c.execute(SQL)   # se aplica DOS veces: idempotente
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
E, E2, S, S2 = (uuid.uuid4() for _ in range(4)); CA, CB = uuid.uuid4(), uuid.uuid4()
def ped(emp=E, suc=S, est='DELIVERED', col=CA, nom='Ana', salio_min=None, dur_min=None, entregado_hace_min=10):
    entregado = f"now() - interval '{entregado_hace_min} minutes'" if dur_min is not None or est == 'DELIVERED' else 'null'
    salio = f"({entregado}) - interval '{dur_min} minutes'" if salio_min is None and dur_min is not None else 'null'
    c.execute(f"insert into pedidos (empresa_id,sucursal_id,estado,colaborador_id,colaborador_nombre,entregado_at,salio_at) values (%s,%s,%s,%s,%s,{entregado},{salio}) returning id", (emp, suc, est, col, nom))
    return c.fetchone()[0]
def prom(**kw):
    c.execute("select public.tiempo_promedio_entrega(%s,%s,now()-interval '30 days',now(),%s)", (kw.get('emp', E), kw.get('suc', S), kw.get('tope', 240))); return c.fetchone()[0]

# T1 estructura e idempotencia
c.execute("select count(*) from information_schema.columns where table_name='pedidos' and column_name in ('salio_at','entregado_at')"); check('T1a columnas salio_at y entregado_at', c.fetchone()[0] == 2)
c.execute("select count(*) from pg_constraint where conname='pedidos_tiempos_entrega_ck' and conrelid='public.pedidos'::regclass"); check('T1b CHECK una sola vez tras aplicar el script 2 veces', c.fetchone()[0] == 1)
c.execute("select count(*) from information_schema.columns where table_name='reparto_posiciones' and column_name in ('base_lat','base_lng')"); check('T1c columnas base_lat/base_lng del punto de partida', c.fetchone()[0] == 2)
# T2 consistencia: entregado antes de salir se rechaza
try:
    c.execute("insert into pedidos (empresa_id,sucursal_id,estado,salio_at,entregado_at) values (%s,%s,'DELIVERED',now(),now()-interval '5 minutes')", (E, S)); check('T2 entregado_at < salio_at RECHAZADO', False)
except psycopg2.errors.CheckViolation: check('T2 entregado_at < salio_at RECHAZADO', True)
# T3 promedios
ped(dur_min=10); ped(dur_min=20); ped(col=CB, nom='Beto', dur_min=30)
r = prom(); g = r['general']
check('T3a promedio general = 20 (10,20,30)', g['entregas'] == 3 and float(g['promedio_min']) == 20.0, g)
pc = {x['nombre']: x for x in r['cadetes']}
check('T3b por cadete: Ana 15 (2), Beto 30 (1)', float(pc['Ana']['promedio_min']) == 15.0 and pc['Ana']['entregas'] == 2 and float(pc['Beto']['promedio_min']) == 30.0)
# T4 exclusiones
ped(dur_min=None)                                   # DELIVERED sin salida registrada
ped(est='READY', dur_min=None); ped(est='PREPARING', dur_min=None)
ped(emp=E2, dur_min=99); ped(suc=S2, dur_min=99)    # otra empresa / otra sucursal
ped(dur_min=300)                                    # supera el tope de 240
ped(dur_min=50, entregado_hace_min=60*24*40)        # fuera del rango (40 días)
r = prom(); g = r['general']
check('T4a solo cuentan DELIVERED con salida, misma empresa/sucursal, en rango y bajo el tope', g['entregas'] == 3 and float(g['promedio_min']) == 20.0, g)
check('T4b el pedido sobre el tope se informa como descartado (1)', g['descartados_por_tope'] == 1)
# T5 vacío
r = prom(emp=uuid.uuid4()); check('T5 sin datos: 0 entregas, promedio null, cadetes []', r['general']['entregas'] == 0 and r['general']['promedio_min'] is None and r['cadetes'] == [])
# T6 "salir" idempotente y atómico: el UPDATE guardado exacto que emite la ruta, 10 hilos
pid = ped(est='READY', dur_min=None); wins = []
def salir():
    cc = connect().cursor(); cc.execute("update pedidos set salio_at = clock_timestamp() where id=%s and estado='READY' and colaborador_id=%s and salio_at is null returning salio_at", (pid, CA)); wins.append(cc.fetchone())
ts = [threading.Thread(target=salir) for _ in range(10)]; [t.start() for t in ts]; [t.join() for t in ts]
check('T6 10 pings simultáneos que detectan la salida: exactamente 1 escribe (el UPDATE guardado de la salida automática)', sum(1 for w in wins if w) == 1, f'{sum(1 for w in wins if w)}')
c.execute("select salio_at from pedidos where id=%s", (pid,)); s1 = c.fetchone()[0]
c.execute("update pedidos set salio_at = now() where id=%s and salio_at is null returning 1", (pid,)); c.execute("select salio_at from pedidos where id=%s", (pid,))
check('T6b un reintento posterior no pisa la hora original', c.fetchone()[0] == s1)
# T7 reasignación: borra la salida del cadete anterior (la sentencia exacta de asignar_cadete)
c.execute("update pedidos set salio_at=null where id=%s and salio_at is not null and (colaborador_id is null or colaborador_id <> %s) returning 1", (pid, CB)); b1 = c.fetchone()
c.execute("select salio_at from pedidos where id=%s", (pid,)); check('T7a reasignar a otro cadete borra salio_at', b1 and c.fetchone()[0] is None)
c.execute("update pedidos set colaborador_id=%s, salio_at=now() where id=%s", (CB, pid))
c.execute("update pedidos set salio_at=null where id=%s and salio_at is not null and (colaborador_id is null or colaborador_id <> %s) returning 1", (pid, CB)); same = c.fetchone()
check('T7b reasignar al MISMO cadete conserva salio_at', same is None)
# T8 permisos
c.execute("select has_function_privilege('anon','public.tiempo_promedio_entrega(uuid,uuid,timestamptz,timestamptz,integer)','execute'), has_function_privilege('authenticated','public.tiempo_promedio_entrega(uuid,uuid,timestamptz,timestamptz,integer)','execute'), has_function_privilege('service_role','public.tiempo_promedio_entrega(uuid,uuid,timestamptz,timestamptz,integer)','execute')")
x = c.fetchone(); check('T8 la función solo la ejecuta service_role', x == (False, False, True), x)
print(f'\nRESUMEN {sum(R)}/{len(R)}'); sys.exit(0 if all(R) else 1)
