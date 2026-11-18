// CONVERSIÓN rama → producto y CONTROL POR SUCURSAL (CTO 17/11, cierre del hallazgo 12.6).
// Postgres 16 local REAL + el SCRIPT DE MIGRACIÓN REAL (supabase/stock-control-por-sucursal.sql) + volver_modelo_producto y _restaurar_producto_stock REALES de cones-prod
// (la habilitación a rama se simula con su efecto: filas congeladas, hojas, apertura, op 'habilitar'). NO es Supabase. Base descartable.
// Ejecutar: npx tsx --test src/lib/__tests__/stock-control-conversion-rama-sql.test.ts  (necesita el cluster de supabase/tests/stock-v2/README.md)
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const SUP = join(process.cwd(), 'supabase')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const DB = 'ctl_conv_rama'
const SCRIPT = readFileSync(join(SUP, 'stock-control-por-sucursal.sql'), 'utf8')

// La migración real trae la lista APROBADA de cones-prod (18 pares). En las bases de prueba, la lista se reemplaza por los pares que la regla da en ESE fixture
// (mismo SQL, mismas guardas); la prueba con la lista real está en stock-control-compat-exacto-sql.test.ts.
const LISTA = /-- >>> LISTA_APROBADA[\s\S]*?-- <<< LISTA_APROBADA/
const LIBERADA = /-- >>> LISTA_LIBERADA[\s\S]*?-- <<< LISTA_LIBERADA/
const CONTEOS = /-- >>> CONTEOS_APROBADOS[\s\S]*?-- <<< CONTEOS_APROBADOS/
async function conLista(c: { query: (s: string) => Promise<{ rows: Record<string, string>[] }> }, base = SCRIPT) {
  const r = (await c.query(`select pr.empresa_id, pr.id as producto_id, s.id as sucursal_id from productos pr join sucursales s on s.empresa_id = pr.empresa_id
    where pr.controla_stock = true and pr.modelo_stock = 'producto' and not exists (select 1 from producto_stock ps where ps.producto_id = pr.id and ps.sucursal_id = s.id)`)).rows
  const ins = r.length ? `insert into _ctl_aprobado (empresa_id, producto_id, sucursal_id) values ${r.map(x => `('${x.empresa_id}','${x.producto_id}','${x.sucursal_id}')`).join(',')};` : ''
  return base.replace(LISTA, ins).replace(LIBERADA, '').replace(CONTEOS, '')   // sin liberadas en los mundos de prueba   // los conteos 17 / 1 / 16 / 1 / 0 son de cones-prod: solo se ejercitan con la lista real
}
let admin: pg.Client, db: pg.Pool
type Row = Record<string, any>   // eslint-disable-line @typescript-eslint/no-explicit-any
const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as Row[]
const one = async (sql: string, ...p: unknown[]) => (await q(sql, p))[0]
const err = async (f: () => Promise<unknown>) => { try { await f(); return null } catch (e) { return (e as Error).message } }
const w = { E: '', A: '', B: '', C: '', U: '' }
let opN = 0
const op = () => `00000000-0000-4000-8000-${String(++opN).padStart(12, '0')}`

async function prod(nombre: string, flag: boolean) {
  const id = (await one('insert into productos(empresa_id, nombre, controla_stock) values($1,$2,$3) returning id', w.E, nombre, flag)).id as string
  return id
}
// simula habilitar_modelo_rama: filas de producto_stock CONGELADAS (no se tocan), hojas con el conteo, apertura, op 'habilitar' con el flag previo, y el producto pasa a rama
async function habilitar(pid: string, previo: boolean, conteos: Record<string, number>) {
  const o = op()
  await q("insert into stock_operaciones(operacion_id, empresa_id, tipo, resultado) values($1,$2,'habilitar',$3)", [o, w.E, JSON.stringify({ producto_id: pid, controla_stock_previo: previo })])
  await q("update productos set modelo_stock='rama', controla_stock=true where id=$1", [pid])
  for (const [suc, cont] of Object.entries(conteos)) {
    const saldo = Number((await one('select coalesce(sum(cantidad),0) s from producto_stock where producto_id=$1 and sucursal_id=$2', pid, suc)).s)
    await q("insert into stock_rama_habilitacion(empresa_id, producto_id, sucursal_id, estado, decision, saldo_anterior, total_contado, operacion_id) values($1,$2,$3,'activa','contar',$4,$5,$6)", [w.E, pid, suc, saldo, cont, o])
    const h = (await one('insert into stock_rama(empresa_id, sucursal_id, producto_id, cantidad) values($1,$2,$3,$4) returning id', w.E, suc, pid, cont)).id as string
    if (cont > 0) await q("insert into stock_movimientos(empresa_id, sucursal_id, producto_id, delta, motivo, detalle, rama_id) values($1,$2,$3,$4,'apertura','Apertura',$5)", [w.E, suc, pid, cont, h])
  }
}
const volver = (pid: string) => q('select volver_modelo_producto($1,$2,$3,$4,$5,$6) r', [w.E, pid, w.U, 'Juan', 'prueba', op()])
const filas = (pid: string) => q('select sucursal_id, cantidad, controla from producto_stock where producto_id=$1 order by sucursal_id', [pid])
const foto = async (pid: string) => ({ ps: await filas(pid), mov: Number((await one('select count(*) n from stock_movimientos where producto_id=$1', pid)).n), flag: (await one('select controla_stock c, modelo_stock m from productos where id=$1', pid)) })
const agregadoOk = async (pid: string) => {
  const f = await one('select controla_stock c from productos where id=$1', pid); const t = await one('select coalesce(bool_or(controla), false) t from producto_stock where producto_id=$1', pid)
  return f.c === t.t
}

before(async () => {
  admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect()
  await admin.query(`drop database if exists ${DB} with (force)`); await admin.query(`create database ${DB}`)
  db = new pg.Pool({ ...SOCK, database: DB, max: 4 }); db.on('error', () => {})
  for (const f of ['tests/stock-v2/00-schema-reducido.sql', 'tests/stock-por-sucursal/00-extras.sql', 'tests/stock-por-sucursal/01-extras-conversion-rama.sql']) await db.query(readFileSync(join(SUP, f), 'utf8'))
  const id = async (s: string, ...a: unknown[]) => (await db.query(s, a)).rows[0].id as string
  w.E = await id('insert into empresas default values returning id')
  for (const k of ['A', 'B', 'C'] as const) w[k] = await id('insert into sucursales(empresa_id, nombre) values($1,$2) returning id', w.E, k)
  w.U = '99999999-9999-4999-8999-999999999999'
  await db.query(await conLista(db))   // la migración real primero (base vacía): crea la columna y las 8 funciones v1.9
})
after(async () => { await db?.end(); await admin?.query(`drop database if exists ${DB} with (force)`); await admin?.end() })

describe('CONVERSIÓN rama → producto (post-migración)', () => {
  test('R1 CON control previo: las sucursales controladas conservan control y cantidad; la sucursal sin fila (vendía libre) NO queda controlada; agregado coherente', async () => {
    const p = await prod('Con control', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true),($1,$2,$4,0,false)', [w.E, p, w.A, w.B])   // A controla, B libre (fila), C sin fila
    await habilitar(p, true, { [w.A]: 7, [w.B]: 4, [w.C]: 3 })
    const antes = await one('select count(*) n from stock_movimientos where producto_id=$1', p)
    const r = (await volver(p))[0].r
    assert.equal(r.controla_stock, true); assert.equal(r.repetido, false)
    const f = Object.fromEntries((await filas(p)).map(x => [x.sucursal_id, x]))
    assert.deepEqual([f[w.A].cantidad, f[w.A].controla], [7, true], 'A: sigue controlando, con el conteo')
    assert.deepEqual([f[w.B].cantidad, f[w.B].controla], [4, false], 'B: sigue libre')
    assert.deepEqual([f[w.C].cantidad, f[w.C].controla], [3, false], 'C: no tenía fila → fila creada SIN control')
    assert.ok(await agregadoOk(p)); assert.equal((await one('select modelo_stock m from productos where id=$1', p)).m, 'producto')
    // movimientos: solo los de la conversión (ajuste por sucursal con delta del conteo), ninguno extra
    const nuevos = Number((await one('select count(*) n from stock_movimientos where producto_id=$1', p)).n) - Number(antes.n)
    assert.equal(nuevos, 3 /* hojas a 0 */ + 3 /* restauración */)
  })

  test('R2 SIN control previo: ninguna sucursal queda controlada, el agregado queda en false', async () => {
    const p = await prod('Sin control', false)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,2,false)', [w.E, p, w.A])
    await habilitar(p, false, { [w.A]: 2, [w.B]: 5 })
    const r = (await volver(p))[0].r
    assert.equal(r.controla_stock, false)
    const f = Object.fromEntries((await filas(p)).map(x => [x.sucursal_id, x]))
    assert.deepEqual([f[w.A].cantidad, f[w.A].controla, f[w.B].cantidad, f[w.B].controla], [2, false, 5, false])
    assert.ok(await agregadoOk(p)); assert.equal((await one('select controla_stock c from productos where id=$1', p)).c, false)
  })

  test('R3 configuraciones DISTINTAS por sucursal (controla / libre con fila / sin fila / controla en 0): cada una vuelve como estaba', async () => {
    const p = await prod('Mixto', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true),($1,$2,$4,9,false)', [w.E, p, w.A, w.B])
    await habilitar(p, true, { [w.A]: 0, [w.B]: 9, [w.C]: 0 })
    await volver(p)
    const f = Object.fromEntries((await filas(p)).map(x => [x.sucursal_id, x]))
    assert.deepEqual([f[w.A].cantidad, f[w.A].controla], [0, true], 'A: controla en 0 → sigue controlando (SIN_STOCK)')
    assert.deepEqual([f[w.B].cantidad, f[w.B].controla], [9, false])
    assert.equal(f[w.C], undefined, 'C: conteo 0 y sin fila → no se crea fila (sigue vendiendo libre)')
    assert.ok(await agregadoOk(p))
  })

  test('R4 el comportamiento de venta tras volver coincide con el previo: controlada en 0 → SIN_STOCK; libre vende; sin fila vende', async () => {
    const p = await prod('Venta tras volver', true)
    const pres = (await one("insert into presentaciones(empresa_id, producto_id, nombre, precio) values($1,$2,'U',1) returning id", w.E, p)).id as string
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 0, [w.B]: 0 })
    await volver(p)
    const vender = (suc: string) => q(`select crear_pedido_stock($1,$2,null,$3::jsonb,'efectivo','CAJA','mostrador',0,null,'pendiente','X') r`,
      [w.E, suc, JSON.stringify([{ presentacion_id: pres, cantidad: 1, precio_snap: 1, nombre_producto_snap: 'p', nombre_presentacion_snap: 'u' }])])
    assert.match((await err(() => vender(w.A)))!, /SIN_STOCK/)
    assert.equal((await err(() => vender(w.B))), null); assert.equal((await err(() => vender(w.C))), null)
  })

  test('R5 las cantidades de producto_stock no cambian salvo el conteo restaurado; los movimientos previos de otros productos quedan intactos', async () => {
    const otro = await prod('Otro', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,5,true)', [w.E, otro, w.A])
    await q("insert into stock_movimientos(empresa_id, sucursal_id, producto_id, delta, motivo) values($1,$2,$3,5,'ajuste')", [w.E, w.A, otro])
    const antes = await foto(otro)
    const p = await prod('Convertido', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 6 }); await volver(p)
    assert.deepEqual(await foto(otro), antes)
    assert.equal(Number((await one('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', p, w.A)).cantidad), 6)
  })

  test('R6 idempotencia: repetir la misma operación no duplica filas ni movimientos', async () => {
    const p = await prod('Idem', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 3 })
    const err2 = await err(() => volver(p)); assert.equal(err2, null)
    const f = await foto(p)
    const m2 = await err(() => volver(p)); assert.match(m2!, /PRODUCTO_NO_RAMA/)   // ya es producto: no hay segunda conversión
    assert.deepEqual(await foto(p), f)
  })
})

describe('CONVERSIÓN: habilitaciones del modelo GLOBAL anterior (no reconstruibles) y rama sin regresión', () => {
  test('L1 flag previo true pero ninguna fila controlada (habilitación hecha con el modelo global): ABORTA sin cambios y no inventa control', async () => {
    const p = await prod('Legado', false)
    await habilitar(p, true, { [w.A]: 25, [w.B]: 25 })     // sin filas de producto_stock (como TEST E2B Rama en prod)
    const antes = await foto(p); const hojas = (await one('select sum(cantidad) s from stock_rama where producto_id=$1', p)).s
    const m = await err(() => volver(p)); assert.match(m!, /CONTROL_POR_SUCURSAL_NO_RECONSTRUIBLE/)
    assert.deepEqual(await foto(p), antes); assert.equal((await one('select sum(cantidad) s from stock_rama where producto_id=$1', p)).s, hojas)
    assert.equal((await one("select estado from stock_rama_habilitacion where producto_id=$1 limit 1", p)).estado, 'activa')
    assert.equal((await one("select modelo_stock m from productos where id=$1", p)).m, 'rama')
  })

  test('L2 flag previo false con una fila controlada (inconsistente): también aborta', async () => {
    const p = await prod('Incoherente', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.A])
    await habilitar(p, false, { [w.A]: 1 })
    assert.match((await err(() => volver(p)))!, /CONTROL_POR_SUCURSAL_NO_RECONSTRUIBLE/)
  })

  test('L3 las guardas existentes siguen igual: con movimientos posteriores a la apertura sigue bloqueando', async () => {
    const p = await prod('Con ventas', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 4 })
    const h = (await one('select id from stock_rama where producto_id=$1', p)).id
    await q("insert into stock_movimientos(empresa_id, sucursal_id, producto_id, delta, motivo, rama_id, created_at) values($1,$2,$3,-1,'ajuste',$4, now() + interval '1 second')", [w.E, w.A, p, h])
    assert.match((await err(() => volver(p)))!, /REVERSION_BLOQUEADA/)
  })

  test('L4 el producto en modelo rama sigue sin aceptar escrituras en producto_stock (trigger real)', async () => {
    const p = await prod('Congelado', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 1 })
    assert.match((await err(() => q('update producto_stock set controla=false where producto_id=$1', [p])))!, /PRODUCTO_MODELO_RAMA/)
  })

  test('L5 las 8 funciones v1.9 existen tras la migración y _restaurar/volver llevan la marca', async () => {
    const n = await one("select count(*) n from pg_proc where proname in ('crear_pedido_stock','ajustar_stock','crear_arqueo_stock','iniciar_conteo_stock','_calcular_ajuste_stock','devolver_stock_pedido','_restaurar_producto_stock','volver_modelo_producto') and prosrc like '%v1.9%'")
    assert.equal(Number(n.n), 8)
  })
})

describe('CONVERSIÓN: estado INDIVIDUAL por sucursal (cantidad cero, configuraciones mixtas, verificación por sucursal)', () => {
  const movsRev = async (pid: string, suc: string, o: string) => Number((await one("select count(*) n from stock_movimientos where producto_id=$1 and sucursal_id=$2 and operacion_id=$3 and rama_id is null", pid, suc, o)).n)
  async function convertir(pid: string) {
    const o = op(); await q('select volver_modelo_producto($1,$2,$3,$4,$5,$6)', [w.E, pid, w.U, 'Juan', 'prueba', o]); return o
  }
  const fila1 = async (pid: string, suc: string) => (await q('select cantidad, controla from producto_stock where producto_id=$1 and sucursal_id=$2', [pid, suc]))[0]

  test('S1 fila previa controla=true con cantidad positiva (conteo igual): sigue controlando, sin movimiento de restauración', async () => {
    const p = await prod('S1', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,6,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 6 }); const o = await convertir(p)
    assert.deepEqual(await fila1(p, w.A), { cantidad: 6, controla: true }); assert.equal(await movsRev(p, w.A, o), 0)
  })
  test('S1b fila controla=true cantidad positiva y conteo distinto: controla se conserva y la cantidad pasa al conteo con UN movimiento', async () => {
    const p = await prod('S1b', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,6,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 4 }); const o = await convertir(p)
    assert.deepEqual(await fila1(p, w.A), { cantidad: 4, controla: true }); assert.equal(await movsRev(p, w.A, o), 1)
  })
  test('S2 fila previa controla=true con cantidad CERO: conteo 0 → sigue la fila controlada en 0 (SIN_STOCK), sin movimientos; conteo 5 → controlada con 5', async () => {
    const p = await prod('S2', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true),($1,$2,$4,0,true)', [w.E, p, w.A, w.B])
    await habilitar(p, true, { [w.A]: 0, [w.B]: 5 }); const o = await convertir(p)
    assert.deepEqual(await fila1(p, w.A), { cantidad: 0, controla: true }); assert.equal(await movsRev(p, w.A, o), 0)
    assert.deepEqual(await fila1(p, w.B), { cantidad: 5, controla: true }); assert.equal(await movsRev(p, w.B, o), 1)
  })
  test('S3 fila previa controla=false (cantidad positiva y cero): sigue sin controlar', async () => {
    const p = await prod('S3', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,3,false),($1,$2,$4,0,false),($1,$2,$5,0,true)', [w.E, p, w.A, w.B, w.C])
    await habilitar(p, true, { [w.A]: 3, [w.B]: 0, [w.C]: 0 }); const o = await convertir(p)
    assert.deepEqual(await fila1(p, w.A), { cantidad: 3, controla: false }); assert.deepEqual(await fila1(p, w.B), { cantidad: 0, controla: false })
    assert.deepEqual(await fila1(p, w.C), { cantidad: 0, controla: true })
    for (const x of [w.A, w.B, w.C]) assert.equal(await movsRev(p, x, o), 0)
  })
  test('S4 sin fila previa: conteo 0 → NO se crea fila; conteo > 0 → fila con controla=false', async () => {
    const p = await prod('S4', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.C])   // otra sucursal controla (agregado true)
    await habilitar(p, true, { [w.A]: 0, [w.B]: 8, [w.C]: 0 }); const o = await convertir(p)
    assert.equal(await fila1(p, w.A), undefined); assert.equal(await movsRev(p, w.A, o), 0)
    assert.deepEqual(await fila1(p, w.B), { cantidad: 8, controla: false }); assert.equal(await movsRev(p, w.B, o), 1)
    assert.deepEqual(await fila1(p, w.C), { cantidad: 0, controla: true })
  })
  test('S5 control en algunas sucursales y desactivado en otras: cada una conserva su configuración y el agregado queda true', async () => {
    const p = await prod('S5', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,10,true),($1,$2,$4,10,false)', [w.E, p, w.A, w.B])
    await habilitar(p, true, { [w.A]: 10, [w.B]: 10, [w.C]: 2 }); await convertir(p)
    assert.equal((await fila1(p, w.A)).controla, true); assert.equal((await fila1(p, w.B)).controla, false); assert.deepEqual(await fila1(p, w.C), { cantidad: 2, controla: false })
    assert.ok(await agregadoOk(p)); assert.equal((await one('select controla_stock c from productos where id=$1', p)).c, true)
  })
  test('S6 sin filas controladas en NINGUNA sucursal (flag previo false) y conteos cero: no queda ninguna fila ni control', async () => {
    const p = await prod('S6', false)
    await habilitar(p, false, { [w.A]: 0, [w.B]: 0 }); await convertir(p)
    assert.equal((await filas(p)).length, 0); assert.equal((await one('select controla_stock c from productos where id=$1', p)).c, false)
  })

  test('V1 la verificación por sucursal ABORTA si algo altera la marca controla de una fila existente durante la restauración (rollback completo)', async () => {
    const p = await prod('V1', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,5,true),($1,$2,$4,5,false)', [w.E, p, w.A, w.B])
    await habilitar(p, true, { [w.A]: 5, [w.B]: 5 })
    const antes = await foto(p); const hojas = (await one('select sum(cantidad) s from stock_rama where producto_id=$1', p)).s
    await db.query(`create function t_altera() returns trigger language plpgsql as $$ begin new.controla := false; return new; end $$;
      create trigger t_altera before update on producto_stock for each row when (old.producto_id = '${p}') execute function t_altera()`)
    try {
      const m = await err(() => volver(p)); assert.match(m!, /RESTAURACION_CONTROL_SUCURSAL_ALTERADA/)
    } finally { await db.query('drop trigger t_altera on producto_stock; drop function t_altera()') }
    assert.deepEqual(await foto(p), antes); assert.equal((await one('select sum(cantidad) s from stock_rama where producto_id=$1', p)).s, hojas)
    assert.equal((await one("select count(*) n from stock_rama_habilitacion where producto_id=$1 and estado='activa'", p)).n, '2')
  })
  test('V2 la verificación por sucursal ABORTA si una fila nueva (sin fila previa) nace con controla=true', async () => {
    const p = await prod('V2', true)
    await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) values($1,$2,$3,0,true)', [w.E, p, w.A])
    await habilitar(p, true, { [w.A]: 0, [w.B]: 4 })
    await db.query(`create function t_activa() returns trigger language plpgsql as $$ begin new.controla := true; return new; end $$;
      create trigger t_activa before insert on producto_stock for each row when (new.producto_id = '${p}') execute function t_activa()`)
    try { assert.match((await err(() => volver(p)))!, /RESTAURACION_CONTROL_SUCURSAL_ALTERADA/) }
    finally { await db.query('drop trigger t_activa on producto_stock; drop function t_activa()') }
    assert.equal((await one('select modelo_stock m from productos where id=$1', p)).m, 'rama'); assert.equal((await filas(p)).length, 1)
  })
  test('V3 la migración exige en volver_modelo_producto las tres guardas (no reconstruible, alterada por sucursal, agregado)', async () => {
    const n = await one("select count(*) n from pg_proc where proname='volver_modelo_producto' and prosrc like '%CONTROL_POR_SUCURSAL_NO_RECONSTRUIBLE%' and prosrc like '%RESTAURACION_CONTROL_SUCURSAL_ALTERADA%' and prosrc like '%AGREGADO_CONTROL_INCOHERENTE%'")
    assert.equal(Number(n.n), 1)
  })
})
