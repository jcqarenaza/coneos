#!/usr/bin/env bash
# Migración · reversión · re-aplicación · respaldos acumulativos · mutaciones de verificación.
# PostgreSQL aislado en /tmp:54399. Nunca toca la base compartida.
cd "$(dirname "$0")"; P="psql -h /tmp -p 54399 -U postgres -d mf -q -At"; ok=0; bad=0
chk(){ if [ "$2" = "$3" ]; then echo "OK    $1"; ok=$((ok+1)); else echo "FALLA $1 (esperado '$3', obtuve '$2')"; bad=$((bad+1)); fi; }
EA=aaaaaaaa-0000-0000-0000-000000000001; EB=bbbbbbbb-0000-0000-0000-000000000001; EC=cccccccc-0000-0000-0000-000000000001
P1=10000000-0000-0000-0000-000000000001; P3=10000000-0000-0000-0000-000000000003; R1=30000000-0000-0000-0000-000000000001
U(){ echo "https://x.supabase.co/storage/v1/object/public/productos/$1.jpg"; }
fresh(){ psql -h /tmp -p 54399 -U postgres -qc "drop database if exists mf" -c "create database mf" 2>/dev/null; $P -v ON_ERROR_STOP=1 -f 00-base-sintetica.sql >/dev/null; }
ver(){ $P -c "select coalesce(sum(version),0) from catalogo_version where empresa_id='$1'"; }
SNAP="select md5(string_agg(id::text||coalesce(imagen_url,'~'),'|' order by id)) from (select id,imagen_url from productos union all select id,imagen_url from presentaciones) x"
TABLA_MD5="select md5(string_agg(t::text,'|' order by id)) from (select id,empresa_id,producto_id,presentacion_id,url,orden,es_principal,created_at from producto_imagenes) t"
BAK_MD5(){ $P -c "select md5(string_agg(t::text,'|' order by id)) from (select id,empresa_id,producto_id,presentacion_id,url,orden,es_principal,created_at from producto_imagenes_respaldo where respaldo_id='$1') t"; }
add(){ $P -c "set role service_role; insert into producto_imagenes(empresa_id,producto_id,presentacion_id,url,orden) values ('$1','$2',$3,'$(U $4)',$5)" >/dev/null; }
principal(){ $P -c "set role service_role; select set_imagen_principal(id) from producto_imagenes where url='$(U $1)'" >/dev/null; }
img_prod(){ $P -c "select imagen_url from productos where id='$1'"; }
img_pres(){ $P -c "select coalesce(imagen_url,'~') from presentaciones where id='$1'"; }
run(){ $P -v ON_ERROR_STOP=1 -f "$1" 2>&1; }

fresh; S0=$($P -c "$SNAP")
run ../01-multi-fotos-correccion.sql >/dev/null; chk "M01 aplica 01 sin error" "$?" "0"
chk "M02 migra 4 fotos de producto (con espacios y producto borrado; sin vacías/NULL)" "$($P -c "select count(*) from producto_imagenes where presentacion_id is null")" "4"
chk "M03 migra 2 fotos de presentación" "$($P -c "select count(*) from producto_imagenes where presentacion_id is not null")" "2"
chk "M04 todas quedan como principal (una por ámbito)" "$($P -c "select count(*) from producto_imagenes where es_principal")" "6"
chk "M05 url migrada sin espacios" "$($P -c "select url from producto_imagenes where producto_id='$P3'")" "$(U p3)"
chk "M06 la migración NO modifica imagen_url (compat 100%)" "$($P -c "$SNAP")" "$S0"
chk "M07 producto sin foto / foto vacía no genera fila" "$($P -c "select count(*) from producto_imagenes where producto_id in ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004')")" "0"
run ../01-multi-fotos-correccion.sql >/dev/null; chk "M08 correr 01 por segunda vez aborta" "$?" "3"
chk "M09 …y la tabla sigue intacta (6 filas)" "$($P -c "select count(*) from producto_imagenes")" "6"

# ── Ciclo 1: fotos extra → revertir ──────────────────────────────────────────────
add $EA $P1 null extra1 1; add $EA $P1 $'\'30000000-0000-0000-0000-000000000001\'' rextra1 1; principal extra1
chk "M10 imagen_url del producto refleja la nueva principal" "$(img_prod $P1)" "$(U extra1)"
chk "M11 base-aislada: 8 fotos antes de revertir" "$($P -c "select count(*) from producto_imagenes")" "8"
T1=$($P -c "$TABLA_MD5"); PR1=$(img_prod $P1); PRR1=$(img_pres $R1)
vA=$(ver $EA); vB=$(ver $EB); vC=$(ver $EC)
OUT=$(run ../02-multi-fotos-reversion.sql); chk "M12 revierte (#1) sin error" "$?" "0"
chk "M13 tabla, funciones y triggers de multi-fotos eliminados" "$($P -c "select (to_regclass('public.producto_imagenes') is null)::int + (select count(*)=0 from pg_proc where proname like 'fn_producto_imagenes%' or proname in ('set_imagen_principal','reordenar_imagenes'))::int")" "2"
ID1=$($P -c "select respaldo_id from producto_imagenes_respaldo_log order by respaldado_at limit 1")
chk "M14 respaldo #1: registrado en el log con 8 filas, 2 empresas (A y B) y fecha" "$($P -c "select filas||'/'||empresas||'/'||(respaldado_at is not null) from producto_imagenes_respaldo_log where respaldo_id='$ID1'")" "8/2/true"
chk "M15 respaldo #1: 8 filas reales y contenido idéntico a la tabla original (md5)" "$($P -c "select count(*) from producto_imagenes_respaldo where respaldo_id='$ID1'")/$(BAK_MD5 $ID1)" "8/$T1"
chk "M16 imagen_url conserva la principal vigente tras revertir #1 (producto y presentación)" "$(img_prod $P1)|$(img_pres $R1)" "$(U extra1)|$PRR1"
chk "M17 imagen_url idéntica a la de antes de revertir" "$(img_prod $P1)" "$PR1"
chk "M18 bump: empresas con fotos (A) refrescada" "$([ "$(ver $EA)" -gt "$vA" ] && echo si || echo no)" "si"
chk "M19 bump: empresa sin fotos (C) NO refrescada" "$(ver $EC)" "$vC"

# ── Acceso a los respaldos ──────────────────────────────────────────────────────
acc=""; for r in anon authenticated service_role; do for t in producto_imagenes_respaldo producto_imagenes_respaldo_log; do acc="$acc$($P -c "select has_table_privilege('$r','public.$t','select')::int + has_table_privilege('$r','public.$t','insert')::int + has_table_privilege('$r','public.$t','update')::int + has_table_privilege('$r','public.$t','delete')::int")"; done; done
chk "M20 respaldos: anon, authenticated y service_role SIN ningún privilegio (select/insert/update/delete)" "$acc" "000000"
chk "M21 respaldos: lectura real como service_role rechazada" "$($P -c "set role service_role; select count(*) from producto_imagenes_respaldo" 2>&1 | grep -c 'permission denied')" "1"
chk "M22 respaldos: lectura real como authenticated rechazada" "$($P -c "set role authenticated; select count(*) from producto_imagenes_respaldo_log" 2>&1 | grep -c 'permission denied')" "1"
chk "M23 respaldos: RLS activada" "$($P -c "select count(*) from pg_class where relname in ('producto_imagenes_respaldo','producto_imagenes_respaldo_log') and relrowsecurity")" "2"
chk "M24 bump_catalogo_empresa: firma y definición reales (uuid → void, SECURITY DEFINER)" "$($P -c "select pg_get_function_identity_arguments(oid)||'|'||prorettype::regtype||'|'||prosecdef from pg_proc where proname='bump_catalogo_empresa'")" "p_empresa uuid|void|true"

# ── Ciclo 2: reaplicar → más fotos → revertir de nuevo ────────────────────────────
run ../01-multi-fotos-correccion.sql >/dev/null; chk "M25 re-aplicar 01 tras revertir funciona" "$?" "0"
chk "M26 …y migra la principal vigente (6 filas)" "$($P -c "select count(*) from producto_imagenes")" "6"
chk "M27 …la principal migrada del producto es la que había quedado (extra1)" "$($P -c "select url from producto_imagenes where producto_id='$P1' and presentacion_id is null and es_principal")" "$(U extra1)"
add $EA $P1 null extra2 1; add $EA $P3 null p3extra 1; add $EA $P1 $'\'30000000-0000-0000-0000-000000000001\'' rextra2 1; principal p3extra
T2=$($P -c "$TABLA_MD5"); N2=$($P -c "select count(*) from producto_imagenes")
vA=$(ver $EA); vB=$(ver $EB); vC=$(ver $EC)
run ../02-multi-fotos-reversion.sql >/dev/null; chk "M28 revierte (#2) sin error" "$?" "0"
chk "M29 log acumulado: 2 capturas con UUID distintos" "$($P -c "select count(*)||'/'||count(distinct respaldo_id) from producto_imagenes_respaldo_log")" "2/2"
ID2=$($P -c "select respaldo_id from producto_imagenes_respaldo_log where respaldo_id<>'$ID1'")
chk "M30 captura #1 CONSERVADA: mismas 8 filas y mismo contenido (md5)" "$($P -c "select count(*) from producto_imagenes_respaldo where respaldo_id='$ID1'")/$(BAK_MD5 $ID1)" "8/$T1"
chk "M31 captura #2: $N2 filas y contenido idéntico a la tabla antes de revertir" "$($P -c "select count(*) from producto_imagenes_respaldo where respaldo_id='$ID2'")/$(BAK_MD5 $ID2)" "$N2/$T2"
chk "M32 cada captura contiene SUS fotos: #1 tiene extra1 y no extra2; #2 tiene extra2 y no extra1 como adicional" "$($P -c "select (count(*) filter (where respaldo_id='$ID1' and url='$(U extra1)'))||'/'||(count(*) filter (where respaldo_id='$ID1' and url='$(U extra2)'))||'/'||(count(*) filter (where respaldo_id='$ID2' and url='$(U extra2)'))||'/'||(count(*) filter (where respaldo_id='$ID2' and url='$(U p3extra)')) from producto_imagenes_respaldo")" "1/0/1/1"
chk "M33 total acumulado = suma de capturas (8 + $N2)" "$($P -c "select count(*) from producto_imagenes_respaldo")" "$((8+N2))"
chk "M34 log: filas de cada captura coinciden con las reales" "$($P -c "select count(*) from producto_imagenes_respaldo_log l where filas <> (select count(*) from producto_imagenes_respaldo r where r.respaldo_id=l.respaldo_id)")" "0"
chk "M35 imagen_url conserva la principal vigente tras revertir #2 (p3extra en P3, extra1 en P1)" "$(img_prod $P3)|$(img_prod $P1)" "$(U p3extra)|$(U extra1)"
chk "M36 bump #2: A refrescada, C no" "$([ "$(ver $EA)" -gt "$vA" ] && echo si || echo no)|$(ver $EC)" "si|$vC"
chk "M37 respaldos siguen sin acceso para service_role tras la 2ª ejecución" "$($P -c "set role service_role; select count(*) from producto_imagenes_respaldo" 2>&1 | grep -c 'permission denied')" "1"
chk "M38 triggers bump_catalogo originales de productos/presentaciones siguen" "$($P -c "select count(*) from pg_trigger where tgname='bump_catalogo' and not tgisinternal")" "2"
run ../02-multi-fotos-reversion.sql | grep -q "no hay nada que revertir"; chk "M39 02 sin tabla: error claro y no crea respaldos nuevos" "$($P -c "select count(*) from producto_imagenes_respaldo_log")" "2"

# ── Mutaciones: la verificación DEBE abortar y no dejar nada ───────────────────────────
mut01(){ # $1 nombre  $2 sed
  fresh; local S=$($P -c "$SNAP"); sed -E "$2" ../01-multi-fotos-correccion.sql > /tmp/mut01.sql
  local o; o=$($P -v ON_ERROR_STOP=1 -f /tmp/mut01.sql 2>&1); local rc=$?
  chk "$1: aborta" "$([ $rc -ne 0 ] && echo si || echo no)" "si"
  chk "$1: mensaje correcto" "$(echo "$o" | grep -c "$3")" "1"
  chk "$1: no queda tabla ni funciones y imagen_url intacta" "$($P -c "select (to_regclass('public.producto_imagenes') is null)::int")|$($P -c "$SNAP")" "1|$S"
}
mut01 "X01 presentaciones: url migrada distinta de imagen_url" "s/btrim\(pr\.imagen_url\), 0, true/btrim(pr.imagen_url) || 'zz', 0, true/" "IMAGEN_URL_DESINCRONIZADA (presentaciones)"
mut01 "X02 productos: url migrada distinta de imagen_url" "s/btrim\(p\.imagen_url\), 0, true/btrim(p.imagen_url) || 'zz', 0, true/" "IMAGEN_URL_DESINCRONIZADA (productos)"
mut01 "X03 falta una foto de presentación (cantidades)" "s/where pr\.imagen_url is not null and btrim\(pr\.imagen_url\) <> ''\;/where pr.imagen_url is not null and btrim(pr.imagen_url) <> '' and pr.id <> '30000000-0000-0000-0000-000000000001';/" "MIGRACION_DESCUADRADA"
mut01 "X04 falta una foto de producto (cantidades)" "s/where p\.imagen_url is not null and btrim\(p\.imagen_url\) <> ''\;/where p.imagen_url is not null and btrim(p.imagen_url) <> '' and p.id <> '10000000-0000-0000-0000-000000000001';/" "MIGRACION_DESCUADRADA"

mut02(){ # $1 nombre  $2 sed  $3 mensaje
  fresh; run ../01-multi-fotos-correccion.sql >/dev/null; add $EA $P1 null extra1 1; add $EA $P3 null p3extra 1
  local n0=$($P -c "select count(*) from producto_imagenes"); local S=$($P -c "$SNAP"); local T=$($P -c "$TABLA_MD5")
  sed -E "$2" ../02-multi-fotos-reversion.sql > /tmp/mut02.sql
  local o; o=$($P -v ON_ERROR_STOP=1 -f /tmp/mut02.sql 2>&1); local rc=$?
  chk "$1: aborta" "$([ $rc -ne 0 ] && echo si || echo no)" "si"
  chk "$1: mensaje correcto" "$(echo "$o" | grep -c "$3")" "1"
  chk "$1: la tabla NO se borró y conserva todas sus filas" "$($P -c "select count(*) from producto_imagenes")/$($P -c "$TABLA_MD5")" "$n0/$T"
  chk "$1: no queda respaldo a medias (rollback total) e imagen_url intacta" "$($P -c "select coalesce(to_regclass('public.producto_imagenes_respaldo')::text,'-')")|$($P -c "$SNAP")" "-|$S"
}
mut02 "X05 respaldo incompleto" "s/    from public\.producto_imagenes i;/    from public.producto_imagenes i where i.orden = 0;/" "RESPALDO_INCOMPLETO"
mut02 "X06 respaldo con contenido distinto" "s/select v_id, v_at, i\.id, i\.empresa_id, i\.producto_id, i\.presentacion_id, i\.url,/select v_id, v_at, i.id, i.empresa_id, i.producto_id, i.presentacion_id, i.url || 'x',/" "RESPALDO_DISTINTO"

echo; echo "$ok OK / $bad FALLA"; [ $bad -eq 0 ]
