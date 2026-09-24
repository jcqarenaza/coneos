-- EQUIPO V1 · único SQL del ciclo (orden CTO 24/09 tras STOP en E6).
-- La base tenía CHECK (rol in ('cadete','otro')): el comodín prohibido y sin
-- el Mozo ordenado. Precondición verificada: solo existían filas 'cadete' (3).
-- El constraint queda como guardián del modelo sellado: Cadete y Mozo, sin "Otro".
alter table colaboradores drop constraint colaboradores_rol_check;
alter table colaboradores add constraint colaboradores_rol_check check (rol in ('cadete', 'mozo'));
