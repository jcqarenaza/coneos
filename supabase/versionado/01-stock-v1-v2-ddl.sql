-- REFERENCIA VERSIONADA — volcado de la base el 2026-11-04 — NO ES MIGRACIÓN, NO APLICAR
-- Proyecto Supabase: wpiwjpvjqshsgrxxwsld (ConeOS). Schema public.
-- Grupo 1: stock v1 (producto_stock), stock v2 (articulos, articulo_stock,
-- articulo_presentaciones_compra), movimientos y arqueos.
-- DDL reconstruido desde el catálogo (pg_attribute, pg_get_constraintdef,
-- pg_indexes, pg_get_triggerdef, pg_policies). Las dependencias cruzadas
-- (p. ej. stock_movimientos -> comprobantes_compra/remitos_compra) están en 02.
-- Los índices que respaldan un constraint figuran comentados "(respalda constraint)".

-- ======================================================================
-- TABLA public.producto_stock
-- ======================================================================
CREATE TABLE public.producto_stock (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  cantidad integer DEFAULT 0 NOT NULL,
  stock_minimo integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT producto_stock_pkey PRIMARY KEY (id),
  CONSTRAINT producto_stock_producto_id_sucursal_id_key UNIQUE (producto_id, sucursal_id),
  CONSTRAINT producto_stock_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT producto_stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT producto_stock_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  CONSTRAINT producto_stock_cantidad_check CHECK ((cantidad >= 0)),
  CONSTRAINT producto_stock_stock_minimo_check CHECK ((stock_minimo >= 0))
);

-- Índices
CREATE INDEX idx_producto_stock_sucursal ON public.producto_stock USING btree (sucursal_id);
-- (respalda constraint) CREATE UNIQUE INDEX producto_stock_pkey ON public.producto_stock USING btree (id);
-- (respalda constraint) CREATE UNIQUE INDEX producto_stock_producto_id_sucursal_id_key ON public.producto_stock USING btree (producto_id, sucursal_id);

-- Triggers
CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.producto_stock FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();

-- RLS
ALTER TABLE public.producto_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_gestiona_producto_stock ON public.producto_stock AS PERMISSIVE FOR ALL TO public
  USING ((empresa_id = auth_empresa_id()))
  WITH CHECK ((empresa_id = auth_empresa_id()));
CREATE POLICY admin_lee_producto_stock ON public.producto_stock AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.stock_movimientos
-- ======================================================================
CREATE TABLE public.stock_movimientos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  producto_id uuid,
  delta numeric NOT NULL,
  motivo text NOT NULL,
  pedido_id uuid,
  detalle text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  articulo_id uuid,
  costo_unitario numeric,
  remito_id uuid,
  comprobante_compra_id uuid,
  CONSTRAINT stock_movimientos_pkey PRIMARY KEY (id),
  CONSTRAINT sm_comprobante_fk FOREIGN KEY (comprobante_compra_id, empresa_id) REFERENCES comprobantes_compra(id, empresa_id),
  CONSTRAINT stock_movimientos_articulo_id_fkey FOREIGN KEY (articulo_id) REFERENCES articulos(id),
  CONSTRAINT stock_movimientos_comprobante_compra_id_fkey FOREIGN KEY (comprobante_compra_id) REFERENCES comprobantes_compra(id),
  CONSTRAINT stock_movimientos_remito_id_fkey FOREIGN KEY (remito_id) REFERENCES remitos_compra(id),
  CONSTRAINT stock_mov_doc_chk CHECK ((((motivo = 'venta'::text) AND (pedido_id IS NOT NULL) AND (remito_id IS NULL) AND (comprobante_compra_id IS NULL)) OR ((motivo = 'compra'::text) AND (articulo_id IS NOT NULL) AND (pedido_id IS NULL) AND ((((remito_id IS NOT NULL))::integer + ((comprobante_compra_id IS NOT NULL))::integer) = 1)) OR ((motivo = 'devolucion_compra'::text) AND (articulo_id IS NOT NULL) AND (pedido_id IS NULL) AND (remito_id IS NOT NULL) AND (comprobante_compra_id IS NULL)) OR ((motivo = ANY (ARRAY['arqueo'::text, 'ajuste'::text, 'devolucion'::text])) AND (remito_id IS NULL) AND (comprobante_compra_id IS NULL)))),
  CONSTRAINT stock_mov_eje_chk CHECK (((producto_id IS NOT NULL) OR (articulo_id IS NOT NULL)))
);

-- Índices
CREATE INDEX idx_stockmov_pedido ON public.stock_movimientos USING btree (pedido_id) WHERE (pedido_id IS NOT NULL);
CREATE INDEX idx_stockmov_prod ON public.stock_movimientos USING btree (producto_id, sucursal_id, created_at DESC);
-- (respalda constraint) CREATE UNIQUE INDEX stock_movimientos_pkey ON public.stock_movimientos USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.stock_movimientos ENABLE ROW LEVEL SECURITY;
-- (sin policies: solo accesible vía service_role / funciones SECURITY DEFINER)

-- ======================================================================
-- TABLA public.articulos
-- ======================================================================
CREATE TABLE public.articulos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL,
  unidad_stock text DEFAULT 'unidad'::text NOT NULL,
  producto_id uuid,
  controla_stock boolean DEFAULT true NOT NULL,
  activo boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT articulos_pkey PRIMARY KEY (id),
  CONSTRAINT articulos_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT articulos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT articulos_producto_id_empresa_id_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES productos(id, empresa_id),
  CONSTRAINT articulos_tipo_check CHECK ((tipo = ANY (ARRAY['mercaderia'::text, 'insumo'::text, 'material'::text]))),
  CONSTRAINT articulos_unidad_stock_check CHECK ((unidad_stock = ANY (ARRAY['unidad'::text, 'kg'::text, 'g'::text, 'litro'::text, 'ml'::text, 'metro'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX articulos_id_empresa_id_key ON public.articulos USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX articulos_pkey ON public.articulos USING btree (id);
CREATE UNIQUE INDEX articulos_producto_uq ON public.articulos USING btree (producto_id) WHERE (producto_id IS NOT NULL);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.articulos ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_articulos ON public.articulos AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.articulo_stock
-- ======================================================================
CREATE TABLE public.articulo_stock (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  articulo_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  cantidad numeric DEFAULT 0 NOT NULL,
  stock_minimo numeric DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT articulo_stock_pkey PRIMARY KEY (id),
  CONSTRAINT articulo_stock_articulo_id_sucursal_id_key UNIQUE (articulo_id, sucursal_id),
  CONSTRAINT articulo_stock_articulo_id_empresa_id_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulos(id, empresa_id),
  CONSTRAINT articulo_stock_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT articulo_stock_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  CONSTRAINT articulo_stock_cantidad_check CHECK ((cantidad >= (0)::numeric))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX articulo_stock_articulo_id_sucursal_id_key ON public.articulo_stock USING btree (articulo_id, sucursal_id);
-- (respalda constraint) CREATE UNIQUE INDEX articulo_stock_pkey ON public.articulo_stock USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.articulo_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_art_stock ON public.articulo_stock AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.articulo_presentaciones_compra
-- ======================================================================
CREATE TABLE public.articulo_presentaciones_compra (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  articulo_id uuid NOT NULL,
  nombre text NOT NULL,
  factor numeric NOT NULL,
  activo boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT articulo_presentaciones_compra_pkey PRIMARY KEY (id),
  CONSTRAINT articulo_presentaciones_compra_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT articulo_presentaciones_compra_articulo_id_empresa_id_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulos(id, empresa_id),
  CONSTRAINT articulo_presentaciones_compra_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT articulo_presentaciones_compra_factor_check CHECK ((factor > (0)::numeric))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX articulo_presentaciones_compra_id_empresa_id_key ON public.articulo_presentaciones_compra USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX articulo_presentaciones_compra_pkey ON public.articulo_presentaciones_compra USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.articulo_presentaciones_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_art_pres ON public.articulo_presentaciones_compra AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.arqueos_stock
-- ======================================================================
CREATE TABLE public.arqueos_stock (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  estado text DEFAULT 'pendiente'::text NOT NULL,
  alcance text NOT NULL,
  contado_por text,
  confirmado_por text,
  observaciones text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  confirmado_at timestamp with time zone,
  CONSTRAINT arqueos_stock_pkey PRIMARY KEY (id),
  CONSTRAINT arqueos_stock_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'confirmado'::text, 'descartado'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX arqueos_stock_pkey ON public.arqueos_stock USING btree (id);
CREATE UNIQUE INDEX arqueos_stock_un_pendiente_por_sucursal ON public.arqueos_stock USING btree (empresa_id, sucursal_id) WHERE (estado = 'pendiente'::text);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.arqueos_stock ENABLE ROW LEVEL SECURITY;
-- ATENCIÓN: policy abierta (USING true) para todos los roles, sin filtro por empresa.
CREATE POLICY arq_all ON public.arqueos_stock AS PERMISSIVE FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- ======================================================================
-- TABLA public.arqueo_items
-- ======================================================================
CREATE TABLE public.arqueo_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  arqueo_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  teorico numeric NOT NULL,
  fisico numeric NOT NULL,
  diferencia numeric GENERATED ALWAYS AS ((fisico - teorico)) STORED,
  ajustado boolean DEFAULT false NOT NULL,
  descartado boolean DEFAULT false NOT NULL,
  CONSTRAINT arqueo_items_pkey PRIMARY KEY (id),
  CONSTRAINT arqueo_items_arqueo_id_fkey FOREIGN KEY (arqueo_id) REFERENCES arqueos_stock(id) ON DELETE CASCADE
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX arqueo_items_pkey ON public.arqueo_items USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.arqueo_items ENABLE ROW LEVEL SECURITY;
-- ATENCIÓN: policy abierta (USING true) para todos los roles, sin filtro por empresa.
CREATE POLICY arqi_all ON public.arqueo_items AS PERMISSIVE FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- ======================================================================
-- COLUMNAS DE STOCK EN TABLAS AJENAS (ALTER de referencia, COMENTADO)
-- ======================================================================
-- ALTER TABLE public.presentaciones ADD COLUMN factor_stock numeric DEFAULT 1 NOT NULL;
-- ALTER TABLE public.presentaciones ADD CONSTRAINT presentaciones_factor_stock_positivo CHECK ((factor_stock > (0)::numeric));
-- ALTER TABLE public.pedido_items ADD COLUMN factor_stock_snap numeric;   -- nullable, sin default, sin constraints
-- ALTER TABLE public.pedidos ADD COLUMN stock_descontado boolean DEFAULT false NOT NULL;
-- ALTER TABLE public.productos ADD COLUMN controla_stock boolean DEFAULT false NOT NULL;   -- sin constraints propios
