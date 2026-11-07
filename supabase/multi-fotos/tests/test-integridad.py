#!/usr/bin/env python3
"""Pruebas de integridad/seguridad de multi-fotos en PostgreSQL aislado.
Uso: python3 test-integridad.py   (requiere DB 'mf' con 00-base-sintetica.sql + 01 aplicados)"""
import psycopg2, threading, sys, uuid
DSN = "host=/tmp port=54399 user=postgres dbname=mf"
A, B = 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'
UA, UB = 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'
P1, P2, P3 = ['10000000-0000-0000-0000-00000000000%d' % i for i in (1, 2, 3)]
PB1 = '20000000-0000-0000-0000-000000000001'
R1, R2, R3 = ['30000000-0000-0000-0000-00000000000%d' % i for i in (1, 2, 3)]
RB = '30000000-0000-0000-0000-000000000004'
URL = lambda n: f'https://x.supabase.co/storage/v1/object/public/productos/{n}.jpg'
res = []

def con(user=None, role='authenticated'):
    c = psycopg2.connect(DSN); c.autocommit = True; cur = c.cursor()
    if user:
        cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user,)); cur.execute(f"set role {role}")
    elif role:
        cur.execute(f"set role {role}")
    return c, cur

def reset():
    c, cur = con(None, None)
    cur.execute("truncate producto_imagenes")
    cur.execute("insert into productos(id,empresa_id,categoria_id,nombre) values (%s,%s,'c0000000-0000-0000-0000-00000000000a','P1 con foto') on conflict do nothing", (P1, A))
    cur.execute("insert into presentaciones(id,producto_id,empresa_id,nombre) values (%s,%s,%s,'P1-roja'),(%s,%s,%s,'P1-azul') on conflict do nothing", (R1, P1, A, R2, P1, A))
    cur.execute("update productos set imagen_url=null where id in (%s,%s,%s,%s)", (P1, P2, P3, PB1))
    cur.execute("update presentaciones set imagen_url=null")
    c.close()

def fails(cur, sql, args=(), contiene=None):
    try:
        cur.execute(sql, args)
    except psycopg2.Error as e:
        return contiene is None or contiene in str(e)
    return False

def t(nombre):
    def deco(f):
        try:
            reset(); f(); res.append((nombre, True, ''))
        except AssertionError as e:
            res.append((nombre, False, str(e)))
        except Exception as e:
            res.append((nombre, False, 'EXC ' + repr(e)))
        return f
    return deco

def ins(cur, prod, url, pres=None, emp=A, principal=False, orden=0):
    cur.execute("insert into producto_imagenes(empresa_id,producto_id,presentacion_id,url,orden,es_principal) values (%s,%s,%s,%s,%s,%s) returning id",
                (emp, prod, pres, url, orden, principal))
    return cur.fetchone()[0]

def one(cur, sql, args=()):
    cur.execute(sql, args); r = cur.fetchone(); return r[0] if r else None

@t("T01 primera foto del producto queda principal y sincroniza imagen_url")
def _():
    c, cur = con(UA); i = ins(cur, P1, URL('a'))
    assert one(cur, "select es_principal from producto_imagenes where id=%s", (i,)) is True
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('a')

@t("T02 segunda foto NO es principal; imagen_url no cambia")
def _():
    c, cur = con(UA); ins(cur, P1, URL('a')); i2 = ins(cur, P1, URL('b'), orden=1)
    assert one(cur, "select es_principal from producto_imagenes where id=%s", (i2,)) is False
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('a')

@t("T03 insertar con es_principal=true reemplaza a la anterior (una sola)")
def _():
    c, cur = con(UA); ins(cur, P1, URL('a')); ins(cur, P1, URL('b'), principal=True, orden=1)
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s and es_principal", (P1,)) == 1
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('b')

@t("T04 UPDATE es_principal=true mueve la principal atómicamente y sincroniza")
def _():
    c, cur = con(UA); ins(cur, P1, URL('a')); i2 = ins(cur, P1, URL('b'), orden=1)
    cur.execute("update producto_imagenes set es_principal=true where id=%s", (i2,))
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s and es_principal", (P1,)) == 1
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('b')

@t("T05 quitar es_principal sin asignar otra → IMAGEN_PRINCIPAL_REQUERIDA")
def _():
    c, cur = con(UA); i = ins(cur, P1, URL('a'))
    assert fails(cur, "update producto_imagenes set es_principal=false where id=%s", (i,), 'IMAGEN_PRINCIPAL_REQUERIDA')

@t("T06 borrar la principal promueve la siguiente por orden y sincroniza")
def _():
    c, cur = con(UA); i1 = ins(cur, P1, URL('a')); ins(cur, P1, URL('c'), orden=2); i3 = ins(cur, P1, URL('b'), orden=1)
    cur.execute("delete from producto_imagenes where id=%s", (i1,))
    assert one(cur, "select url from producto_imagenes where producto_id=%s and es_principal", (P1,)) == URL('b')
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('b')

@t("T07 borrar la última foto deja imagen_url en NULL")
def _():
    c, cur = con(UA); i = ins(cur, P1, URL('a')); cur.execute("delete from producto_imagenes where id=%s", (i,))
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) is None

@t("T08 límite 10 por producto (la 11ª falla LIMITE_IMAGENES)")
def _():
    c, cur = con(UA)
    for n in range(10): ins(cur, P1, URL(n), orden=n)
    assert fails(cur, "insert into producto_imagenes(empresa_id,producto_id,url) values (%s,%s,%s)", (A, P1, URL('x')), 'LIMITE_IMAGENES')
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s", (P1,)) == 10

@t("T09 límite independiente: producto 10 + cada presentación 10")
def _():
    c, cur = con(UA)
    for n in range(10): ins(cur, P1, URL(n), orden=n)
    for n in range(10): ins(cur, P1, URL('r%d' % n), pres=R1, orden=n)
    for n in range(10): ins(cur, P1, URL('s%d' % n), pres=R2, orden=n)
    assert fails(cur, "insert into producto_imagenes(empresa_id,producto_id,presentacion_id,url) values (%s,%s,%s,%s)", (A, P1, R1, URL('z')), 'LIMITE_IMAGENES')
    assert one(cur, "select count(*) from producto_imagenes") == 30

@t("T10 presentación: principal propia sincroniza presentaciones.imagen_url (no toca la del producto)")
def _():
    c, cur = con(UA); ins(cur, P1, URL('p')); ins(cur, P1, URL('r'), pres=R1)
    assert one(cur, "select imagen_url from presentaciones where id=%s", (R1,)) == URL('r')
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('p')
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s and es_principal", (P1,)) == 2   # una por ámbito

@t("T11 presentación sin fotos propias: imagen_url NULL (la herencia es de lectura)")
def _():
    c, cur = con(UA); ins(cur, P1, URL('p'))
    assert one(cur, "select imagen_url from presentaciones where id=%s", (R2,)) is None

@t("T12 aislamiento: admin de B no puede insertar sobre producto de A (RLS)")
def _():
    c, cur = con(UB)
    assert fails(cur, "insert into producto_imagenes(empresa_id,producto_id,url) values (%s,%s,%s)", (A, P1, URL('x')))
    assert fails(cur, "insert into producto_imagenes(empresa_id,producto_id,url) values (%s,%s,%s)", (B, P1, URL('x')))  # FK compuesta

@t("T13 aislamiento: admin de B no ve, no edita y no borra fotos de A")
def _():
    c, cur = con(UA); i = ins(cur, P1, URL('a'))
    c2, cb = con(UB)
    assert one(cb, "select count(*) from producto_imagenes") == 0
    cb.execute("update producto_imagenes set orden=9 where id=%s", (i,)); assert cb.rowcount == 0
    cb.execute("delete from producto_imagenes where id=%s", (i,)); assert cb.rowcount == 0
    assert one(cur, "select count(*) from producto_imagenes") == 1

@t("T14 presentación de OTRO producto → PRESENTACION_INVALIDA")
def _():
    c, cur = con(UA)
    assert fails(cur, "insert into producto_imagenes(empresa_id,producto_id,presentacion_id,url) values (%s,%s,%s,%s)", (A, P2, R1, URL('x')), 'PRESENTACION_INVALIDA')

@t("T15 presentación de otra EMPRESA → PRESENTACION_INVALIDA / FK")
def _():
    c, cur = con(UA)
    assert fails(cur, "insert into producto_imagenes(empresa_id,producto_id,presentacion_id,url) values (%s,%s,%s,%s)", (A, P1, RB, URL('x')))

@t("T16 propiedad inmutable: no se puede mover una foto de producto/presentación/empresa")
def _():
    c, cur = con(UA); i = ins(cur, P1, URL('a'))
    assert fails(cur, "update producto_imagenes set producto_id=%s where id=%s", (P2, i))
    assert fails(cur, "update producto_imagenes set presentacion_id=%s where id=%s", (R1, i), 'IMAGEN_PROPIEDAD_INMUTABLE')
    assert fails(cur, "update producto_imagenes set empresa_id=%s where id=%s", (B, i))

@t("T17 url inválida (no http/https, vacía, >2048) rechazada")
def _():
    c, cur = con(UA)
    for bad in ('javascript:alert(1)', '', 'ftp://x/y.jpg', 'https://' + 'a' * 2100):
        assert fails(cur, "insert into producto_imagenes(empresa_id,producto_id,url) values (%s,%s,%s)", (A, P1, bad)), bad[:20]

@t("T18 anon: sin acceso a la tabla ni a las RPC")
def _():
    c, cur = con(None, 'anon')
    assert fails(cur, "select * from producto_imagenes", (), 'permission denied')
    assert fails(cur, "select set_imagen_principal(%s)", (str(uuid.uuid4()),), 'permission denied')
    assert fails(cur, "select reordenar_imagenes(%s,null,%s)", (P1, []), 'permission denied')

@t("T19 authenticated sin permiso de TRUNCATE")
def _():
    c, cur = con(UA); assert fails(cur, "truncate producto_imagenes", (), 'permission denied')

@t("T20 funciones de trigger no ejecutables por anon/authenticated/public")
def _():
    c, cur = con(None, None)
    for f in ('fn_producto_imagenes_validar()', 'fn_producto_imagenes_promover()', 'fn_producto_imagenes_sync()'):
        for r in ('anon', 'authenticated'):
            assert one(cur, f"select has_function_privilege('{r}', 'public.{f}', 'execute')") is False, (f, r)

@t("T21 RPC set_imagen_principal: propia ok, ajena → IMAGEN_NO_ENCONTRADA")
def _():
    c, cur = con(UA); ins(cur, P1, URL('a')); i2 = ins(cur, P1, URL('b'), orden=1)
    cur.execute("select set_imagen_principal(%s)", (i2,))
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('b')
    c2, cb = con(UB); assert fails(cb, "select set_imagen_principal(%s)", (i2,), 'IMAGEN_NO_ENCONTRADA')

@t("T22 RPC reordenar_imagenes: orden nuevo ok; ids incompletos/ajenos → ORDEN_INVALIDO")
def _():
    c, cur = con(UA); a = ins(cur, P1, URL('a'), orden=0); b = ins(cur, P1, URL('b'), orden=1); d = ins(cur, P1, URL('c'), orden=2)
    cur.execute("select reordenar_imagenes(%s,null,%s::uuid[])", (P1, [d, a, b]))
    cur.execute("select id from producto_imagenes where producto_id=%s order by orden", (P1,)); assert [r[0] for r in cur.fetchall()] == [d, a, b]
    assert fails(cur, "select reordenar_imagenes(%s,null,%s::uuid[])", (P1, [a, b]), 'ORDEN_INVALIDO')
    assert fails(cur, "select reordenar_imagenes(%s,null,%s::uuid[])", (P1, [a, b, str(uuid.uuid4())]), 'ORDEN_INVALIDO')
    c2, cb = con(UB); assert fails(cb, "select reordenar_imagenes(%s,null,%s::uuid[])", (P1, [a, b, d]), 'ORDEN_INVALIDO')

@t("T23 borrar producto: cascada limpia sus fotos y las de sus presentaciones, sin error")
def _():
    c, cur = con(UA); ins(cur, P1, URL('a')); ins(cur, P1, URL('r'), pres=R1); ins(cur, P1, URL('r2'), pres=R1, orden=1)
    cur.execute("delete from productos where id=%s", (P1,))
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s", (P1,)) == 0

@t("T24 borrar presentación: cascada limpia solo sus fotos; el producto conserva las suyas")
def _():
    c, cur = con(UA); ins(cur, P1, URL('a')); ins(cur, P1, URL('r'), pres=R1)
    cur.execute("delete from presentaciones where id=%s", (R1,))
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s", (P1,)) == 1
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('a')

@t("T25 catálogo se refresca (catalogo_version) al agregar/quitar/cambiar fotos")
def _():
    c, cur = con(None, None); v0 = one(cur, "select sum(version) from catalogo_version where empresa_id=%s", (A,)) or 0
    c2, cu = con(UA); ins(cu, P1, URL('a')); ins(cu, P1, URL('b'), orden=1)
    v1 = one(cur, "select sum(version) from catalogo_version where empresa_id=%s", (A,)); assert v1 > v0
    cu.execute("update producto_imagenes set orden=5 where producto_id=%s and url=%s", (P1, URL('b')))
    assert one(cur, "select sum(version) from catalogo_version where empresa_id=%s", (A,)) > v1

@t("T26 agregar una foto extra NO toca productos (sin updates innecesarios)")
def _():
    c, cur = con(UA); ins(cur, P1, URL('a'))
    c0, cs = con(None, None)
    xmin0 = one(cs, "select xmin::text from productos where id=%s", (P1,))
    ins(cur, P1, URL('b'), orden=1)
    assert one(cs, "select xmin::text from productos where id=%s", (P1,)) == xmin0

@t("T27 CONCURRENCIA: 12 altas simultáneas al mismo producto → exactamente 10 y una principal")
def _():
    errs, oks = [], []
    def w(n):
        c, cur = con(UA)
        try: ins(cur, P1, URL('c%d' % n), orden=n); oks.append(n)
        except psycopg2.Error as e: errs.append(str(e))
    th = [threading.Thread(target=w, args=(n,)) for n in range(12)]; [x.start() for x in th]; [x.join() for x in th]
    c, cur = con(None, None)
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s", (P1,)) == 10, (len(oks), errs[:2])
    assert len(errs) == 2 and all('LIMITE_IMAGENES' in e for e in errs)
    assert one(cur, "select count(*) from producto_imagenes where producto_id=%s and es_principal", (P1,)) == 1

@t("T28 CONCURRENCIA: cambios de principal simultáneos → siempre exactamente una")
def _():
    c, cur = con(UA); ids = [ins(cur, P1, URL(n), orden=n) for n in range(6)]
    def w(i):
        c, cu = con(UA)
        try: cu.execute("select set_imagen_principal(%s)", (i,))
        except psycopg2.Error: pass
    th = [threading.Thread(target=w, args=(i,)) for i in ids * 3]; [x.start() for x in th]; [x.join() for x in th]
    c, cs = con(None, None)
    assert one(cs, "select count(*) from producto_imagenes where producto_id=%s and es_principal", (P1,)) == 1
    assert one(cs, "select imagen_url from productos where id=%s", (P1,)) == one(cs, "select url from producto_imagenes where producto_id=%s and es_principal", (P1,))

@t("T29 CONCURRENCIA/DEADLOCK: fotos + ediciones del producto + bumps en paralelo, sin deadlock")
def _():
    errs = []
    def fotos(k):
        c, cu = con(UA)
        for n in range(8):
            try: ins(cu, P1, URL('d%d_%d' % (k, n)), orden=n)
            except psycopg2.Error as e:
                if 'LIMITE' not in str(e): errs.append(str(e))
            try: cu.execute("delete from producto_imagenes where id=(select id from producto_imagenes where producto_id=%s order by random() limit 1)", (P1,))
            except psycopg2.Error as e: errs.append(str(e))
    def edita(k):
        c, cu = con(UA)
        for n in range(30):
            try: cu.execute("update productos set nombre=%s where id=%s", ('n%d' % n, P1))
            except psycopg2.Error as e: errs.append(str(e))
    def pres(k):
        c, cu = con(UA)
        for n in range(30):
            try: cu.execute("update presentaciones set nombre=%s where id=%s", ('r%d' % n, R1))
            except psycopg2.Error as e: errs.append(str(e))
    th = [threading.Thread(target=f, args=(k,)) for k in range(3) for f in (fotos, edita, pres)]
    [x.start() for x in th]; [x.join() for x in th]
    assert not [e for e in errs if 'deadlock' in e.lower()], errs[:2]
    assert not errs, errs[:3]
    c, cs = con(None, None)
    n = one(cs, "select count(*) from producto_imagenes where producto_id=%s", (P1,))
    assert n <= 10 and (n == 0 or one(cs, "select count(*) from producto_imagenes where producto_id=%s and es_principal", (P1,)) == 1)

@t("T30 service_role (bypassrls) opera igual: reglas y sync valen también desde la API")
def _():
    c, cur = con(None, 'service_role'); ins(cur, P1, URL('a')); ins(cur, P1, URL('b'), orden=1)
    assert one(cur, "select imagen_url from productos where id=%s", (P1,)) == URL('a')

print()
ok = sum(1 for _, o, _ in res if o)
for n, o, m in res: print(('OK    ' if o else 'FALLA ') + n + ((' :: ' + m) if m else ''))
print(f'\n{ok}/{len(res)} OK'); sys.exit(0 if ok == len(res) else 1)
