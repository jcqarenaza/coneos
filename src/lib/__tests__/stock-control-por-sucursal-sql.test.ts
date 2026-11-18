// CONTROL DE STOCK POR PRODUCTO Y SUCURSAL (GO CTO 17/11) — Postgres 16 local REAL con el SCRIPT DE MIGRACIÓN REAL (supabase/stock-control-por-sucursal.sql)
// y las funciones SQL REALES de cones-prod (crear_pedido_stock v1.8→v1.9, ajustar_stock, devolver_stock_pedido, crear_arqueo_stock, iniciar_conteo_stock,
// _calcular_ajuste_stock). Esquema reducido + extras (supabase/tests/stock-por-sucursal/00-extras.sql: guardas reales copiadas de la viva; rama y arqueo/conteo = stubs
// mínimos). NO es Supabase (sin RLS ni auth real). Base descartable: no se toca ninguna base real ni /federal.
// Ejecutar: npx tsx --test src/lib/__tests__/stock-control-por-sucursal-sql.test.ts  (necesita el cluster de supabase/tests/stock-v2/README.md)
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const SUP = join(process.cwd(), 'supabase')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const DB = 'ctl_suc_sql', DB2 = 'ctl_suc_abort'
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

const w = { E1: '', E2: '', A: '', B: '', C: '', D: '' }
const L: Record<string, { id: string; pres: string }> = {}   // productos del mundo LEGADO (antes de migrar)
async function crearBase(nombre: string) {
  await admin.query(`drop database if exists ${nombre} with (force)`); await admin.query(`create database ${nombre}`)
  const p = new pg.Pool({ ...SOCK, database: nombre, max: 5 }); p.on('error', () => {})
  await p.query(readFileSync(join(SUP, 'tests/stock-v2/00-schema-reducido.sql'), 'utf8'))
  await p.query(readFileSync(join(SUP, 'tests/stock-por-sucursal/00-extras.sql'), 'utf8'))
  return p
}
async function prod(emp: string, nombre: string, flag: boolean, modelo = 'producto') {
  const id = (await one('insert into productos(empresa_id, nombre, controla_stock, modelo_stock) values($1,$2,$3,$4) returning id', emp, nombre, flag, modelo)).id as string
  const pres = (await one("insert into presentaciones(empresa_id, producto_id, nombre, precio) values($1,$2,'Unidad',1000) returning id", emp, id)).id as string
  return { id, pres }
}
const fila = (p: { id: string }, suc: string, cant: number, controla: boolean) => q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad, controla) select empresa_id, $1, $2, $3, $4 from productos where id=$1', [p.id, suc, cant, controla])
const cant = async (p: { id: string }, suc: string) => (await one('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', p.id, suc))?.cantidad as number | undefined
const nMov = async (p: { id: string }, suc?: string) => Number((await one(`select count(*) n from stock_movimientos where producto_id=$1 ${suc ? 'and sucursal_id=$2' : ''}`, ...(suc ? [p.id, suc] : [p.id]))).n)
const vender = (emp: string, suc: string, pres: string, c: number) => q(`select crear_pedido_stock($1,$2,null,$3::jsonb,'efectivo','CAJA','mostrador',0,null,'pendiente','X') r`,
  [emp, suc, JSON.stringify([{ presentacion_id: pres, cantidad: c, precio_snap: 1000, nombre_producto_snap: 'p', nombre_presentacion_snap: 'u' }])])
const pedidoDe = async (r: Row[]) => (r[0].r as { id: string }).id

before(async () => {
  admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect()
  db = await crearBase(DB)
  const one0 = async (s: string, ...a: unknown[]) => (await db.query(s, a)).rows[0].id as string
  w.E1 = await one0('insert into empresas default values returning id'); w.E2 = await one0('insert into empresas default values returning id')
  for (const [k, e, n] of [['A', w.E1, 'Centro'], ['B', w.E1, 'Norte'], ['C', w.E1, 'Sur'], ['D', w.E2, 'Ajena']] as const) w[k] = await one0('insert into sucursales(empresa_id, nombre) values($1,$2) returning id', e, n)
  // ── mundo LEGADO (modelo global anterior): el flag del producto decide; sin fila = agotado ──
  L.copa = await prod(w.E1, 'Copa Sport', true); L.bombon = await prod(w.E1, 'Bombón', true); L.libre = await prod(w.E1, 'Libre con fila (compras)', false)
  L.rama = await prod(w.E1, 'Rama', true, 'rama'); L.e2 = await prod(w.E2, 'Federal-like', true); L.sinfila = await prod(w.E1, 'Sin control ni filas', false)
  await q("select ajustar_stock($1,$2,$3,5,'set','ajuste',null,'alta legado')", [w.E1, w.A, L.copa.id])
  await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad) values($1,$2,$3,2),($1,$2,$4,0)', [w.E1, L.bombon.id, w.A, w.B])
  await q('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad) values($1,$2,$3,3)', [w.E1, L.libre.id, w.A])
  await db.query(await conLista(db))   // ← LA MIGRACIÓN REAL, una transacción, con sus verificaciones internas
})
after(async () => { await db?.end(); await admin?.query(`drop database if exists ${DB} with (force)`); await admin?.query(`drop database if exists ${DB2} with (force)`); await admin?.end() })

describe('MIGRACIÓN: el script real sobre datos legados', () => {
  test('M1 producto_stock.controla existe, boolean NOT NULL', async () => {
    const c = await one("select data_type, is_nullable from information_schema.columns where table_name='producto_stock' and column_name='controla'")
    assert.equal(c.data_type, 'boolean'); assert.equal(c.is_nullable, 'NO')
  })
  test('M2 filas existentes marcadas según el comportamiento GLOBAL anterior (flag del producto), sin convertir en controladas las de productos sin control', async () => {
    assert.equal(await one('select controla c from producto_stock where producto_id=$1 and sucursal_id=$2', L.copa.id, w.A).then(r => r.c), true)
    assert.equal(await one('select controla c from producto_stock where producto_id=$1 and sucursal_id=$2', L.bombon.id, w.B).then(r => r.c), true)
    assert.equal(await one('select controla c from producto_stock where producto_id=$1 and sucursal_id=$2', L.libre.id, w.A).then(r => r.c), false, 'fila de un producto SIN control: sigue sin control')
  })
  test('M3 filas de compatibilidad: cantidad 0 + controla=true en cada sucursal de SU empresa sin fila de productos ya controlados; ninguna más', async () => {
    const dest = (await q(`select p.nombre, s.nombre suc, ps.cantidad, ps.controla from producto_stock ps join productos p on p.id=ps.producto_id join sucursales s on s.id=ps.sucursal_id order by 1,2`))
    assert.deepEqual(dest.map(r => [r.nombre, r.suc, Number(r.cantidad), r.controla]), [
      ['Bombón', 'Centro', 2, true], ['Bombón', 'Norte', 0, true], ['Bombón', 'Sur', 0, true],
      ['Copa Sport', 'Centro', 5, true], ['Copa Sport', 'Norte', 0, true], ['Copa Sport', 'Sur', 0, true],
      ['Federal-like', 'Ajena', 0, true],
      ['Libre con fila (compras)', 'Centro', 3, false]])
    assert.equal((await q('select 1 from producto_stock where producto_id=$1', [L.rama.id])).length, 0, 'rama: sin filas (el guard lo prohíbe y se excluye)')
  })
  test('M4 cantidades, movimientos y agregado productos.controla_stock intactos; las filas de compatibilidad NO generan movimientos', async () => {
    assert.equal(await cant(L.copa, w.A), 5); assert.equal(await nMov(L.copa), 1, 'solo el alta del legado'); assert.equal(await nMov(L.bombon), 0); assert.equal(await nMov(L.e2), 0)
    assert.deepEqual((await q('select nombre from productos where controla_stock order by 1')).map(r => r.nombre), ['Bombón', 'Copa Sport', 'Federal-like', 'Rama'])
  })
  test('M5 la guarda impide aplicar dos veces (no pisa la configuración por sucursal)', async () => {
    await q('update producto_stock set controla=false where producto_id=$1 and sucursal_id=$2', [L.bombon.id, w.C])
    const e = await err(() => db.query(SCRIPT)); assert.match(e!, /MIGRACION_YA_APLICADA/)
    assert.equal((await one('select controla c from producto_stock where producto_id=$1 and sucursal_id=$2', L.bombon.id, w.C)).c, false, 'sin cambios')
    await q('update producto_stock set controla=true where producto_id=$1 and sucursal_id=$2', [L.bombon.id, w.C])
  })
  test('M6 comportamiento anterior preservado: controlado con stock vende y descuenta; sin fila previa = agotado; producto sin control vende libre', async () => {
    const ped = await vender(w.E1, w.A, L.copa.pres, 2); assert.ok(await pedidoDe(ped)); assert.equal(await cant(L.copa, w.A), 3)
    assert.match((await err(() => vender(w.E1, w.B, L.copa.pres, 1)))!, /SIN_STOCK:Copa Sport/, 'B quedó en 0 (fila de compatibilidad): igual que «sin fila» antes')
    await vender(w.E1, w.A, L.sinfila.pres, 4); assert.equal(await nMov(L.sinfila), 0)
    await q('update producto_stock set cantidad=5 where producto_id=$1 and sucursal_id=$2', [L.copa.id, w.A])
  })
  test('M7 aislamiento entre empresas: la migración no cruzó filas (E2 solo en su sucursal; ninguna fila de E1 en la sucursal de E2 y viceversa)', async () => {
    assert.equal((await q('select 1 from producto_stock ps join sucursales s on s.id=ps.sucursal_id where s.empresa_id <> ps.empresa_id')).length, 0)
    assert.equal((await q('select 1 from producto_stock where sucursal_id=$1 and empresa_id=$2', [w.D, w.E1])).length, 0)
  })
  test('M8 si una verificación interna falla, se ABORTA TODO: no queda columna, ni filas, ni funciones v1.9', async () => {
    const d2 = await crearBase(DB2)
    try {
      const e = (await d2.query('insert into empresas default values returning id')).rows[0].id; const s = (await d2.query('insert into sucursales(empresa_id) values($1) returning id', [e])).rows[0].id
      const p = (await d2.query("insert into productos(empresa_id, nombre, controla_stock) values($1,'X',true) returning id", [e])).rows[0].id
      // un trigger que «ensucia» el libro al insertar la fila de compatibilidad → la verificación de movimientos debe abortar la migración
      await d2.query(`create function sucio() returns trigger language plpgsql as $$ begin insert into stock_movimientos(empresa_id, sucursal_id, producto_id, delta, motivo, detalle) values (new.empresa_id, new.sucursal_id, new.producto_id, 1, 'ajuste', 'x'); return new; end $$;
        create trigger t_sucio after insert on producto_stock for each row execute function sucio()`)
      const m = await d2.query(await conLista(d2)).then(() => null, (x: Error) => x.message); assert.match(m!, /VERIF: cambió la cantidad de movimientos/)
      assert.equal((await d2.query("select 1 from information_schema.columns where table_name='producto_stock' and column_name='controla'")).rows.length, 0)
      assert.equal((await d2.query('select 1 from producto_stock')).rows.length, 0)
      assert.equal((await d2.query("select 1 from pg_proc where proname='crear_pedido_stock' and prosrc like '%v1.9%'")).rows.length, 0)
      void p; void s
    } finally { await d2.end() }
  })
})

describe('VENTA: la decide la fila (producto, sucursal del pedido)', () => {
  test('V1 control activo + 0 → SIN_STOCK y no queda pedido ni movimiento', async () => {
    const p = await prod(w.E1, 'V1', true); await fila(p, w.A, 0, true)
    const antes = Number((await one('select count(*) n from pedidos')).n)
    assert.match((await err(() => vender(w.E1, w.A, p.pres, 1)))!, /SIN_STOCK:V1/)
    assert.equal(Number((await one('select count(*) n from pedidos')).n), antes); assert.equal(await nMov(p), 0)
  })
  test('V2 sucursal SIN control (fila controla=false o sin fila) vende libre, no descuenta, no mueve el libro, aunque OTRA sucursal controle el mismo producto en 0', async () => {
    const p = await prod(w.E1, 'V2', true); await fila(p, w.A, 0, true); await fila(p, w.B, 7, false)   // A controla en 0; B tiene fila SIN control; C sin fila
    assert.match((await err(() => vender(w.E1, w.A, p.pres, 1)))!, /SIN_STOCK/)
    const pb = await pedidoDe(await vender(w.E1, w.B, p.pres, 3)); assert.ok(pb); assert.equal(await cant(p, w.B), 7); assert.equal((await one('select stock_descontado d from pedidos where id=$1', pb)).d, false)
    await vender(w.E1, w.C, p.pres, 3); assert.equal(await cant(p, w.C), undefined); assert.equal(await nMov(p), 0)
  })
  test('V3 control activo + stock positivo: vende y descuenta, deja el movimiento y marca stock_descontado', async () => {
    const p = await prod(w.E1, 'V3', true); await fila(p, w.C, 5, true)
    const id = await pedidoDe(await vender(w.E1, w.C, p.pres, 2)); assert.equal(await cant(p, w.C), 3)
    const m = await one("select delta, motivo, pedido_id from stock_movimientos where producto_id=$1", p.id); assert.equal(Number(m.delta), -2); assert.equal(m.motivo, 'venta'); assert.equal(m.pedido_id, id)
    assert.equal((await one('select stock_descontado d from pedidos where id=$1', id)).d, true)
  })
  test('V4 la existencia y el descuento NUNCA se comparten entre sucursales', async () => {
    const p = await prod(w.E1, 'V4', true); await fila(p, w.A, 5, true); await fila(p, w.C, 8, true)
    await vender(w.E1, w.A, p.pres, 2); assert.equal(await cant(p, w.A), 3); assert.equal(await cant(p, w.C), 8); assert.equal(await nMov(p, w.C), 0)
  })
  test('V5 cantidad mayor a la existencia → SIN_STOCK sin cambios; pedido mixto con un producto sin stock → todo se revierte (el otro NO se descuenta)', async () => {
    const a = await prod(w.E1, 'V5a', true), b = await prod(w.E1, 'V5b', true); await fila(a, w.A, 10, true); await fila(b, w.A, 1, true)
    assert.match((await err(() => vender(w.E1, w.A, b.pres, 2)))!, /SIN_STOCK:V5b/); assert.equal(await cant(b, w.A), 1)
    const items = [{ presentacion_id: a.pres, cantidad: 3, precio_snap: 1000 }, { presentacion_id: b.pres, cantidad: 2, precio_snap: 1000 }]
    assert.match((await err(() => q("select crear_pedido_stock($1,$2,null,$3::jsonb,'efectivo','CAJA','mostrador',0,null,'pendiente','X')", [w.E1, w.A, JSON.stringify(items)])))!, /SIN_STOCK/)
    assert.equal(await cant(a, w.A), 10, 'atómico: nada se descontó'); assert.equal(await nMov(a), 0)
  })
  test('V6 sucursal NUEVA (creada después, sin configuración) vende libremente un producto controlado en otras', async () => {
    const p = await prod(w.E1, 'V6', true); await fila(p, w.A, 0, true)
    const nueva = (await one("insert into sucursales(empresa_id, nombre) values($1,'Nueva') returning id", w.E1)).id as string
    assert.ok(await pedidoDe(await vender(w.E1, nueva, p.pres, 2))); assert.equal(await cant(p, nueva), undefined); assert.equal(await nMov(p), 0)
  })
  test('V7 aislamiento entre empresas: una presentación de otra empresa o una sucursal ajena se rechazan', async () => {
    const p = await prod(w.E1, 'V7', true); await fila(p, w.A, 5, true)
    assert.match((await err(() => vender(w.E2, w.D, p.pres, 1)))!, /PRESENTACION_INVALIDA/)
    assert.match((await err(() => vender(w.E1, w.D, p.pres, 1)))!, /SUCURSAL_INVALIDA/); assert.equal(await cant(p, w.A), 5)
  })
  test('V8 STOCK POR RAMA sin regresión: habilitada en la sucursal descuenta de la hoja; sin habilitación → SUCURSAL_PENDIENTE_ACTIVACION; no mira producto_stock ni el control por sucursal', async () => {
    const r = await prod(w.E1, 'V8 Rama', true, 'rama')
    assert.match((await err(() => vender(w.E1, w.A, r.pres, 1)))!, /SUCURSAL_PENDIENTE_ACTIVACION/)
    await q("insert into stock_rama_habilitacion values($1,$2,'activa')", [r.id, w.A]); await q('insert into stock_rama(empresa_id, sucursal_id, presentacion_id, cantidad) values($1,$2,$3,5)', [w.E1, w.A, r.pres])
    await vender(w.E1, w.A, r.pres, 2); assert.equal((await one('select cantidad c from stock_rama where presentacion_id=$1', r.pres)).c, 3)
    assert.equal((await q('select 1 from producto_stock where producto_id=$1', [r.id])).length, 0)
    assert.match((await err(() => vender(w.E1, w.A, r.pres, 9)))!, /SIN_STOCK:V8 Rama/)
  })
})

describe('AJUSTAR_STOCK: una fila nueva NUNCA activa el control', () => {
  test('J1 compra/ajuste/arqueo/devolución en sucursal sin fila crea la fila con controla=false: el producto sigue vendiéndose libre y sin descontar', async () => {
    const p = await prod(w.E1, 'J1', false)
    const r = await one("select ajustar_stock($1,$2,$3,10,'delta','ajuste',null,'ingreso (como lo haría una compra)') r", w.E1, w.B, p.id); assert.equal(r.r.cantidad, 10)
    assert.equal((await one('select controla c from producto_stock where producto_id=$1 and sucursal_id=$2', p.id, w.B)).c, false)
    await vender(w.E1, w.B, p.pres, 4); assert.equal(await cant(p, w.B), 10, 'no descuenta'); assert.equal((await q("select 1 from stock_movimientos where producto_id=$1 and motivo='venta'", [p.id])).length, 0)
  })
  test('J2 una fila existente conserva su marca (controlada: sigue controlada tras +delta y set; no controlada: sigue libre)', async () => {
    const p = await prod(w.E1, 'J2', true); await fila(p, w.A, 5, true); await fila(p, w.B, 5, false)
    await q("select ajustar_stock($1,$2,$3,3,'delta','ajuste',null,null)", [w.E1, w.A, p.id]); await q("select ajustar_stock($1,$2,$3,9,'set','ajuste',null,null)", [w.E1, w.B, p.id])
    assert.equal((await one('select controla c, cantidad n from producto_stock where producto_id=$1 and sucursal_id=$2', p.id, w.A)).c, true); assert.equal(await cant(p, w.A), 8)
    assert.equal((await one('select controla c from producto_stock where producto_id=$1 and sucursal_id=$2', p.id, w.B)).c, false); assert.equal(await cant(p, w.B), 9)
  })
  test('J3 reintento «set» idempotente: no duplica movimientos', async () => {
    const p = await prod(w.E1, 'J3', false)
    await q("select ajustar_stock($1,$2,$3,12,'set','ajuste',null,'alta')", [w.E1, w.A, p.id]); await q("select ajustar_stock($1,$2,$3,12,'set','ajuste',null,'alta')", [w.E1, w.A, p.id])
    assert.equal(await nMov(p), 1)
  })
  test('J4 producto o sucursal de otra empresa → PRODUCTO_INVALIDO / SUCURSAL_INVALIDA y no escribe; un producto por rama sigue bloqueado por el guard', async () => {
    const p = await prod(w.E1, 'J4', false); const r = await prod(w.E1, 'J4 rama', true, 'rama')
    assert.match((await err(() => q("select ajustar_stock($1,$2,$3,1,'delta','ajuste',null,null)", [w.E2, w.D, p.id])))!, /PRODUCTO_INVALIDO/)
    assert.match((await err(() => q("select ajustar_stock($1,$2,$3,1,'delta','ajuste',null,null)", [w.E1, w.D, p.id])))!, /SUCURSAL_INVALIDA/)
    assert.match((await err(() => q("select ajustar_stock($1,$2,$3,1,'delta','ajuste',null,null)", [w.E1, w.A, r.id])))!, /PRODUCTO_MODELO_RAMA/)
    assert.equal(await cant(p, w.A), undefined)
  })
})

describe('DEVOLUCIÓN: vuelve a la sucursal original, decidida por el libro de la venta', () => {
  test('D1 devuelve SOLO a la sucursal del pedido, una vez (idempotente); las otras sucursales no se tocan', async () => {
    const p = await prod(w.E1, 'D1', true); await fila(p, w.A, 5, true); await fila(p, w.C, 8, true)
    const id = await pedidoDe(await vender(w.E1, w.A, p.pres, 2)); assert.equal(await cant(p, w.A), 3)
    const r1 = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r1.r.devuelto, true); assert.equal(await cant(p, w.A), 5); assert.equal(await cant(p, w.C), 8)
    const r2 = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r2.r.devuelto, false); assert.equal(await cant(p, w.A), 5)
    assert.equal(await nMov(p, w.A), 2, 'venta + devolución, sin duplicar')
  })
  test('D2 una venta LIBRE (sin control en la sucursal) no genera devolución de stock', async () => {
    const p = await prod(w.E1, 'D2', true); await fila(p, w.A, 0, true); await fila(p, w.B, 6, false)
    const id = await pedidoDe(await vender(w.E1, w.B, p.pres, 2)); const r = await one('select devolver_stock_pedido($1,$2) r', w.E1, id)
    assert.equal(r.r.devuelto, false); assert.equal(await cant(p, w.B), 6); assert.equal(await nMov(p), 0)
  })
  test('D3 si DESPUÉS de la venta se quita el control en esa sucursal, la devolución sigue la decisión histórica del libro (no inventa ni omite)', async () => {
    const p = await prod(w.E1, 'D3', true); await fila(p, w.A, 5, true)
    const id = await pedidoDe(await vender(w.E1, w.A, p.pres, 2)); await q('update producto_stock set controla=false where producto_id=$1', [p.id])
    const r = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r.r.devuelto, true); assert.equal(await cant(p, w.A), 5)
    assert.equal((await one('select controla c from producto_stock where producto_id=$1', p.id)).c, false, 'la devolución no reactiva el control')
  })
})

describe('DEVOLUCIÓN HISTÓRICA (pedido sin movimientos de venta): decide la fila de la sucursal, no el agregado', () => {
  // simula un pedido anterior al libro: se borran sus movimientos 'venta' y se deja stock_descontado = true
  const sinLibro = async (id: string) => { await q("delete from stock_movimientos where pedido_id=$1 and motivo='venta'", [id]); await q('update pedidos set stock_descontado=true where id=$1', [id]) }
  const flag = (p: { id: string }, v: boolean) => q('update productos set controla_stock=$2 where id=$1', [p.id, v])
  test('H1 producto controlado EN LA SUCURSAL con agregado global FALSO: devuelve', async () => {
    const p = await prod(w.E1, 'H1', false); await fila(p, w.A, 5, true)
    const id = await pedidoDe(await vender(w.E1, w.A, p.pres, 2)); assert.equal(await cant(p, w.A), 3)
    await sinLibro(id); assert.equal((await one('select controla_stock c from productos where id=$1', p.id)).c, false)
    const r = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r.r.devuelto, true); assert.equal(r.r.movimientos, 1); assert.equal(await cant(p, w.A), 5)
  })
  test('H2 producto NO controlado en esa sucursal con agregado global VERDADERO: no devuelve', async () => {
    const p = await prod(w.E1, 'H2', true); await fila(p, w.A, 4, true); await fila(p, w.B, 6, false)
    const id = await pedidoDe(await vender(w.E1, w.B, p.pres, 2)); await sinLibro(id)
    const r = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r.r.movimientos, 0); assert.equal(Number(r.r.unidades), 0)
    assert.equal(await cant(p, w.B), 6); assert.equal(await cant(p, w.A), 4); assert.equal(await nMov(p), 0)
  })
  test('H2b sin fila en la sucursal del pedido y agregado verdadero: tampoco devuelve', async () => {
    const p = await prod(w.E1, 'H2b', true); await fila(p, w.A, 4, true)
    const id = await pedidoDe(await vender(w.E1, w.C, p.pres, 1)); await sinLibro(id)
    const r = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r.r.movimientos, 0); assert.equal(await cant(p, w.C), undefined)
  })
  test('H3 pedido histórico de producto RAMA: conserva el criterio anterior (se selecciona por el flag del producto, sin exigir fila controlada)', async () => {
    const p = await prod(w.E1, 'H3', true); await fila(p, w.A, 0, false)     // fila SIN control en la sucursal: si exigiera control por fila, no se seleccionaría
    const id = await pedidoDe(await vender(w.E1, w.A, p.pres, 1)); await sinLibro(id)
    await q("update productos set modelo_stock='rama' where id=$1", [p.id])
    const m = await err(() => q('select devolver_stock_pedido($1,$2) r', [w.E1, id]))
    assert.match(m!, /PRODUCTO_MODELO_RAMA/, 'el producto rama entró a la devolución (y ajustar_stock lo rechaza como antes): no fue filtrado por producto_stock.controla')
    assert.equal((await one('select stock_descontado d from pedidos where id=$1', id)).d, true, 'rollback: el flag no se tocó')
  })
  test('H4 pedido CON libro de venta: decide el libro; ni el agregado global ni la marca actual de la fila intervienen', async () => {
    const p = await prod(w.E1, 'H4', true); await fila(p, w.A, 5, true)
    const id = await pedidoDe(await vender(w.E1, w.A, p.pres, 2)); assert.equal(await cant(p, w.A), 3)
    await flag(p, false); await q('update producto_stock set controla=false where producto_id=$1', [p.id])    // agregado falso Y fila sin control HOY
    const r = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r.r.devuelto, true); assert.equal(r.r.movimientos, 1); assert.equal(await cant(p, w.A), 5)
    const r2 = await one('select devolver_stock_pedido($1,$2) r', w.E1, id); assert.equal(r2.r.devuelto, false)    // idempotente
  })
  test('H5 el cuerpo de la función ya no consulta pr.controla_stock en el fallback de producto', async () => {
    const src = (await one("select prosrc from pg_proc where proname='devolver_stock_pedido'")).prosrc as string
    assert.ok(!/pr\.controla_stock\s*=\s*true\s+and\s+exists/.test(src)); assert.match(src, /pr\.modelo_stock = 'rama' then pr\.controla_stock = true/)
  })
})

describe('ARQUEO Y AJUSTE GENERAL: solo lo que ESA sucursal controla', () => {
  const U = 'aaaaaaaa-0000-4000-8000-000000000001'
  test('C1 iniciar_conteo_stock lista solo los productos controlados en la sucursal del conteo (mezcla controlados / libres)', async () => {
    const x = await prod(w.E1, 'C1x', true), y = await prod(w.E1, 'C1y', true), z = await prod(w.E1, 'C1z', false)
    const suc = (await one("insert into sucursales(empresa_id, nombre) values($1,'C1') returning id", w.E1)).id as string
    await fila(x, suc, 4, true); await fila(y, suc, 2, false); await fila(z, suc, 9, false)
    const r = await one('select iniciar_conteo_stock($1,$2,$3,$4) r', w.E1, suc, U, 'Luci')
    const nombres = (r2: Row) => (r2.r.items as Row[]).map(i => i.nombre as string)
    assert.ok(nombres(r).includes('C1x')); assert.ok(!nombres(r).includes('C1y'), 'y controla en otra sucursal pero acá no'); assert.ok(!nombres(r).includes('C1z'), 'z no controla')
    // (los productos por RAMA conservan su criterio anterior —control del producto— y pueden figurar: no se tocan)
    const otra = (await one("insert into sucursales(empresa_id, nombre) values($1,'C1b') returning id", w.E1)).id as string; await fila(y, otra, 1, true)
    const r2 = await one('select iniciar_conteo_stock($1,$2,$3,$4) r', w.E1, otra, U, 'Luci')
    assert.ok(nombres(r2).includes('C1y')); assert.ok(!nombres(r2).includes('C1x'))
  })
  test('C2 crear_arqueo_stock: producto no controlado en esa sucursal → PRODUCTO_INVALIDO sin escribir; controlado → teórico = existencia de ESA sucursal', async () => {
    const p = await prod(w.E1, 'C2', true); const suc = (await one("insert into sucursales(empresa_id, nombre) values($1,'C2') returning id", w.E1)).id as string
    await fila(p, w.A, 7, true); await fila(p, suc, 3, false)
    const it = JSON.stringify([{ producto_id: p.id, fisico: 6 }])
    assert.match((await err(() => q("select crear_arqueo_stock($1,$2,'completo','caja',null,$3::jsonb)", [w.E1, suc, it])))!, /PRODUCTO_INVALIDO/)
    assert.equal(Number((await one('select count(*) n from arqueos_stock where sucursal_id=$1', suc)).n), 0)
    const ok = await one("select crear_arqueo_stock($1,$2,'completo','caja',null,$3::jsonb) r", w.E1, w.A, it)
    assert.equal(Number((await one('select teorico t from arqueo_items where arqueo_id=$1', ok.r.arqueo_id)).t), 7)
  })
  test('C3 ajuste general (_calcular_ajuste_stock): producto no controlado en la sucursal → PRODUCTO_INVALIDO; controlado → calcula contra SU existencia', async () => {
    const p = await prod(w.E1, 'C3', true); const suc = (await one("insert into sucursales(empresa_id, nombre) values($1,'C3') returning id", w.E1)).id as string
    await fila(p, suc, 10, true)
    const lote = (await one('select iniciar_conteo_stock($1,$2,$3,$4) r', w.E1, suc, U, 'Luci')).r.lote_id as string
    const r = await one("select _calcular_ajuste_stock($1,$2,$3,'conteo','x',$4::jsonb) r", w.E1, suc, lote, JSON.stringify([{ producto_id: p.id, contado: 8 }]))
    assert.equal(r.r.items[0].actual, 10); assert.equal(r.r.items[0].final, 8)
    await q('update producto_stock set controla=false where producto_id=$1 and sucursal_id=$2', [p.id, suc])
    assert.match((await err(() => q("select _calcular_ajuste_stock($1,$2,$3,'conteo','x',$4::jsonb)", [w.E1, suc, lote, JSON.stringify([{ producto_id: p.id, contado: 8 }])])))!, /PRODUCTO_INVALIDO/)
  })
})
