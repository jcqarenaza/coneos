#!/usr/bin/env python3
"""CTO 14/11 (condición 4, config admin): el contenido idéntico NO reemplaza la identidad del cliente. Postgres LOCAL aislado (arnés de prueba_sql.py).
Función bajo prueba: reclamar_operacion_pedido tal como está en cones-prod (base + pedidos-duplicados-bloqueo.sql + 1b/exclusión). Nunca contra Supabase."""
import os, json, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, 'prueba_sql.py'), encoding='utf-8').read().split("db = build('blq_main')")[0]
exec(compile(_src, 'prueba_sql_helpers', 'exec'))
FIX = 'pedidos-duplicados-excluir-resueltos.sql'
db = build('idc_main'); c = connect(db).cursor(); err, _ = aplicar(c, FIX)
check('F0. función de producción cargada (bloqueo + exclusión de DUPLICADO resueltos)', err is None, str(err))
T1, T2 = '2302555001', '2302666002'

def par(w, **kw1):
    """Cliente A hace su pedido (queda activo); devuelve la decisión para el cliente B con el MISMO contenido."""
    return comprar(w, 'H-IGUAL', **kw1)

print('=== Mismo contenido, clientes distintos: no se marca (llave ENCENDIDA) ===')
w = world(db); a, _, pa = par(w, tel=T1, vis='vis-A', disp=uuid.uuid4())
r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=T2, vis='vis-B', disp=uuid.uuid4())
check('I1. teléfonos distintos + visitantes distintos + dispositivos distintos + contenido IDÉNTICO + ambos activos: NUEVA (sin aviso)', est(a) == 'NUEVA' and est(r) == 'NUEVA', str(r))
w = world(db); par(w, tel=T1, vis='vis-A'); r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=T2, vis='vis-A')
check('I2. teléfonos distintos aunque sea el mismo navegador (mismo visitante): son clientes distintos → NUEVA', est(r) == 'NUEVA', str(r))
w = world(db); par(w, tel=T1, vis='vis-A'); r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=T2, vis=None)
check('I3. teléfono distinto y el segundo sin visitante, contenido idéntico: NUEVA', est(r) == 'NUEVA', str(r))
w = world(db); par(w, tel=None, vis='vis-A'); r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=None, vis='vis-B')
check('I4. ninguno con teléfono, visitantes distintos, contenido idéntico: NUEVA', est(r) == 'NUEVA', str(r))
w = world(db); _, opx, px = par(w, tel=T1, vis='vis-A'); estado(w, px, 'READY'); r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=T2, vis='vis-B')
check('I5. el pedido del otro cliente en READY tampoco los cruza', est(r) == 'NUEVA', str(r))
w = world(db); par(w, tel=T1, vis='vis-A'); r1 = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=T2, vis='vis-B'); r2 = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel='2302777003', vis='vis-C')
check('I6. tres clientes con el mismo contenido y teléfonos distintos: ninguno recibe aviso', est(r1) == 'NUEVA' and est(r2) == 'NUEVA', f'{r1} {r2}')

print('=== Mismo contenido, clientes distintos: llave APAGADA (comportamiento anterior) ===')
w = world(db, bloqueo=False); par(w, tel=T1, vis='vis-A', alcance=False); r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=T2, vis='vis-B', alcance=False)
check('I7. llave apagada: teléfonos distintos + contenido idéntico → NUEVA (el comportamiento anterior ya exigía la misma identidad)', est(r) == 'NUEVA', str(r))

print('=== Controles: la MISMA persona sí se detecta ===')
w = world(db); par(w, tel=T1, vis='vis-A'); r = reclamar(w, uuid.uuid4(), 'H-OTRO', tel=T1, vis='vis-B')
check('C1. mismo teléfono (otro visitante, otro contenido): PEDIDO_ACTIVO — el teléfono es la señal de identidad', est(r) == 'PEDIDO_ACTIVO', str(r))
w = world(db); par(w, tel='02302 555001', vis='vis-A'); r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel='+54 9 2302 555001', vis='vis-B')
check('C2. el mismo teléfono con distinto formato (normalizado): PEDIDO_ACTIVO', est(r) == 'PEDIDO_ACTIVO', str(r))
w = world(db); par(w, tel=None, vis='vis-A'); r = reclamar(w, uuid.uuid4(), 'H-IGUAL', tel=None, vis='vis-A')
check('C3. sin teléfono, mismo visitante y contenido idéntico: PEDIDO_ACTIVO (identidad existente)', est(r) == 'PEDIDO_ACTIVO', str(r))

print(f'\n{sum(R)}/{len(R)} PASS')
raise SystemExit(0 if all(R) else 1)
