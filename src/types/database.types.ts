export type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      empresas: {
        Row: { id: string; nombre: string; slug: string; activo: boolean; plan: string; created_at: string }
        Insert: Omit<Database['public']['Tables']['empresas']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['empresas']['Insert']>
      }
      empresa_config: {
        Row: { id: string; empresa_id: string; primary_color: string; secondary_color: string; logo_url: string | null; moneda: string; allow_kiosk: boolean; allow_online_orders: boolean; pedido_numero_diario: boolean; texto_bienvenida: string; created_at: string }
        Insert: Omit<Database['public']['Tables']['empresa_config']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['empresa_config']['Insert']>
      }
      sucursales: {
        Row: { id: string; empresa_id: string; nombre: string; slug: string; direccion: string | null; activo: boolean; created_at: string }
        Insert: Omit<Database['public']['Tables']['sucursales']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['sucursales']['Insert']>
      }
      sucursal_pagos: {
        Row: { id: string; sucursal_id: string; empresa_id: string; mp_access_token: string | null; mp_alias: string | null; mp_public_key: string | null; acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean; cbu_transferencia: string | null; created_at: string }
        Insert: Omit<Database['public']['Tables']['sucursal_pagos']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['sucursal_pagos']['Insert']>
      }
      usuarios_admin: {
        Row: { id: string; empresa_id: string | null; nombre: string; activo: boolean; created_at: string }
        Insert: Omit<Database['public']['Tables']['usuarios_admin']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['usuarios_admin']['Insert']>
      }
      usuario_admin_roles: {
        Row: { id: string; usuario_id: string; empresa_id: string; sucursal_id: string | null; rol: string; created_at: string }
        Insert: Omit<Database['public']['Tables']['usuario_admin_roles']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['usuario_admin_roles']['Insert']>
      }
      operadores: {
        Row: { id: string; empresa_id: string; sucursal_id: string | null; nombre: string; pin_hash: string; puede_cobrar: boolean; puede_preparar: boolean; activo: boolean; created_at: string }
        Insert: Omit<Database['public']['Tables']['operadores']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['operadores']['Insert']>
      }
      dispositivos: {
        Row: { id: string; empresa_id: string; sucursal_id: string; nombre: string; tipo: 'KIOSK' | 'CAJA' | 'PREPARACION' | 'DISPLAY'; device_token: string; activo: boolean; created_at: string }
        Insert: Omit<Database['public']['Tables']['dispositivos']['Row'], 'id' | 'created_at' | 'device_token'>
        Update: Partial<Database['public']['Tables']['dispositivos']['Insert']>
      }
      operator_sessions: {
        Row: { id: string; operador_id: string; dispositivo_id: string; sucursal_id: string; empresa_id: string; inicio: string; fin: string | null; estado: 'ACTIVA' | 'CERRADA'; created_at: string }
        Insert: Omit<Database['public']['Tables']['operator_sessions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['operator_sessions']['Insert']>
      }
      turnos: {
        Row: { id: string; empresa_id: string; sucursal_id: string; fecha: string; abierto_por: string | null; cerrado_por: string | null; estado: string; monto_apertura: number | null; monto_cierre: number | null; observaciones: string | null; created_at: string; updated_at: string }
        Insert: Omit<Database['public']['Tables']['turnos']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['turnos']['Insert']>
      }
      categorias: {
        Row: { id: string; empresa_id: string; nombre: string; orden: number; icono_url: string | null; activo: boolean; deleted_at: string | null; slug: string | null; codigo: string | null }
        Insert: Omit<Database['public']['Tables']['categorias']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['categorias']['Insert']>
      }
      productos: {
        Row: { id: string; empresa_id: string; categoria_id: string; nombre: string; descripcion: string | null; imagen_url: string | null; orden: number; activo: boolean; visible_kiosk: boolean; deleted_at: string | null; slug: string | null; codigo: string | null }
        Insert: Omit<Database['public']['Tables']['productos']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['productos']['Insert']>
      }
      presentaciones: {
        Row: { id: string; producto_id: string; empresa_id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; orden: number; activo: boolean }
        Insert: Omit<Database['public']['Tables']['presentaciones']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['presentaciones']['Insert']>
      }
      grupos_opciones: {
        Row: { id: string; empresa_id: string; nombre: string; orden: number; activo: boolean }
        Insert: Omit<Database['public']['Tables']['grupos_opciones']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['grupos_opciones']['Insert']>
      }
      opciones: {
        Row: { id: string; grupo_id: string; empresa_id: string; nombre: string; descripcion: string | null; imagen_url: string | null; color: string | null; emoji: string | null; orden: number; activo: boolean; deleted_at: string | null; codigo: string | null }
        Insert: Omit<Database['public']['Tables']['opciones']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['opciones']['Insert']>
      }
      presentacion_grupos: {
        Row: { id: string; presentacion_id: string; grupo_id: string }
        Insert: Omit<Database['public']['Tables']['presentacion_grupos']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['presentacion_grupos']['Insert']>
      }
      sucursal_catalogo_config: {
        Row: { id: string; sucursal_id: string; empresa_id: string; entidad_tipo: string; entidad_id: string; disponible: boolean }
        Insert: Omit<Database['public']['Tables']['sucursal_catalogo_config']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['sucursal_catalogo_config']['Insert']>
      }
      inventario_opciones: {
        Row: { id: string; empresa_id: string; sucursal_id: string; opcion_id: string; disponible: boolean; stock: number | null; updated_at: string }
        Insert: Omit<Database['public']['Tables']['inventario_opciones']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['inventario_opciones']['Insert']>
      }
      promociones: {
        Row: { id: string; empresa_id: string; nombre: string; tipo: string | null; valor: number | null; fecha_inicio: string | null; fecha_fin: string | null; activo: boolean; created_at: string }
        Insert: Omit<Database['public']['Tables']['promociones']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['promociones']['Insert']>
      }
      pedidos: {
        Row: { id: string; empresa_id: string; sucursal_id: string; dispositivo_id: string | null; operator_session_id: string | null; turno_id: string | null; cliente_id: string | null; numero_pedido: number; fecha_pedido: string; codigo_retiro: string; origen: 'KIOSK' | 'CAJA' | 'ONLINE' | 'APP'; estado: 'CREATED' | 'PENDING_PAYMENT' | 'PAID' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED'; prioridad: 'NORMAL' | 'ALTA'; tiempo_estimado: number | null; metodo_pago: 'efectivo' | 'transferencia' | 'mp' | null; total: number; notas: string | null; created_at: string; updated_at: string }
        Insert: Omit<Database['public']['Tables']['pedidos']['Row'], 'id' | 'created_at' | 'updated_at' | 'codigo_retiro' | 'numero_pedido'>
        Update: Partial<Database['public']['Tables']['pedidos']['Insert']>
      }
      pedido_items: {
        Row: { id: string; pedido_id: string; presentacion_id: string | null; nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; notas: string | null }
        Insert: Omit<Database['public']['Tables']['pedido_items']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['pedido_items']['Insert']>
      }
      pedido_item_opciones: {
        Row: { id: string; pedido_item_id: string; opcion_id: string | null; nombre_snap: string; color_snap: string | null; emoji_snap: string | null }
        Insert: Omit<Database['public']['Tables']['pedido_item_opciones']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['pedido_item_opciones']['Insert']>
      }
      pedido_estados_log: {
        Row: { id: string; pedido_id: string; operador_id: string | null; estado_anterior: string | null; estado_nuevo: string; created_at: string }
        Insert: Omit<Database['public']['Tables']['pedido_estados_log']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['pedido_estados_log']['Insert']>
      }
      pagos: {
        Row: { id: string; pedido_id: string; comprobante_id: string | null; empresa_id: string; sucursal_id: string; metodo: string; monto: number; estado: string; mp_data: Json | null; created_at: string }
        Insert: Omit<Database['public']['Tables']['pagos']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['pagos']['Insert']>
      }
      comprobantes: {
        Row: { id: string; empresa_id: string; sucursal_id: string; pedido_id: string | null; cliente_id: string | null; tipo_comprobante: string; numero: number | null; estado: string; cae: string | null; vencimiento_cae: string | null; total: number; fecha_emision: string; datos_fiscales: Json | null; response_provider: Json | null; created_at: string }
        Insert: Omit<Database['public']['Tables']['comprobantes']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['comprobantes']['Insert']>
      }
      clientes: {
        Row: { id: string; empresa_id: string; nombre: string | null; telefono: string | null; cuit: string | null; razon_social: string | null; condicion_iva: string | null; email: string | null; created_at: string }
        Insert: Omit<Database['public']['Tables']['clientes']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['clientes']['Insert']>
      }
      facturacion_config: {
        Row: { id: string; empresa_id: string; proveedor: string; punto_venta: number | null; condicion_iva: string | null; cuit: string | null; certificado: string | null; activo: boolean; created_at: string }
        Insert: Omit<Database['public']['Tables']['facturacion_config']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['facturacion_config']['Insert']>
      }
      audit_log: {
        Row: { id: string; empresa_id: string | null; tabla: string; entidad_id: string; accion: string; datos_antes: Json | null; datos_despues: Json | null; actor_tipo: string | null; actor_id: string | null; actor_nombre: string | null; created_at: string }
        Insert: Omit<Database['public']['Tables']['audit_log']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['audit_log']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: {
      get_next_pedido_numero: { Args: { p_sucursal_id: string; p_fecha: string }; Returns: number }
      auth_empresa_id: { Args: Record<string, never>; Returns: string }
      auth_rol: { Args: Record<string, never>; Returns: string }
    }
    Enums: Record<string, never>
  }
}
