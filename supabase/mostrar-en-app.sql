-- CICLO CANALES VISIBLES (espec JC 22/09): ¿este canal aparece en la puerta
-- pública (App)? Default true = migración conserva el comportamiento actual.
-- NO toca URLs directas, QRs, tokens, mesas, operación ni APIs de pedidos.
alter table delivery_config add column if not exists mostrar_en_app boolean not null default true;
alter table takeaway_config add column if not exists mostrar_en_app boolean not null default true;
