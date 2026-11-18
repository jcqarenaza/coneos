// GUARDA DEL CONJUNTO EXACTO DE COMPATIBILIDAD (CTO 18/11): la migración REAL (sin reemplazar la lista aprobada) contra un mundo local con los
// IDENTIFICADORES REALES de cones-prod (Cecchetto 17 + Federal 1 + Demoburger 0 = 18). Postgres 16 local descartable; NO es Supabase.
// Ejecutar: npx tsx --test src/lib/__tests__/stock-control-compat-exacto-sql.test.ts
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const SUP = join(process.cwd(), 'supabase')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const SCRIPT = readFileSync(join(SUP, 'stock-control-por-sucursal.sql'), 'utf8')
const CEC = 'cdd77401-6b81-474f-b96c-8faaca1476fd', FED = 'ce000000-0000-0000-0000-000000000001', DEMO = '3dffcc70-eff0-4966-885b-a67a0dc1078f'
const COPA = '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', BOMB = '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', BALDE = '75389763-f394-43e2-8e0d-de2fba3fa892'
const PRUEBA = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b', PRUEBA2 = '76ab690b-7ae8-4b0b-bc68-de37cb9e9d8e', DELIVERY = 'ce000000-0000-0000-0000-000000000010'
const THTTP = ['1cb2edb3-ff60-4936-b52f-aed428f0af36', '2b12e277-ed2f-4acb-a6c8-22a2d4ac9824', '34d3e753-ef8b-4519-97cd-9a633e004635', '445200ac-85b3-4423-b252-61a8c0134a5c',
  '6a9b48be-9991-40e2-aa18-6142602241f0', 'd9093b39-2205-4b91-962f-018a6e647ed9', 'e0276f5c-39e8-4e7a-9fa3-d2a04c400d68', 'f1d9b8f8-695a-42a3-9a38-16597fe279c7']
const MOV_COPA = '7cd5947e-41eb-410f-b312-242bb5e6101e'
let admin: pg.Client
const dbs: string[] = []

async function mundo(nombre: string) {
  await admin.query(`drop database if exists ${nombre} with (force)`); await admin.query(`create database ${nombre}`); dbs.push(nombre)
  const p = new pg.Pool({ ...SOCK, database: nombre, max: 3 }); p.on('error', () => {})
  for (const f of ['tests/stock-v2/00-schema-reducido.sql', 'tests/stock-por-sucursal/00-extras.sql']) await p.query(readFileSync(join(SUP, f), 'utf8'))
  for (const e of [CEC, FED, DEMO]) await p.query('insert into empresas(id) values($1)', [e])
  for (const s of [PRUEBA, PRUEBA2, ...THTTP]) await p.query('insert into sucursales(id, empresa_id, nombre) values($1,$2,$3)', [s, CEC, 'S'])
  await p.query('insert into sucursales(id, empresa_id, nombre) values($1,$2,$3)', [DELIVERY, FED, 'Cecchetto Delivery'])
  for (const [id, e] of [[COPA, CEC], [BOMB, CEC], [BALDE, FED]]) await p.query("insert into productos(id, empresa_id, nombre, controla_stock, modelo_stock) values($1,$2,'P',true,'producto')", [id, e])
  // filas existentes de cones-prod (antes de migrar): Copa/Prueba = 5 con su movimiento; Bomboncitos en Prueba y Prueba 2
  await p.query('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad) values($1,$2,$3,5),($1,$4,$3,2),($1,$4,$5,0)', [CEC, COPA, PRUEBA, BOMB, PRUEBA2])
  await p.query("insert into stock_movimientos(id, empresa_id, sucursal_id, producto_id, delta, motivo, detalle) values($1,$2,$3,$4,5,'ajuste','alta')", [MOV_COPA, CEC, PRUEBA, COPA])
  return p
}
const col = async (p: pg.Pool) => (await p.query("select 1 from information_schema.columns where table_name='producto_stock' and column_name='controla'")).rows.length
const intacto = async (p: pg.Pool) => {
  assert.equal(await col(p), 0, 'no quedó la columna'); assert.equal((await p.query('select count(*) n from producto_stock')).rows[0].n, '3')
  assert.equal((await p.query('select count(*) n from stock_movimientos')).rows[0].n, '1')
  assert.equal((await p.query("select count(*) n from pg_proc where prosrc like '%v1.9%'")).rows[0].n, '0')
}
const aplicar = (p: pg.Pool, sql = SCRIPT) => p.query(sql).then(() => null, (e: Error) => e.message)

before(async () => { admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect() })
after(async () => { for (const d of dbs) await admin.query(`drop database if exists ${d} with (force)`); await admin.end() })

describe('GUARDA: conjunto exacto 18 = 17 a insertar + 1 liberada (listas embebidas en el SQL, sin reemplazos)', () => {
  test('E0 aprobada: 17 pares únicos (cecchetto 16, federal 1, demoburger 0); liberada: 1 (Copa Sport × Prueba 2); disjuntas; unión = 18', () => {
    const pares = (m: string) => [...SCRIPT.match(new RegExp(`-- >>> ${m}([\\s\\S]*?)-- <<< ${m}`))![1].matchAll(/\('([0-9a-f-]{36})', '([0-9a-f-]{36})', '([0-9a-f-]{36})'\)/g)].map(x => x.slice(1, 4))
    const ap = pares('LISTA_APROBADA'), li = pares('LISTA_LIBERADA')
    assert.equal(ap.length, 17); assert.equal(new Set(ap.map(x => x[1] + x[2])).size, 17)
    assert.equal(ap.filter(x => x[0] === CEC).length, 16); assert.equal(ap.filter(x => x[0] === FED).length, 1); assert.equal(ap.filter(x => x[0] === DEMO).length, 0)
    assert.deepEqual(li, [[CEC, COPA, PRUEBA2]])
    assert.equal(new Set([...ap, ...li].map(x => x[1] + x[2])).size, 18)
  })

  test('E1 mundo con los IDs reales: la migración SIN modificar pasa, inserta exactamente las 17, deja Copa Sport × Prueba 2 SIN fila y Copa Sport/Prueba y su movimiento intactos', async () => {
    const p = await mundo('ctl_exacto_1')
    try {
      assert.equal(await aplicar(p), null)
      const t = (await p.query('select count(*) n from producto_stock')).rows[0].n; assert.equal(t, '20')   // 3 previas + 17
      const porEmp = (await p.query("select empresa_id, count(*) n from producto_stock where cantidad = 0 and controla and not (producto_id = $1 and sucursal_id = $2) and not (producto_id = $3 and sucursal_id = $4) group by 1 order by 1", [BOMB, PRUEBA2, COPA, PRUEBA])).rows
      assert.deepEqual(porEmp.map(x => [x.empresa_id, x.n]).sort(), [[CEC, '16'], [FED, '1']].sort())
      assert.equal((await p.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [COPA, PRUEBA])).rows[0].cantidad, 5)
      assert.deepEqual((await p.query('select id, delta from stock_movimientos')).rows, [{ id: MOV_COPA, delta: '5' }])
      assert.equal((await p.query("select count(*) n from producto_stock where empresa_id=$1", [DEMO])).rows[0].n, '0')
      assert.equal((await p.query('select count(*) n from producto_stock where producto_id=$1 and sucursal_id=$2', [COPA, PRUEBA2])).rows[0].n, '0')   // liberada: sin fila = vende libre
    } finally { await p.end() }
  })

  test('E2 FALTA una fila aprobada (ese par ya tiene fila): aborta antes de modificar nada', async () => {
    const p = await mundo('ctl_exacto_2')
    try {
      await p.query('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad) values($1,$2,$3,0)', [CEC, BOMB, THTTP[0]])
      const m = await aplicar(p); assert.match(m!, /COMPAT_CONJUNTO_NO_COINCIDE: faltan filas aprobadas/); assert.ok(m!.includes(`${CEC}/${BOMB}/${THTTP[0]}`))
      assert.equal(await col(p), 0); assert.equal((await p.query('select count(*) n from producto_stock')).rows[0].n, '4')
    } finally { await p.end() }
  })

  test('E3 SOBRA una fila: sucursal creada después del relevamiento en Cecchetto (aparecen 2 pares nuevos): aborta y no amplía solo', async () => {
    const p = await mundo('ctl_exacto_3')
    try {
      await p.query("insert into sucursales(empresa_id, nombre) values($1,'Nueva')", [CEC])
      const m = await aplicar(p); assert.match(m!, /COMPAT_CONJUNTO_NO_COINCIDE: sobran filas ni aprobadas ni liberadas/); await intacto(p)
    } finally { await p.end() }
  })

  test('E4 SOBRA una fila: producto controlado nuevo en Federal (queda 2 en Federal) o en Demoburger (queda 1 donde debe haber 0): aborta', async () => {
    for (const [i, emp] of [[1, FED], [2, DEMO]] as const) {
      const p = await mundo(`ctl_exacto_4${i}`)
      try {
        if (emp === DEMO) await p.query("insert into sucursales(empresa_id, nombre) values($1,'D')", [DEMO])
        await p.query("insert into productos(empresa_id, nombre, controla_stock, modelo_stock) values($1,'Nuevo',true,'producto')", [emp])
        const m = await aplicar(p); assert.match(m!, /COMPAT_CONJUNTO_NO_COINCIDE: sobran filas ni aprobadas ni liberadas/)
        assert.ok(m!.includes(emp)); await intacto(p)
      } finally { await p.end() }
    }
  })

  test('E5 CAMBIA un identificador de la lista (un dígito del producto): aborta señalando falta y sobra', async () => {
    const p = await mundo('ctl_exacto_5')
    try {
      const alterado = SCRIPT.replace(`('${CEC}', '${BOMB}', '${THTTP[0]}')`, `('${CEC}', '${BOMB.slice(0, -1)}0', '${THTTP[0]}')`)
      assert.notEqual(alterado, SCRIPT)
      const m = await aplicar(p, alterado); assert.match(m!, /COMPAT_CONJUNTO_NO_COINCIDE/); await intacto(p)
    } finally { await p.end() }
  })

  test('E6 CAMBIA la empresa de un par de la lista: aborta', async () => {
    const p = await mundo('ctl_exacto_6')
    try {
      const alterado = SCRIPT.replace(`('${FED}', '${BALDE}', '${DELIVERY}')`, `('${CEC}', '${BALDE}', '${DELIVERY}')`)
      assert.notEqual(alterado, SCRIPT)
      assert.match((await aplicar(p, alterado))!, /COMPAT_CONJUNTO_NO_COINCIDE/); await intacto(p)
    } finally { await p.end() }
  })

  test('E7 lista con una fila de menos o de más (editada): aborta por la lista, no solo por el total', async () => {
    const p = await mundo('ctl_exacto_7')
    try {
      const menos = SCRIPT.replace(/\n  \('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', '1cb2edb3-ff60-4936-b52f-aed428f0af36'\),/, '')
      assert.notEqual(menos, SCRIPT); assert.match((await aplicar(p, menos))!, /COMPAT_CONJUNTO_NO_COINCIDE: faltan|sobran/); await intacto(p)
    } finally { await p.end() }
  })

  test('E8 segunda ejecución sobre el mundo ya migrado no duplica ni altera (guarda MIGRACION_YA_APLICADA primero)', async () => {
    const p = await mundo('ctl_exacto_8')
    try {
      assert.equal(await aplicar(p), null)
      const antes = (await p.query('select count(*) n, coalesce(sum(cantidad),0) s from producto_stock')).rows[0]
      assert.match((await aplicar(p))!, /MIGRACION_YA_APLICADA/)
      assert.deepEqual((await p.query('select count(*) n, coalesce(sum(cantidad),0) s from producto_stock')).rows[0], antes)
    } finally { await p.end() }
  })

  test('E9 verificaciones ampliadas: si algo altera el flag de un producto de rama o las filas con flag durante la migración, aborta (cobertura de prod_flag_rama / ps_filas_con_flag)', async () => {
    const p = await mundo('ctl_exacto_9')
    try {
      // un trigger que, al insertar una fila de compatibilidad, apaga el flag de OTRO producto controlado → ps_filas_con_flag deja de cuadrar
      await p.query(`create function apaga() returns trigger language plpgsql as $$ begin update productos set controla_stock=false where id='${BALDE}'; return new; end $$;
        create trigger t_apaga after insert on producto_stock for each row execute function apaga()`)
      const m = await aplicar(p); assert.match(m!, /VERIF: cambió el agregado productos\.controla_stock|VERIF: filas de productos con flag/); await intacto(p)
    } finally { await p.end() }
  })

  test('E10 prod_flag_rama se VERIFICA: si el flag de un producto de rama cambia durante la migración (sin cambiar el total de flags), aborta', async () => {
    const p = await mundo('ctl_exacto_10')
    try {
      const RAMA = (await p.query("insert into productos(empresa_id, nombre, controla_stock, modelo_stock) values($1,'Rama',true,'rama') returning id", [DEMO])).rows[0].id
      const LIBRE = (await p.query("insert into productos(empresa_id, nombre, controla_stock, modelo_stock) values($1,'Libre',false,'producto') returning id", [DEMO])).rows[0].id
      await p.query("alter table productos disable trigger user")   // el trigger de rama (flag obligatorio) no es lo que se prueba acá
      await p.query(`create function t_flag() returns trigger language plpgsql as $$ begin
          if new.producto_id = '${COPA}' and new.sucursal_id = '${THTTP[0]}' then
            update productos set controla_stock = false where id = '${RAMA}'; update productos set controla_stock = true where id = '${LIBRE}'; end if; return new; end $$;
        create trigger t_flag after insert on producto_stock for each row execute function t_flag()`)
      const m = await aplicar(p); assert.match(m!, /VERIF: cambió el flag de productos por rama/)
      assert.equal(await col(p), 0)
    } finally { await p.end() }
  })

  test('E11 ps_filas_con_flag se VERIFICA: si una fila de un producto con flag desaparece y aparece otra de un producto sin flag (mismo total), aborta', async () => {
    const p = await mundo('ctl_exacto_11')
    try {
      const LIBRE = (await p.query("insert into productos(empresa_id, nombre, controla_stock, modelo_stock) values($1,'Libre',false,'producto') returning id", [CEC])).rows[0].id
      await p.query(`create function t_filas() returns trigger language plpgsql as $$ begin
          if new.producto_id = '${COPA}' and new.sucursal_id = '${THTTP[0]}' then
            delete from producto_stock where producto_id = '${BOMB}' and sucursal_id = '${PRUEBA2}';
            insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad) values ('${CEC}', '${LIBRE}', '${THTTP[0]}', 0); end if; return new; end $$;
        create trigger t_filas after insert on producto_stock for each row execute function t_filas()`)
      const m = await aplicar(p); assert.match(m!, /VERIF: filas de productos con flag/)
      assert.equal(await col(p), 0)
    } finally { await p.end() }
  })

  test('E12 LIBERADA: si Copa Sport × Prueba 2 ya tiene fila antes de migrar, falta una liberada: aborta', async () => {
    const p = await mundo('ctl_exacto_12')
    try {
      await p.query('insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad) values($1,$2,$3,0)', [CEC, COPA, PRUEBA2])
      const m = await aplicar(p); assert.match(m!, /faltan filas aprobadas o liberadas/); assert.ok(m!.includes(`${CEC}/${COPA}/${PRUEBA2}`)); assert.equal(await col(p), 0)
    } finally { await p.end() }
  })

  test('E13 LIBERADA editada (otra sucursal) o vaciada: aborta, no se inserta ni se libera nada por otro camino', async () => {
    for (const [i, alterado] of [[1, SCRIPT.replace(`('${CEC}', '${COPA}', '${PRUEBA2}');  -- cecchetto · Copa Sport · Prueba 2`, `('${CEC}', '${COPA}', '${THTTP[0]}');  -- cecchetto · Copa Sport · Prueba 2`)],
                                  [2, SCRIPT.replace(/-- >>> LISTA_LIBERADA[\s\S]*?-- <<< LISTA_LIBERADA/, '')]] as const) {
      const p = await mundo(`ctl_exacto_13${i}`)
      try { assert.notEqual(alterado, SCRIPT); assert.match((await aplicar(p, alterado))!, /./); assert.equal(await col(p), 0) } finally { await p.end() }
    }
  })

  test('E14 LIBERADA pasada a la lista de inserción (vuelve a 18 insertadas): aborta por conteo (esperadas 17)', async () => {
    const p = await mundo('ctl_exacto_14')
    try {
      const s2 = SCRIPT.replace(`('${CEC}', '${COPA}', '${THTTP[0]}'),  -- cecchetto · Copa Sport`, `('${CEC}', '${COPA}', '${THTTP[0]}'),  -- cecchetto · Copa Sport\n  ('${CEC}', '${COPA}', '${PRUEBA2}'),`)
      assert.notEqual(s2, SCRIPT); assert.match((await aplicar(p, s2))!, /COMPAT_CONJUNTO_NO_COINCIDE|duplicate key/); assert.equal(await col(p), 0)
    } finally { await p.end() }
  })

  test('E15 verificación final de liberadas: si algo crea una fila en Copa Sport × Prueba 2 durante la migración, aborta', async () => {
    const p = await mundo('ctl_exacto_15')
    try {
      await p.query(`create function t_lib() returns trigger language plpgsql as $$ begin
          if new.producto_id = '${COPA}' and new.sucursal_id = '${THTTP[0]}' then
            insert into producto_stock(empresa_id, producto_id, sucursal_id, cantidad) values ('${CEC}', '${COPA}', '${PRUEBA2}', 0); end if; return new; end $$;
        create trigger t_lib after insert on producto_stock for each row execute function t_lib()`)
      const m = await aplicar(p); assert.match(m!, /VERIF/); assert.equal(await col(p), 0)
    } finally { await p.end() }
  })
})
