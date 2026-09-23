-- 📅 HORARIO POR DÍAS (ciclo 23/09)
-- dias_apertura: días en los que puede COMENZAR una jornada (0=domingo…6=sábado).
--   null o vacío = los 7 días (inercia total).
-- horario_por_dia: 🗓️ modo por-día (L-V un horario, S-D otro — caso Cecchetto).
--   Mapa {"0":[{desde,hasta}],...}. null = modo simple (horario_general para todos).
alter table sucursales add column if not exists dias_apertura smallint[];
alter table sucursales add column if not exists horario_por_dia jsonb;
