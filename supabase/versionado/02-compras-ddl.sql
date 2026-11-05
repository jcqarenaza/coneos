-- REFERENCIA VERSIONADA — volcado de la base el 2026-11-04 — NO ES MIGRACIÓN, NO APLICAR
-- Proyecto Supabase: wpiwjpvjqshsgrxxwsld (ConeOS). Schema public.
-- Grupo 2: compras (proveedores, órdenes de compra, remitos, comprobantes,
-- cuenta corriente, órdenes de pago, chequeras/cheques) y vista v_saldo_proveedor.
-- Tablas extra incluidas por pedido ("orden_pago*", "cheque*"): ordenes_pago_imputaciones,
-- ordenes_pago_valores, chequeras, cheques. No existen tablas "op_*" ni "credito*".
-- Los índices que respaldan un constraint figuran comentados "(respalda constraint)".
-- Orden de dependencias: ver FKs cruzadas (ccp -> ordenes_pago_proveedor; ordenes_pago_valores -> cheques).

-- ======================================================================
-- TABLA public.proveedores
-- ======================================================================
CREATE TABLE public.proveedores (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  nombre text NOT NULL,
  cuit text,
  telefono text,
  email text,
  direccion text,
  observaciones text,
  activo boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  razon_social text,
  CONSTRAINT proveedores_pkey PRIMARY KEY (id),
  CONSTRAINT proveedores_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT proveedores_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX proveedores_id_empresa_id_key ON public.proveedores USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX proveedores_pkey ON public.proveedores USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_proveedores ON public.proveedores AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.ordenes_compra
-- ======================================================================
CREATE TABLE public.ordenes_compra (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  sucursal_id uuid,
  numero integer NOT NULL,
  estado text DEFAULT 'abierta'::text NOT NULL,
  fecha date DEFAULT CURRENT_DATE NOT NULL,
  observaciones text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ordenes_compra_pkey PRIMARY KEY (id),
  CONSTRAINT ordenes_compra_empresa_id_numero_key UNIQUE (empresa_id, numero),
  CONSTRAINT ordenes_compra_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT ordenes_compra_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT ordenes_compra_proveedor_id_empresa_id_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES proveedores(id, empresa_id),
  CONSTRAINT ordenes_compra_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  CONSTRAINT ordenes_compra_estado_check CHECK ((estado = ANY (ARRAY['abierta'::text, 'parcial'::text, 'recibida'::text, 'anulada'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_compra_empresa_id_numero_key ON public.ordenes_compra USING btree (empresa_id, numero);
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_compra_id_empresa_id_key ON public.ordenes_compra USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_compra_pkey ON public.ordenes_compra USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.ordenes_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_oc ON public.ordenes_compra AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.ordenes_compra_items
-- ======================================================================
CREATE TABLE public.ordenes_compra_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  orden_compra_id uuid NOT NULL,
  articulo_id uuid NOT NULL,
  presentacion_id uuid,
  cantidad numeric NOT NULL,
  costo_previsto numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ordenes_compra_items_pkey PRIMARY KEY (id),
  CONSTRAINT ordenes_compra_items_articulo_id_empresa_id_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulos(id, empresa_id),
  CONSTRAINT ordenes_compra_items_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT ordenes_compra_items_orden_compra_id_empresa_id_fkey FOREIGN KEY (orden_compra_id, empresa_id) REFERENCES ordenes_compra(id, empresa_id),
  CONSTRAINT ordenes_compra_items_presentacion_id_fkey FOREIGN KEY (presentacion_id) REFERENCES articulo_presentaciones_compra(id),
  CONSTRAINT ordenes_compra_items_cantidad_check CHECK ((cantidad > (0)::numeric))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_compra_items_pkey ON public.ordenes_compra_items USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.ordenes_compra_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_oc_items ON public.ordenes_compra_items AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.remitos_compra
-- ======================================================================
CREATE TABLE public.remitos_compra (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  orden_compra_id uuid,
  numero integer NOT NULL,
  numero_proveedor text,
  tipo text DEFAULT 'recepcion'::text NOT NULL,
  fecha date DEFAULT CURRENT_DATE NOT NULL,
  estado text DEFAULT 'borrador'::text NOT NULL,
  confirmado_at timestamp with time zone,
  observaciones text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT remitos_compra_pkey PRIMARY KEY (id),
  CONSTRAINT remitos_compra_empresa_id_numero_key UNIQUE (empresa_id, numero),
  CONSTRAINT remitos_compra_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT remitos_compra_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT remitos_compra_orden_compra_id_empresa_id_fkey FOREIGN KEY (orden_compra_id, empresa_id) REFERENCES ordenes_compra(id, empresa_id),
  CONSTRAINT remitos_compra_proveedor_id_empresa_id_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES proveedores(id, empresa_id),
  CONSTRAINT remitos_compra_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  CONSTRAINT remitos_compra_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'confirmado'::text, 'anulado'::text]))),
  CONSTRAINT remitos_compra_tipo_check CHECK ((tipo = ANY (ARRAY['recepcion'::text, 'devolucion'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX remitos_compra_empresa_id_numero_key ON public.remitos_compra USING btree (empresa_id, numero);
-- (respalda constraint) CREATE UNIQUE INDEX remitos_compra_id_empresa_id_key ON public.remitos_compra USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX remitos_compra_pkey ON public.remitos_compra USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.remitos_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_remitos ON public.remitos_compra AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.remitos_compra_items
-- ======================================================================
CREATE TABLE public.remitos_compra_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  remito_id uuid NOT NULL,
  articulo_id uuid NOT NULL,
  presentacion_id uuid,
  cantidad numeric NOT NULL,
  factor_snap numeric NOT NULL,
  cantidad_operativa numeric NOT NULL,
  costo_unitario numeric NOT NULL,
  cantidad_pedida numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT remitos_compra_items_pkey PRIMARY KEY (id),
  CONSTRAINT remitos_compra_items_articulo_id_empresa_id_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulos(id, empresa_id),
  CONSTRAINT remitos_compra_items_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT remitos_compra_items_presentacion_id_fkey FOREIGN KEY (presentacion_id) REFERENCES articulo_presentaciones_compra(id),
  CONSTRAINT remitos_compra_items_remito_id_empresa_id_fkey FOREIGN KEY (remito_id, empresa_id) REFERENCES remitos_compra(id, empresa_id),
  CONSTRAINT remitos_compra_items_cantidad_check CHECK ((cantidad > (0)::numeric)),
  CONSTRAINT remitos_compra_items_cantidad_operativa_check CHECK ((cantidad_operativa > (0)::numeric)),
  CONSTRAINT remitos_compra_items_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric)),
  CONSTRAINT remitos_compra_items_factor_snap_check CHECK ((factor_snap > (0)::numeric))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX remitos_compra_items_pkey ON public.remitos_compra_items USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.remitos_compra_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_remitos_items ON public.remitos_compra_items AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.cuenta_corriente_proveedor
-- ======================================================================
CREATE TABLE public.cuenta_corriente_proveedor (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  tipo text NOT NULL,
  monto numeric NOT NULL,
  comprobante_id uuid,
  orden_pago_id uuid,
  detalle text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cuenta_corriente_proveedor_pkey PRIMARY KEY (id),
  CONSTRAINT ccp_orden_pago_fk FOREIGN KEY (orden_pago_id, empresa_id) REFERENCES ordenes_pago_proveedor(id, empresa_id),
  CONSTRAINT cuenta_corriente_proveedor_comprobante_id_empresa_id_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobantes_compra(id, empresa_id),
  CONSTRAINT cuenta_corriente_proveedor_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT cuenta_corriente_proveedor_proveedor_id_empresa_id_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES proveedores(id, empresa_id),
  CONSTRAINT ccp_origen_chk CHECK (((((comprobante_id IS NOT NULL))::integer + ((orden_pago_id IS NOT NULL))::integer) = 1)),
  CONSTRAINT cuenta_corriente_proveedor_monto_check CHECK ((monto > (0)::numeric)),
  CONSTRAINT cuenta_corriente_proveedor_tipo_check CHECK ((tipo = ANY (ARRAY['debe'::text, 'haber'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX cuenta_corriente_proveedor_pkey ON public.cuenta_corriente_proveedor USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.cuenta_corriente_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_ccp ON public.cuenta_corriente_proveedor AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.comprobantes_compra
-- ======================================================================
CREATE TABLE public.comprobantes_compra (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  tipo text DEFAULT 'factura'::text NOT NULL,
  letra text,
  numero_proveedor text NOT NULL,
  fecha date DEFAULT CURRENT_DATE NOT NULL,
  total numeric NOT NULL,
  estado text DEFAULT 'pendiente'::text NOT NULL,
  observaciones text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  neto numeric,
  iva numeric,
  sucursal_id uuid,
  cae text,
  fecha_vencimiento date,
  CONSTRAINT comprobantes_compra_pkey PRIMARY KEY (id),
  CONSTRAINT comprobantes_compra_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT cc_sucursal_fk FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursales(id, empresa_id),
  CONSTRAINT comprobantes_compra_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT comprobantes_compra_proveedor_id_empresa_id_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES proveedores(id, empresa_id),
  CONSTRAINT comprobantes_compra_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'parcial'::text, 'pagada'::text, 'anulada'::text]))),
  CONSTRAINT comprobantes_compra_letra_check CHECK ((letra = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'X'::text]))),
  CONSTRAINT comprobantes_compra_tipo_check CHECK ((tipo = ANY (ARRAY['factura'::text, 'nota_credito'::text, 'nota_debito'::text]))),
  CONSTRAINT comprobantes_compra_total_check CHECK ((total >= (0)::numeric))
);

-- Índices
CREATE UNIQUE INDEX cc_numero_unico ON public.comprobantes_compra USING btree (empresa_id, proveedor_id, tipo, COALESCE(letra, ''::text), numero_proveedor) WHERE (estado <> 'anulada'::text);
-- (respalda constraint) CREATE UNIQUE INDEX comprobantes_compra_id_empresa_id_key ON public.comprobantes_compra USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX comprobantes_compra_pkey ON public.comprobantes_compra USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.comprobantes_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_comprobantes ON public.comprobantes_compra AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.comprobantes_compra_items
-- ======================================================================
CREATE TABLE public.comprobantes_compra_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  comprobante_id uuid NOT NULL,
  articulo_id uuid,
  descripcion text NOT NULL,
  cantidad numeric NOT NULL,
  precio_unitario numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  presentacion_id uuid,
  factor_snap numeric,
  cantidad_operativa numeric,
  ingresa_stock boolean DEFAULT false NOT NULL,
  CONSTRAINT comprobantes_compra_items_pkey PRIMARY KEY (id),
  CONSTRAINT comprobantes_compra_items_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT comprobantes_compra_items_articulo_id_empresa_id_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulos(id, empresa_id),
  CONSTRAINT comprobantes_compra_items_comprobante_id_empresa_id_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobantes_compra(id, empresa_id),
  CONSTRAINT comprobantes_compra_items_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT comprobantes_compra_items_cantidad_check CHECK ((cantidad > (0)::numeric)),
  CONSTRAINT comprobantes_compra_items_descripcion_check CHECK ((length(TRIM(BOTH FROM descripcion)) > 0)),
  CONSTRAINT comprobantes_compra_items_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX comprobantes_compra_items_id_empresa_id_key ON public.comprobantes_compra_items USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX comprobantes_compra_items_pkey ON public.comprobantes_compra_items USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.comprobantes_compra_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_cci ON public.comprobantes_compra_items AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.comprobantes_compra_remitos
-- ======================================================================
CREATE TABLE public.comprobantes_compra_remitos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  comprobante_id uuid NOT NULL,
  remito_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT comprobantes_compra_remitos_pkey PRIMARY KEY (id),
  CONSTRAINT comprobantes_compra_remitos_comprobante_id_remito_id_key UNIQUE (comprobante_id, remito_id),
  CONSTRAINT comprobantes_compra_remitos_comprobante_id_empresa_id_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobantes_compra(id, empresa_id),
  CONSTRAINT comprobantes_compra_remitos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT comprobantes_compra_remitos_remito_id_empresa_id_fkey FOREIGN KEY (remito_id, empresa_id) REFERENCES remitos_compra(id, empresa_id)
);

-- Índices
CREATE UNIQUE INDEX ccr_remito_unico ON public.comprobantes_compra_remitos USING btree (remito_id);
-- (respalda constraint) CREATE UNIQUE INDEX comprobantes_compra_remitos_comprobante_id_remito_id_key ON public.comprobantes_compra_remitos USING btree (comprobante_id, remito_id);
-- (respalda constraint) CREATE UNIQUE INDEX comprobantes_compra_remitos_pkey ON public.comprobantes_compra_remitos USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.comprobantes_compra_remitos ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_comp_remitos ON public.comprobantes_compra_remitos AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.ordenes_pago_proveedor
-- ======================================================================
CREATE TABLE public.ordenes_pago_proveedor (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  numero integer NOT NULL,
  fecha date DEFAULT CURRENT_DATE NOT NULL,
  total numeric NOT NULL,
  medio text NOT NULL,
  cuenta_pago_id uuid,
  observaciones text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  anulada boolean DEFAULT false NOT NULL,
  fecha_anulacion date,
  motivo_anulacion text,
  CONSTRAINT ordenes_pago_proveedor_pkey PRIMARY KEY (id),
  CONSTRAINT ordenes_pago_proveedor_empresa_id_numero_key UNIQUE (empresa_id, numero),
  CONSTRAINT ordenes_pago_proveedor_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT ordenes_pago_proveedor_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT ordenes_pago_proveedor_proveedor_id_empresa_id_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES proveedores(id, empresa_id),
  CONSTRAINT ordenes_pago_proveedor_total_check CHECK ((total > (0)::numeric))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_pago_proveedor_empresa_id_numero_key ON public.ordenes_pago_proveedor USING btree (empresa_id, numero);
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_pago_proveedor_id_empresa_id_key ON public.ordenes_pago_proveedor USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_pago_proveedor_pkey ON public.ordenes_pago_proveedor USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.ordenes_pago_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_op ON public.ordenes_pago_proveedor AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.ordenes_pago_imputaciones
-- ======================================================================
CREATE TABLE public.ordenes_pago_imputaciones (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  orden_pago_id uuid NOT NULL,
  comprobante_id uuid NOT NULL,
  monto numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ordenes_pago_imputaciones_pkey PRIMARY KEY (id),
  CONSTRAINT ordenes_pago_imputaciones_comprobante_id_empresa_id_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobantes_compra(id, empresa_id),
  CONSTRAINT ordenes_pago_imputaciones_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT ordenes_pago_imputaciones_orden_pago_id_empresa_id_fkey FOREIGN KEY (orden_pago_id, empresa_id) REFERENCES ordenes_pago_proveedor(id, empresa_id),
  CONSTRAINT ordenes_pago_imputaciones_monto_check CHECK ((monto > (0)::numeric))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_pago_imputaciones_pkey ON public.ordenes_pago_imputaciones USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.ordenes_pago_imputaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_op_imp ON public.ordenes_pago_imputaciones AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.ordenes_pago_valores
-- ======================================================================
CREATE TABLE public.ordenes_pago_valores (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  orden_pago_id uuid NOT NULL,
  tipo text NOT NULL,
  cuenta_banco_id uuid,
  cheque_id uuid,
  monto numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  orden_pago_origen_id uuid,
  CONSTRAINT ordenes_pago_valores_pkey PRIMARY KEY (id),
  CONSTRAINT ordenes_pago_valores_cheque_id_empresa_id_fkey FOREIGN KEY (cheque_id, empresa_id) REFERENCES cheques(id, empresa_id),
  CONSTRAINT ordenes_pago_valores_cuenta_banco_id_empresa_id_fkey FOREIGN KEY (cuenta_banco_id, empresa_id) REFERENCES cuentas_banco(id, empresa_id),
  CONSTRAINT ordenes_pago_valores_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT ordenes_pago_valores_orden_pago_id_empresa_id_fkey FOREIGN KEY (orden_pago_id, empresa_id) REFERENCES ordenes_pago_proveedor(id, empresa_id),
  CONSTRAINT ordenes_pago_valores_orden_pago_origen_id_fkey FOREIGN KEY (orden_pago_origen_id) REFERENCES ordenes_pago_proveedor(id),
  CONSTRAINT ordenes_pago_valores_check CHECK (((tipo <> 'transferencia'::text) OR (cuenta_banco_id IS NOT NULL))),
  CONSTRAINT ordenes_pago_valores_check1 CHECK (((tipo <> 'cheque'::text) OR (cheque_id IS NOT NULL))),
  CONSTRAINT ordenes_pago_valores_check2 CHECK (((tipo <> 'efectivo'::text) OR ((cuenta_banco_id IS NULL) AND (cheque_id IS NULL)))),
  CONSTRAINT ordenes_pago_valores_monto_check CHECK ((monto > (0)::numeric)),
  CONSTRAINT ordenes_pago_valores_tipo_check CHECK ((tipo = ANY (ARRAY['efectivo'::text, 'transferencia'::text, 'cheque'::text, 'credito_op'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX ordenes_pago_valores_pkey ON public.ordenes_pago_valores USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.ordenes_pago_valores ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_op_valores ON public.ordenes_pago_valores AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.chequeras
-- ======================================================================
CREATE TABLE public.chequeras (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  cuenta_banco_id uuid NOT NULL,
  descripcion text,
  desde integer NOT NULL,
  hasta integer NOT NULL,
  proximo integer NOT NULL,
  estado text DEFAULT 'activa'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT chequeras_pkey PRIMARY KEY (id),
  CONSTRAINT chequeras_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT chequeras_cuenta_banco_id_empresa_id_fkey FOREIGN KEY (cuenta_banco_id, empresa_id) REFERENCES cuentas_banco(id, empresa_id),
  CONSTRAINT chequeras_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT chequeras_check CHECK ((hasta >= desde)),
  CONSTRAINT chequeras_check1 CHECK ((proximo >= desde)),
  CONSTRAINT chequeras_desde_check CHECK ((desde > 0)),
  CONSTRAINT chequeras_estado_check CHECK ((estado = ANY (ARRAY['activa'::text, 'agotada'::text, 'anulada'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX chequeras_id_empresa_id_key ON public.chequeras USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX chequeras_pkey ON public.chequeras USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.chequeras ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_chequeras ON public.chequeras AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- TABLA public.cheques
-- ======================================================================
CREATE TABLE public.cheques (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  tipo text DEFAULT 'propio'::text NOT NULL,
  modalidad text DEFAULT 'al_dia'::text NOT NULL,
  formato text DEFAULT 'fisico'::text NOT NULL,
  chequera_id uuid,
  cuenta_banco_id uuid,
  numero integer NOT NULL,
  fecha_emision date DEFAULT CURRENT_DATE NOT NULL,
  fecha_cobro date NOT NULL,
  monto numeric NOT NULL,
  proveedor_id uuid,
  orden_pago_id uuid,
  estado text DEFAULT 'emitido'::text NOT NULL,
  notas text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cheques_pkey PRIMARY KEY (id),
  CONSTRAINT cheques_chequera_id_numero_key UNIQUE (chequera_id, numero),
  CONSTRAINT cheques_id_empresa_id_key UNIQUE (id, empresa_id),
  CONSTRAINT cheques_chequera_id_empresa_id_fkey FOREIGN KEY (chequera_id, empresa_id) REFERENCES chequeras(id, empresa_id),
  CONSTRAINT cheques_cuenta_banco_id_empresa_id_fkey FOREIGN KEY (cuenta_banco_id, empresa_id) REFERENCES cuentas_banco(id, empresa_id),
  CONSTRAINT cheques_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT cheques_proveedor_id_empresa_id_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES proveedores(id, empresa_id),
  CONSTRAINT cheques_check CHECK (((tipo <> 'propio'::text) OR (chequera_id IS NOT NULL))),
  CONSTRAINT cheques_check1 CHECK (((modalidad <> 'diferido'::text) OR (fecha_cobro >= fecha_emision))),
  CONSTRAINT cheques_estado_check CHECK ((estado = ANY (ARRAY['emitido'::text, 'cobrado'::text, 'anulado'::text, 'rebotado'::text, 'en_cartera'::text, 'depositado'::text, 'endosado'::text]))),
  CONSTRAINT cheques_formato_check CHECK ((formato = ANY (ARRAY['fisico'::text, 'echeq'::text]))),
  CONSTRAINT cheques_modalidad_check CHECK ((modalidad = ANY (ARRAY['al_dia'::text, 'diferido'::text]))),
  CONSTRAINT cheques_monto_check CHECK ((monto > (0)::numeric)),
  CONSTRAINT cheques_tipo_check CHECK ((tipo = ANY (ARRAY['propio'::text, 'tercero'::text])))
);

-- Índices
-- (respalda constraint) CREATE UNIQUE INDEX cheques_chequera_id_numero_key ON public.cheques USING btree (chequera_id, numero);
-- (respalda constraint) CREATE UNIQUE INDEX cheques_id_empresa_id_key ON public.cheques USING btree (id, empresa_id);
-- (respalda constraint) CREATE UNIQUE INDEX cheques_pkey ON public.cheques USING btree (id);

-- Triggers
-- (sin triggers)

-- RLS
ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel_cheques ON public.cheques AS PERMISSIVE FOR SELECT TO public
  USING ((empresa_id = auth_empresa_id()));

-- ======================================================================
-- VISTA public.v_saldo_proveedor  (pg_get_viewdef; sin reloptions)
-- ======================================================================
CREATE OR REPLACE VIEW public.v_saldo_proveedor AS
 SELECT empresa_id,
    proveedor_id,
    sum(
        CASE
            WHEN tipo = 'debe'::text THEN monto
            ELSE - monto
        END) AS saldo
   FROM cuenta_corriente_proveedor
  GROUP BY empresa_id, proveedor_id;
