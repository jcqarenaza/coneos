#!/usr/bin/env python3
"""Prueba de seguridad de arqueos en Postgres local aislado (NO Supabase).
Fases: 1) ANTES (estado vivo reproducido)  2) aplica corrección  3) DESPUÉS  4) reversión  5) huella idéntica."""
import psycopg2, psycopg2.extras, psycopg2.errors, json, uuid, os, sys, hashlib
psycopg2.extras.register_uuid()
H=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(H,'..')
DB='sec_comb'; BASE=dict(host='/tmp/pgsock',port=54329)
def conn(user='postgres',db=DB):
    c=psycopg2.connect(dbname=db,user=user,**BASE); c.autocommit=True; return c
a=conn(db='postgres'); a.cursor().execute(f'drop database if exists {DB} with (force)'); a.cursor().execute(f'create database {DB}'); a.close()
S=conn(); s=S.cursor()
for f in ['00-esquema-minimo.sql','funciones-vivas-extraidas.sql','01-triggers.sql']:
    s.execute(open(os.path.join(H,f),encoding='utf-8').read())
E1,E2,SUC1,SUC1b,SUC2,P1,P2,P2x,U1,U2,USA=[uuid.uuid4() for _ in range(11)]
s.execute("insert into empresas(id,nombre) values (%s,'VICTIMA'),(%s,'ATACANTE')",(E1,E2))
s.execute("insert into sucursales(id,empresa_id) values (%s,%s),(%s,%s),(%s,%s) on conflict do nothing",(SUC1,E1,SUC1b,E1,SUC2,E2))
s.execute("insert into productos(id,empresa_id,nombre) values (%s,%s,'Alfajor'),(%s,%s,'Gaseosa'),(%s,%s,'Prod E2')",(P1,E1,P2,E1,P2x,E2))
s.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values (%s,%s,%s,50),(%s,%s,%s,40),(%s,%s,%s,10)",(E1,P1,SUC1,E1,P2,SUC1,E2,P2x,SUC2))
s.execute("insert into usuarios_admin values (%s,%s),(%s,%s),(%s,%s)",(U1,E1,U2,E2,USA,E1))
s.execute("insert into usuario_admin_roles values (%s,'ADMIN_EMPRESA'),(%s,'ADMIN_EMPRESA'),(%s,'SUPER_ADMIN')",(U1,U2,USA))
s.execute("insert into catalogo_version(sucursal_id,empresa_id) values (%s,%s),(%s,%s),(%s,%s) on conflict do nothing",(SUC1,E1,SUC1b,E1,SUC2,E2))
def nuevo_arqueo(sucursal=SUC1):
    s.execute("delete from arqueos_stock where empresa_id=%s and estado='pendiente' and sucursal_id=%s",(E1,sucursal))
    s.execute("insert into arqueos_stock(empresa_id,sucursal_id,alcance,contado_por) values (%s,%s,'completo','Lucia') returning id",(E1,sucursal)); aid=s.fetchone()[0]
    s.execute("insert into arqueo_items(arqueo_id,producto_id,teorico,fisico) values (%s,%s,50,48),(%s,%s,40,40)",(aid,P1,aid,P2)); return aid
ARQ=nuevo_arqueo()

def sess(role,sub=None):
    """Igual que PostgREST: conecta como authenticator, SET ROLE y claims JWT."""
    c=conn('authenticator'); cu=c.cursor()
    cu.execute(f'set role {role}')
    claims={'role':role}; 
    if sub: claims['sub']=str(sub)
    cu.execute("select set_config('request.jwt.claims',%s,false)",(json.dumps(claims),)); return c,cu
def intenta(role,sub,sql,args=()):
    c,cu=sess(role,sub)
    try:
        cu.execute(sql,args); rc=cu.rowcount
        r=cu.fetchall() if cu.description else rc
        return ('ok',r)
    except psycopg2.Error as e:
        return ('err',e.pgcode,str(e).splitlines()[0])
    finally: c.close()
RES=[]
def chk(nombre,ok,det=''):
    RES.append((nombre,bool(ok),det)); print(('PASS ' if ok else 'FAIL ')+nombre+(f'  [{det}]' if det else ''),flush=True)
def bloqueado(r): return r[0]=='err' or r[1] in (0,[])
def ver(sql,args=()):
    s.execute(sql,args); return s.fetchall()

def ataques(fase):
    # fase 'antes': deben PROSPERAR (agujero reproducido). fase 'despues': deben quedar BLOQUEADOS.
    esp_abierto = (fase=='antes')
    def evalua(nombre,r,exito):  # exito(r)=True si el ataque tuvo efecto
        tuvo=exito(r); chk(f'[{fase}] {nombre}: '+('ataque prospera' if esp_abierto else 'ataque bloqueado'), tuvo==esp_abierto, str(r)[:110])
    aid=nuevo_arqueo()
    evalua('A1 anon LEE arqueos de otra empresa', intenta('anon',None,'select id from arqueos_stock'), lambda r:r[0]=='ok' and len(r[1])>0)
    evalua('A2 anon LEE items (producto/teórico/físico) ajenos', intenta('anon',None,'select fisico from arqueo_items'), lambda r:r[0]=='ok' and len(r[1])>0)
    evalua('A3 anon MODIFICA fisico de un arqueo pendiente ajeno', intenta('anon',None,'update arqueo_items set fisico=5000 where arqueo_id=%s',(aid,)), lambda r:r[0]=='ok' and r[1]>0)
    evalua('A4 anon INSERTA arqueo para empresa ajena (bloquea el real por índice único)', intenta('anon',None,"insert into arqueos_stock(empresa_id,sucursal_id,alcance) values (%s,%s,'completo')",(E1,SUC1b)), lambda r:r[0]=='ok')
    evalua('A5 anon BORRA arqueos ajenos', intenta('anon',None,'delete from arqueos_stock where id=%s',(aid,)), lambda r:r[0]=='ok' and r[1]>0)
    aid=nuevo_arqueo()
    evalua('A6 admin de E2 LEE arqueos de E1', intenta('authenticated',U2,'select id from arqueos_stock where empresa_id=%s',(E1,)), lambda r:r[0]=='ok' and len(r[1])>0)
    evalua('A7 admin de E2 MODIFICA arqueo de E1', intenta('authenticated',U2,"update arqueos_stock set estado='descartado' where id=%s",(aid,)), lambda r:r[0]=='ok' and r[1]>0)
    evalua('A8 admin de E2 BORRA items de E1', intenta('authenticated',U2,'delete from arqueo_items where arqueo_id=%s',(aid,)), lambda r:r[0]=='ok' and r[1]>0)
    aid=nuevo_arqueo()
    evalua('A9 authenticated cualquiera invoca bump_catalogo_empresa(E1)', intenta('authenticated',U2,'select bump_catalogo_empresa(%s)',(E1,)), lambda r:r[0]=='ok')
    evalua('A10 authenticated invoca bump_catalogo_sucursal con ids inventados', intenta('authenticated',U2,'select bump_catalogo_sucursal(%s,%s)',(uuid.uuid4(),E1)), lambda r:r[0]=='ok')
    # impacto de punta a punta: A3 + confirmación legítima del admin de E1
    aid=nuevo_arqueo()
    intenta('anon',None,'update arqueo_items set fisico=5000 where arqueo_id=%s and producto_id=%s',(aid,P1))
    r=intenta('authenticated',U1,'select confirmar_arqueo_stock(%s,%s,%s)',(E1,aid,'admin'))
    stock=ver('select cantidad from producto_stock where producto_id=%s and sucursal_id=%s',(P1,SUC1))[0][0]
    chk(f'[{fase}] A11 IMPACTO: stock de Alfajor tras confirmar un arqueo adulterado por anon (legítimo daría 48)', (stock>1000)==esp_abierto, f'stock={stock}')
    s.execute('update producto_stock set cantidad=50 where producto_id=%s and sucursal_id=%s',(P1,SUC1))

def controles():
    # Estas defensas ya existen: deben mantenerse en ambas fases
    aid=nuevo_arqueo()
    r=intenta('authenticated',U2,'select ajustar_stock(%s,%s,%s,10,%s,%s)',(E1,SUC1,P1,'delta','ajuste')); chk('C1 admin E2 → ajustar_stock(E1): FORBIDDEN', r[0]=='err' and r[1]=='42501', str(r)[:90])
    r=intenta('authenticated',U2,'select confirmar_arqueo_stock(%s,%s,%s)',(E1,aid,'x')); chk('C2 admin E2 → confirmar_arqueo_stock(E1): FORBIDDEN', r[0]=='err' and r[1]=='42501', str(r)[:90])
    r=intenta('anon',None,'select ajustar_stock(%s,%s,%s,10)',(E1,SUC1,P1)); chk('C3 anon → ajustar_stock: sin permiso de ejecución', r[0]=='err' and r[1]=='42501', str(r)[:90])
    r=intenta('anon',None,'select confirmar_arqueo_stock(%s,%s,%s)',(E1,aid,'x')); chk('C4 anon → confirmar_arqueo_stock: sin permiso', r[0]=='err' and r[1]=='42501', str(r)[:90])
    r=intenta('authenticated',U1,"select crear_arqueo_stock(%s,%s,'completo','x','',%s::jsonb)",(E1,SUC1b,json.dumps([{'producto_id':str(P1),'fisico':3}]))); chk('C5 authenticated → crear_arqueo_stock: sin permiso (solo service_role)', r[0]=='err' and r[1]=='42501', str(r)[:90])
    r=intenta('anon',None,'select * from producto_stock'); chk('C6 anon no lee producto_stock (RLS)', r[0]=='ok' and r[1]==[], str(r)[:60])
    r=intenta('anon',None,'select * from stock_movimientos'); chk('C7 anon no lee stock_movimientos (RLS sin policy)', r[0]=='ok' and r[1]==[], str(r)[:60])

def legitimo(fase):
    # Flujos legítimos: deben andar SIEMPRE (salvo el alta por navegador, que es la dependencia de la parte B)
    aid=nuevo_arqueo()
    r=intenta('authenticated',U1,'select a.id, (select count(*) from arqueo_items i where i.arqueo_id=a.id) from arqueos_stock a where a.id=%s',(aid,)); chk(f'[{fase}] L1 admin E1 lista sus arqueos con ítems', r[0]=='ok' and len(r[1])>=1 and r[1][0][1]==2, str(r)[:80])
    r=intenta('authenticated',U1,'update arqueo_items set descartado=true where arqueo_id=%s and producto_id=%s',(aid,P2)); chk(f'[{fase}] L2 admin E1 descarta un ítem', r[0]=='ok' and r[1]==1, str(r))
    r=intenta('authenticated',U1,'select confirmar_arqueo_stock(%s,%s,%s)',(E1,aid,'Juan')); st=ver('select estado from arqueos_stock where id=%s',(aid,))[0][0]
    chk(f'[{fase}] L3 admin E1 confirma por RPC (ajusta stock y cierra)', r[0]=='ok' and st=='confirmado', f'estado={st}')
    s.execute('update producto_stock set cantidad=50 where producto_id=%s and sucursal_id=%s',(P1,SUC1))
    aid=nuevo_arqueo()
    # camino de arqueo-servidor/confirmación por cliente: ajustar_stock + marcas por tabla
    r1=intenta('authenticated',U1,'select ajustar_stock(%s,%s,%s,-2,%s,%s)',(E1,SUC1,P1,'delta','arqueo'))
    r2=intenta('authenticated',U1,'update arqueo_items set ajustado=true where arqueo_id=%s and producto_id=%s',(aid,P1))
    r3=intenta('authenticated',U1,"update arqueos_stock set estado='confirmado', confirmado_por='x', confirmado_at=now() where id=%s",(aid,))
    chk(f'[{fase}] L4 confirmación del cliente (ajustar_stock + marcar + cerrar)', r1[0]=='ok' and r2[0]=='ok' and r2[1]==1 and r3[0]=='ok' and r3[1]==1, f'{r1[0]},{r2},{r3}')
    s.execute('update producto_stock set cantidad=50 where producto_id=%s and sucursal_id=%s',(P1,SUC1))
    r=intenta('authenticated',USA,'select id from arqueos_stock'); chk(f'[{fase}] L5 SUPER_ADMIN ve arqueos', r[0]=='ok' and len(r[1])>=1, str(r)[:60])
    # servidor (service_role): lo que hace /api/operacion/arqueo
    s.execute("delete from arqueos_stock where empresa_id=%s and estado='pendiente'",(E1,))
    r=intenta('service_role',None,"select crear_arqueo_stock(%s,%s,'completo','Lucia','',%s::jsonb)",(E1,SUC1,json.dumps([{'producto_id':str(P1),'fisico':47}]))); chk(f'[{fase}] L6 service_role crea arqueo por RPC', r[0]=='ok', str(r)[:90])
    c,cu=sess('service_role')
    try:
        cu.execute("delete from arqueos_stock where empresa_id=%s",(E1,))
        cu.execute("insert into arqueos_stock(empresa_id,sucursal_id,alcance) values (%s,%s,'completo') returning id",(E1,SUC1)); x=cu.fetchone()[0]
        cu.execute("insert into arqueo_items(arqueo_id,producto_id,teorico,fisico) values (%s,%s,1,1)",(x,P1)); ok=True
    except psycopg2.Error as e: ok=False
    c.close(); chk(f'[{fase}] L7 service_role inserta/borra directo (ruta del servidor)', ok)
    # edición de catálogo por admin autenticado (dispara trigger bump) y ajuste directo de producto_stock
    v0=ver('select version from catalogo_version where sucursal_id=%s',(SUC1,))[0][0]
    r=intenta('authenticated',U1,"insert into presentaciones(empresa_id,nombre,precio) values (%s,'Caja x8',100)",(E1,)); v1=ver('select version from catalogo_version where sucursal_id=%s',(SUC1,))[0][0]
    chk(f'[{fase}] L8 admin E1 edita catálogo (trigger bump funciona)', r[0]=='ok' and v1>v0, f'{v0}->{v1}')
    r=intenta('authenticated',U1,'update producto_stock set cantidad=cantidad+1 where producto_id=%s and sucursal_id=%s',(P1,SUC1)); chk(f'[{fase}] L9 admin E1 edita stock por cliente (trigger bump)', r[0]=='ok' and r[1]==1, str(r))
    s.execute('update producto_stock set cantidad=50 where producto_id=%s and sucursal_id=%s',(P1,SUC1))
    r=intenta('service_role',None,'select bump_catalogo_empresa(%s)',(E1,)); chk(f'[{fase}] L10 service_role conserva bump_catalogo_empresa', r[0]=='ok', str(r)[:60])

HUELLA_SQL="""
select 'policy|'||tablename||'|'||policyname||'|'||cmd||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname='public' and tablename in ('arqueos_stock','arqueo_items')
union all select 'tabla|'||t||'|'||r||'|'||p||'|'||has_table_privilege(r,'public.'||t,p)::text
  from unnest(array['arqueos_stock','arqueo_items']) t, unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
union all select 'col|'||t||'|'||c||'|'||r||'|'||has_column_privilege(r,'public.'||t,c,'UPDATE')::text
  from (values ('arqueos_stock','fisico'),('arqueos_stock','estado'),('arqueos_stock','empresa_id'),('arqueo_items','fisico'),('arqueo_items','descartado'),('arqueo_items','ajustado')) v(t,c), unnest(array['anon','authenticated']) r
  where exists (select 1 from information_schema.columns k where k.table_name=v.t and k.column_name=v.c)
union all select 'fn|'||f||'|'||r||'|'||has_function_privilege(r,f,'EXECUTE')::text||'|secdef='||(select prosecdef::text from pg_proc where oid=f::regprocedure)
  from unnest(array['bump_catalogo_empresa(uuid)','bump_catalogo_sucursal(uuid,uuid)','trg_bump_catalogo()','ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text)','confirmar_arqueo_stock(uuid,uuid,text)','crear_arqueo_stock(uuid,uuid,text,text,text,jsonb)']) f, unnest(array['anon','authenticated','service_role']) r
order by 1"""
def huella():
    s.execute(HUELLA_SQL); rows=[x[0] for x in s.fetchall()]; return rows
def sql_file(n): s.execute(open(os.path.join(OUT,n),encoding='utf-8').read())

print('══ FASE 1: ANTES (estado vivo reproducido) ══'); H0=huella(); ataques('antes'); controles(); legitimo('antes')
print('══ FASE 2: aplica corrección (A y B) ══'); sql_file('arqueos-seguridad-correccion.sql'); H1=huella()
print('══ FASE 3: DESPUÉS ══'); ataques('despues'); controles(); legitimo('despues')
print('══ FASE 4: reversión ══'); sql_file('arqueos-seguridad-REVERSION.sql'); H2=huella()
chk('R1 la huella cambió con la corrección (policies/grants/ACL)', H0!=H1, f'{len(set(H0)^set(H1))} líneas distintas')
dif=sorted(set(H0)^set(H2)); chk('R2 tras la reversión la huella es IDÉNTICA al estado inicial', not dif, str(dif[:4]))
ataques_rev=intenta('anon',None,'select id from arqueos_stock'); chk('R3 tras reversión el agujero vuelve (esperado: es una reversión)', ataques_rev[0]=='ok')
print('══ FASE 5: reaplicación (idempotencia de la corrección sobre estado revertido) ══'); sql_file('arqueos-seguridad-correccion.sql'); H3=huella()
chk('R4 reaplicar da la misma huella que la primera aplicación', H3==H1)
print(f"\nRESUMEN: {sum(1 for _,o,_ in RES if o)}/{len(RES)} PASS")
open(os.path.join(H,'huella-antes.txt'),'w').write('\n'.join(H0)); open(os.path.join(H,'huella-despues.txt'),'w').write('\n'.join(H1))
sys.exit(0 if all(o for _,o,_ in RES) else 1)
