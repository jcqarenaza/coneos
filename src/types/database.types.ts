export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      arca_tokens: {
        Row: {
          ambiente: string
          empresa_id: string
          expira_at: string
          facturacion_config_id: string
          sign: string
          sucursal_id: string | null
          token: string
          updated_at: string | null
        }
        Insert: {
          ambiente: string
          empresa_id: string
          expira_at: string
          facturacion_config_id: string
          sign: string
          sucursal_id?: string | null
          token: string
          updated_at?: string | null
        }
        Update: {
          ambiente?: string
          empresa_id?: string
          expira_at?: string
          facturacion_config_id?: string
          sign?: string
          sucursal_id?: string | null
          token?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arca_tokens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arca_tokens_factcfg_fk"
            columns: ["facturacion_config_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "facturacion_config"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      arqueo_items: {
        Row: {
          ajustado: boolean
          arqueo_id: string
          descartado: boolean
          diferencia: number | null
          fisico: number
          id: string
          producto_id: string
          teorico: number
        }
        Insert: {
          ajustado?: boolean
          arqueo_id: string
          descartado?: boolean
          diferencia?: number | null
          fisico: number
          id?: string
          producto_id: string
          teorico: number
        }
        Update: {
          ajustado?: boolean
          arqueo_id?: string
          descartado?: boolean
          diferencia?: number | null
          fisico?: number
          id?: string
          producto_id?: string
          teorico?: number
        }
        Relationships: [
          {
            foreignKeyName: "arqueo_items_arqueo_id_fkey"
            columns: ["arqueo_id"]
            isOneToOne: false
            referencedRelation: "arqueos_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      arqueos: {
        Row: {
          created_at: string | null
          diferencia: number | null
          efectivo_contado: number | null
          empresa_id: string | null
          fecha: string
          id: string
          notas: string | null
          operador_id: string | null
          sucursal_id: string | null
          total_efectivo: number | null
          total_mp: number | null
          total_sistema: number | null
          total_transferencia: number | null
        }
        Insert: {
          created_at?: string | null
          diferencia?: number | null
          efectivo_contado?: number | null
          empresa_id?: string | null
          fecha: string
          id?: string
          notas?: string | null
          operador_id?: string | null
          sucursal_id?: string | null
          total_efectivo?: number | null
          total_mp?: number | null
          total_sistema?: number | null
          total_transferencia?: number | null
        }
        Update: {
          created_at?: string | null
          diferencia?: number | null
          efectivo_contado?: number | null
          empresa_id?: string | null
          fecha?: string
          id?: string
          notas?: string | null
          operador_id?: string | null
          sucursal_id?: string | null
          total_efectivo?: number | null
          total_mp?: number | null
          total_sistema?: number | null
          total_transferencia?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "arqueos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arqueos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      arqueos_stock: {
        Row: {
          alcance: string
          confirmado_at: string | null
          confirmado_por: string | null
          contado_por: string | null
          created_at: string
          empresa_id: string
          estado: string
          id: string
          observaciones: string | null
          sucursal_id: string
        }
        Insert: {
          alcance: string
          confirmado_at?: string | null
          confirmado_por?: string | null
          contado_por?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          id?: string
          observaciones?: string | null
          sucursal_id: string
        }
        Update: {
          alcance?: string
          confirmado_at?: string | null
          confirmado_por?: string | null
          contado_por?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          id?: string
          observaciones?: string | null
          sucursal_id?: string
        }
        Relationships: []
      }
      articulo_presentaciones_compra: {
        Row: {
          activo: boolean
          articulo_id: string
          created_at: string
          empresa_id: string
          factor: number
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          articulo_id: string
          created_at?: string
          empresa_id: string
          factor: number
          id?: string
          nombre: string
        }
        Update: {
          activo?: boolean
          articulo_id?: string
          created_at?: string
          empresa_id?: string
          factor?: number
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "articulo_presentaciones_compra_articulo_id_empresa_id_fkey"
            columns: ["articulo_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "articulos"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "articulo_presentaciones_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      articulo_stock: {
        Row: {
          articulo_id: string
          cantidad: number
          empresa_id: string
          id: string
          stock_minimo: number
          sucursal_id: string
          updated_at: string
        }
        Insert: {
          articulo_id: string
          cantidad?: number
          empresa_id: string
          id?: string
          stock_minimo?: number
          sucursal_id: string
          updated_at?: string
        }
        Update: {
          articulo_id?: string
          cantidad?: number
          empresa_id?: string
          id?: string
          stock_minimo?: number
          sucursal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "articulo_stock_articulo_id_empresa_id_fkey"
            columns: ["articulo_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "articulos"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "articulo_stock_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articulo_stock_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      articulos: {
        Row: {
          activo: boolean
          controla_stock: boolean
          created_at: string
          deleted_at: string | null
          empresa_id: string
          id: string
          nombre: string
          producto_id: string | null
          tipo: string
          unidad_stock: string
        }
        Insert: {
          activo?: boolean
          controla_stock?: boolean
          created_at?: string
          deleted_at?: string | null
          empresa_id: string
          id?: string
          nombre: string
          producto_id?: string | null
          tipo: string
          unidad_stock?: string
        }
        Update: {
          activo?: boolean
          controla_stock?: boolean
          created_at?: string
          deleted_at?: string | null
          empresa_id?: string
          id?: string
          nombre?: string
          producto_id?: string | null
          tipo?: string
          unidad_stock?: string
        }
        Relationships: [
          {
            foreignKeyName: "articulos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articulos_producto_id_empresa_id_fkey"
            columns: ["producto_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      beneficios_config: {
        Row: {
          activo: boolean
          created_at: string | null
          empresa_id: string
          habilitado_admin: boolean
          pesos_por_punto: number
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string | null
          empresa_id: string
          habilitado_admin?: boolean
          pesos_por_punto?: number
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string | null
          empresa_id?: string
          habilitado_admin?: boolean
          pesos_por_punto?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "beneficios_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      beneficios_movimientos: {
        Row: {
          cliente_id: string
          created_at: string | null
          detalle: string | null
          empresa_id: string
          id: string
          pedido_id: string | null
          puntos: number
          tipo: string
        }
        Insert: {
          cliente_id: string
          created_at?: string | null
          detalle?: string | null
          empresa_id: string
          id?: string
          pedido_id?: string | null
          puntos: number
          tipo: string
        }
        Update: {
          cliente_id?: string
          created_at?: string | null
          detalle?: string | null
          empresa_id?: string
          id?: string
          pedido_id?: string | null
          puntos?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "beneficios_movimientos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_beneficios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beneficios_movimientos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beneficios_movimientos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      canales_medios_pago: {
        Row: {
          canal: string
          created_at: string
          empresa_id: string
          id: string
          medio: string
          mp_credencial_id: string | null
          sucursal_id: string
          transferencia_cuenta_id: string | null
          updated_at: string
        }
        Insert: {
          canal: string
          created_at?: string
          empresa_id: string
          id?: string
          medio: string
          mp_credencial_id?: string | null
          sucursal_id: string
          transferencia_cuenta_id?: string | null
          updated_at?: string
        }
        Update: {
          canal?: string
          created_at?: string
          empresa_id?: string
          id?: string
          medio?: string
          mp_credencial_id?: string | null
          sucursal_id?: string
          transferencia_cuenta_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "canales_medios_pago_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canales_medios_pago_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_mapeo_mp"
            columns: ["mp_credencial_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "mp_credenciales"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "fk_mapeo_transferencia"
            columns: ["transferencia_cuenta_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "cuentas_transferencia"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      catalogo_version: {
        Row: {
          empresa_id: string
          sucursal_id: string
          updated_at: string
          version: number
        }
        Insert: {
          empresa_id: string
          sucursal_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          empresa_id?: string
          sucursal_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_version_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: true
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          activo: boolean
          codigo: string | null
          deleted_at: string | null
          empresa_id: string
          icono_url: string | null
          id: string
          nombre: string
          orden: number
          slug: string | null
        }
        Insert: {
          activo?: boolean
          codigo?: string | null
          deleted_at?: string | null
          empresa_id: string
          icono_url?: string | null
          id?: string
          nombre: string
          orden?: number
          slug?: string | null
        }
        Update: {
          activo?: boolean
          codigo?: string | null
          deleted_at?: string | null
          empresa_id?: string
          icono_url?: string | null
          id?: string
          nombre?: string
          orden?: number
          slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      chequeras: {
        Row: {
          created_at: string
          cuenta_banco_id: string
          descripcion: string | null
          desde: number
          empresa_id: string
          estado: string
          hasta: number
          id: string
          proximo: number
        }
        Insert: {
          created_at?: string
          cuenta_banco_id: string
          descripcion?: string | null
          desde: number
          empresa_id: string
          estado?: string
          hasta: number
          id?: string
          proximo: number
        }
        Update: {
          created_at?: string
          cuenta_banco_id?: string
          descripcion?: string | null
          desde?: number
          empresa_id?: string
          estado?: string
          hasta?: number
          id?: string
          proximo?: number
        }
        Relationships: [
          {
            foreignKeyName: "chequeras_cuenta_banco_id_empresa_id_fkey"
            columns: ["cuenta_banco_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "cuentas_banco"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "chequeras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cheques: {
        Row: {
          chequera_id: string | null
          created_at: string
          cuenta_banco_id: string | null
          empresa_id: string
          estado: string
          fecha_cobro: string
          fecha_emision: string
          formato: string
          id: string
          modalidad: string
          monto: number
          notas: string | null
          numero: number
          orden_pago_id: string | null
          proveedor_id: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          chequera_id?: string | null
          created_at?: string
          cuenta_banco_id?: string | null
          empresa_id: string
          estado?: string
          fecha_cobro: string
          fecha_emision?: string
          formato?: string
          id?: string
          modalidad?: string
          monto: number
          notas?: string | null
          numero: number
          orden_pago_id?: string | null
          proveedor_id?: string | null
          tipo?: string
          updated_at?: string
        }
        Update: {
          chequera_id?: string | null
          created_at?: string
          cuenta_banco_id?: string | null
          empresa_id?: string
          estado?: string
          fecha_cobro?: string
          fecha_emision?: string
          formato?: string
          id?: string
          modalidad?: string
          monto?: number
          notas?: string | null
          numero?: number
          orden_pago_id?: string | null
          proveedor_id?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cheques_chequera_id_empresa_id_fkey"
            columns: ["chequera_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "chequeras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "cheques_cuenta_banco_id_empresa_id_fkey"
            columns: ["cuenta_banco_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "cuentas_banco"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "cheques_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cheques_proveedor_id_empresa_id_fkey"
            columns: ["proveedor_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      cierres_caja: {
        Row: {
          cerrado_por: string | null
          created_at: string
          diferencia: number
          empresa_id: string
          fecha: string
          id: string
          observaciones: string | null
          sucursal_id: string
          totales_declarados: Json
          totales_sistema: Json
        }
        Insert: {
          cerrado_por?: string | null
          created_at?: string
          diferencia?: number
          empresa_id: string
          fecha: string
          id?: string
          observaciones?: string | null
          sucursal_id: string
          totales_declarados: Json
          totales_sistema: Json
        }
        Update: {
          cerrado_por?: string | null
          created_at?: string
          diferencia?: number
          empresa_id?: string
          fecha?: string
          id?: string
          observaciones?: string | null
          sucursal_id?: string
          totales_declarados?: Json
          totales_sistema?: Json
        }
        Relationships: []
      }
      clientes_beneficios: {
        Row: {
          created_at: string | null
          empresa_id: string
          id: string
          puntos: number
          puntos_historicos: number
          telefono: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          empresa_id: string
          id?: string
          puntos?: number
          puntos_historicos?: number
          telefono: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          empresa_id?: string
          id?: string
          puntos?: number
          puntos_historicos?: number
          telefono?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_beneficios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      colaborador_sesiones: {
        Row: {
          colaborador_id: string
          created_at: string
          empresa_id: string
          expira_at: string
          token: string
        }
        Insert: {
          colaborador_id: string
          created_at?: string
          empresa_id: string
          expira_at: string
          token?: string
        }
        Update: {
          colaborador_id?: string
          created_at?: string
          empresa_id?: string
          expira_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "colaborador_sesiones_colaborador_id_empresa_id_fkey"
            columns: ["colaborador_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "colaborador_sesiones_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      colaboradores: {
        Row: {
          activo: boolean
          alias_publico: string | null
          created_at: string | null
          emoji_reparto: string | null
          empresa_id: string
          id: string
          nombre: string
          pin_hash: string | null
          rol: string
          sucursal_id: string | null
        }
        Insert: {
          activo?: boolean
          alias_publico?: string | null
          created_at?: string | null
          emoji_reparto?: string | null
          empresa_id: string
          id?: string
          nombre: string
          pin_hash?: string | null
          rol?: string
          sucursal_id?: string | null
        }
        Update: {
          activo?: boolean
          alias_publico?: string | null
          created_at?: string | null
          emoji_reparto?: string | null
          empresa_id?: string
          id?: string
          nombre?: string
          pin_hash?: string | null
          rol?: string
          sucursal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "colaboradores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colaboradores_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      comprobantes_compra: {
        Row: {
          cae: string | null
          created_at: string
          empresa_id: string
          estado: string
          fecha: string
          fecha_vencimiento: string | null
          id: string
          iva: number | null
          letra: string | null
          neto: number | null
          numero_proveedor: string
          observaciones: string | null
          proveedor_id: string
          sucursal_id: string | null
          tipo: string
          total: number
        }
        Insert: {
          cae?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          fecha?: string
          fecha_vencimiento?: string | null
          id?: string
          iva?: number | null
          letra?: string | null
          neto?: number | null
          numero_proveedor: string
          observaciones?: string | null
          proveedor_id: string
          sucursal_id?: string | null
          tipo?: string
          total: number
        }
        Update: {
          cae?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          fecha?: string
          fecha_vencimiento?: string | null
          id?: string
          iva?: number | null
          letra?: string | null
          neto?: number | null
          numero_proveedor?: string
          observaciones?: string | null
          proveedor_id?: string
          sucursal_id?: string | null
          tipo?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "cc_sucursal_fk"
            columns: ["sucursal_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "comprobantes_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_compra_proveedor_id_empresa_id_fkey"
            columns: ["proveedor_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      comprobantes_compra_items: {
        Row: {
          articulo_id: string | null
          cantidad: number
          cantidad_operativa: number | null
          comprobante_id: string
          created_at: string
          descripcion: string
          empresa_id: string
          factor_snap: number | null
          id: string
          ingresa_stock: boolean
          precio_unitario: number
          presentacion_id: string | null
        }
        Insert: {
          articulo_id?: string | null
          cantidad: number
          cantidad_operativa?: number | null
          comprobante_id: string
          created_at?: string
          descripcion: string
          empresa_id: string
          factor_snap?: number | null
          id?: string
          ingresa_stock?: boolean
          precio_unitario: number
          presentacion_id?: string | null
        }
        Update: {
          articulo_id?: string | null
          cantidad?: number
          cantidad_operativa?: number | null
          comprobante_id?: string
          created_at?: string
          descripcion?: string
          empresa_id?: string
          factor_snap?: number | null
          id?: string
          ingresa_stock?: boolean
          precio_unitario?: number
          presentacion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comprobantes_compra_items_articulo_id_empresa_id_fkey"
            columns: ["articulo_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "articulos"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "comprobantes_compra_items_comprobante_id_empresa_id_fkey"
            columns: ["comprobante_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "comprobantes_compra"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "comprobantes_compra_items_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      comprobantes_compra_remitos: {
        Row: {
          comprobante_id: string
          created_at: string
          empresa_id: string
          id: string
          remito_id: string
        }
        Insert: {
          comprobante_id: string
          created_at?: string
          empresa_id: string
          id?: string
          remito_id: string
        }
        Update: {
          comprobante_id?: string
          created_at?: string
          empresa_id?: string
          id?: string
          remito_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comprobantes_compra_remitos_comprobante_id_empresa_id_fkey"
            columns: ["comprobante_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "comprobantes_compra"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "comprobantes_compra_remitos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_compra_remitos_remito_id_empresa_id_fkey"
            columns: ["remito_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "remitos_compra"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      cuenta_corriente_proveedor: {
        Row: {
          comprobante_id: string | null
          created_at: string
          detalle: string
          empresa_id: string
          id: string
          monto: number
          orden_pago_id: string | null
          proveedor_id: string
          tipo: string
        }
        Insert: {
          comprobante_id?: string | null
          created_at?: string
          detalle: string
          empresa_id: string
          id?: string
          monto: number
          orden_pago_id?: string | null
          proveedor_id: string
          tipo: string
        }
        Update: {
          comprobante_id?: string | null
          created_at?: string
          detalle?: string
          empresa_id?: string
          id?: string
          monto?: number
          orden_pago_id?: string | null
          proveedor_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ccp_orden_pago_fk"
            columns: ["orden_pago_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "ordenes_pago_proveedor"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "cuenta_corriente_proveedor_comprobante_id_empresa_id_fkey"
            columns: ["comprobante_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "comprobantes_compra"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "cuenta_corriente_proveedor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuenta_corriente_proveedor_proveedor_id_empresa_id_fkey"
            columns: ["proveedor_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      cuentas_banco: {
        Row: {
          activo: boolean
          alias: string | null
          banco: string
          cbu: string | null
          created_at: string
          empresa_id: string
          id: string
          moneda: string
          nro_cuenta: string | null
        }
        Insert: {
          activo?: boolean
          alias?: string | null
          banco: string
          cbu?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          moneda?: string
          nro_cuenta?: string | null
        }
        Update: {
          activo?: boolean
          alias?: string | null
          banco?: string
          cbu?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          moneda?: string
          nro_cuenta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_banco_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cuentas_transferencia: {
        Row: {
          activo: boolean
          alias: string | null
          cbu: string | null
          created_at: string
          empresa_id: string
          facturacion_config_id: string | null
          id: string
          nombre: string
          sucursal_id: string
          titular: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          alias?: string | null
          cbu?: string | null
          created_at?: string
          empresa_id: string
          facturacion_config_id?: string | null
          id?: string
          nombre: string
          sucursal_id: string
          titular?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          alias?: string | null
          cbu?: string | null
          created_at?: string
          empresa_id?: string
          facturacion_config_id?: string | null
          id?: string
          nombre?: string
          sucursal_id?: string
          titular?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ct_factcfg_fk"
            columns: ["facturacion_config_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "facturacion_config"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "cuentas_transferencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_transferencia_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_config: {
        Row: {
          activo: boolean | null
          costo_envio: number | null
          empresa_id: string | null
          envio_al_cadete: boolean
          horarios: Json | null
          id: string
          mensaje_fuera_horario: string | null
          mensaje_pausa: string | null
          mostrar_en_app: boolean
          pausado: boolean | null
          permitir_programado: boolean
          sucursal_id: string | null
          tolerancia_cierre: number | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          costo_envio?: number | null
          empresa_id?: string | null
          envio_al_cadete?: boolean
          horarios?: Json | null
          id?: string
          mensaje_fuera_horario?: string | null
          mensaje_pausa?: string | null
          mostrar_en_app?: boolean
          pausado?: boolean | null
          permitir_programado?: boolean
          sucursal_id?: string | null
          tolerancia_cierre?: number | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          costo_envio?: number | null
          empresa_id?: string | null
          envio_al_cadete?: boolean
          horarios?: Json | null
          id?: string
          mensaje_fuera_horario?: string | null
          mensaje_pausa?: string | null
          mostrar_en_app?: boolean
          pausado?: boolean | null
          permitir_programado?: boolean
          sucursal_id?: string | null
          tolerancia_cierre?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_config_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: true
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      dispositivo_instancias: {
        Row: {
          dispositivo_id: string | null
          empresa_id: string
          first_seen: string
          instancia_id: string
          last_seen: string
          sucursal_id: string | null
          tipo: string
          user_agent: string | null
        }
        Insert: {
          dispositivo_id?: string | null
          empresa_id: string
          first_seen?: string
          instancia_id: string
          last_seen?: string
          sucursal_id?: string | null
          tipo: string
          user_agent?: string | null
        }
        Update: {
          dispositivo_id?: string | null
          empresa_id?: string
          first_seen?: string
          instancia_id?: string
          last_seen?: string
          sucursal_id?: string | null
          tipo?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      dispositivos: {
        Row: {
          activo: boolean
          created_at: string
          device_token: string
          empresa_id: string
          id: string
          nombre: string
          sucursal_id: string
          tipo: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          device_token?: string
          empresa_id: string
          id?: string
          nombre: string
          sucursal_id: string
          tipo: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          device_token?: string
          empresa_id?: string
          id?: string
          nombre?: string
          sucursal_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispositivos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispositivos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_config: {
        Row: {
          allow_kiosk: boolean
          allow_online_orders: boolean
          arca_cert: string | null
          arca_key: string | null
          condicion_iva: string | null
          created_at: string
          cuit: string | null
          descuento_efectivo_pct: number
          empresa_id: string
          entrada_unificada: boolean
          favicon_url: string | null
          id: string
          logo_url: string | null
          mesas_activo: boolean
          modulos: Json | null
          moneda: string
          mostrar_agotados: boolean
          pedido_numero_diario: boolean
          primary_color: string | null
          punto_venta: number | null
          pwa_icono_url: string | null
          pwa_nombre: string | null
          razon_social: string | null
          secondary_color: string | null
          soporte_nombre: string | null
          soporte_whatsapp: string | null
          texto_bienvenida: string | null
        }
        Insert: {
          allow_kiosk?: boolean
          allow_online_orders?: boolean
          arca_cert?: string | null
          arca_key?: string | null
          condicion_iva?: string | null
          created_at?: string
          cuit?: string | null
          descuento_efectivo_pct?: number
          empresa_id: string
          entrada_unificada?: boolean
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          mesas_activo?: boolean
          modulos?: Json | null
          moneda?: string
          mostrar_agotados?: boolean
          pedido_numero_diario?: boolean
          primary_color?: string | null
          punto_venta?: number | null
          pwa_icono_url?: string | null
          pwa_nombre?: string | null
          razon_social?: string | null
          secondary_color?: string | null
          soporte_nombre?: string | null
          soporte_whatsapp?: string | null
          texto_bienvenida?: string | null
        }
        Update: {
          allow_kiosk?: boolean
          allow_online_orders?: boolean
          arca_cert?: string | null
          arca_key?: string | null
          condicion_iva?: string | null
          created_at?: string
          cuit?: string | null
          descuento_efectivo_pct?: number
          empresa_id?: string
          entrada_unificada?: boolean
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          mesas_activo?: boolean
          modulos?: Json | null
          moneda?: string
          mostrar_agotados?: boolean
          pedido_numero_diario?: boolean
          primary_color?: string | null
          punto_venta?: number | null
          pwa_icono_url?: string | null
          pwa_nombre?: string | null
          razon_social?: string | null
          secondary_color?: string | null
          soporte_nombre?: string | null
          soporte_whatsapp?: string | null
          texto_bienvenida?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresa_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          activo: boolean
          created_at: string
          fee_mensual: number | null
          id: string
          logo_url: string | null
          nombre: string
          plan: string
          slug: string
          ultimo_numero_pedido: number | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          fee_mensual?: number | null
          id?: string
          logo_url?: string | null
          nombre: string
          plan?: string
          slug: string
          ultimo_numero_pedido?: number | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          fee_mensual?: number | null
          id?: string
          logo_url?: string | null
          nombre?: string
          plan?: string
          slug?: string
          ultimo_numero_pedido?: number | null
        }
        Relationships: []
      }
      facturacion_config: {
        Row: {
          activo: boolean
          ambiente: string | null
          auto_facturar: boolean
          cert_pem: string | null
          certificado: string | null
          condicion_fiscal: string | null
          condicion_iva: string | null
          created_at: string
          cuit: string | null
          emite_factura_a: boolean
          empresa_id: string
          es_fallback: boolean
          estado: string
          id: string
          key_pem: string | null
          metodos_auto: Json
          proveedor: string
          punto_venta: number | null
          razon_social: string | null
          sucursal_id: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          ambiente?: string | null
          auto_facturar?: boolean
          cert_pem?: string | null
          certificado?: string | null
          condicion_fiscal?: string | null
          condicion_iva?: string | null
          created_at?: string
          cuit?: string | null
          emite_factura_a?: boolean
          empresa_id: string
          es_fallback?: boolean
          estado?: string
          id?: string
          key_pem?: string | null
          metodos_auto?: Json
          proveedor?: string
          punto_venta?: number | null
          razon_social?: string | null
          sucursal_id?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          ambiente?: string | null
          auto_facturar?: boolean
          cert_pem?: string | null
          certificado?: string | null
          condicion_fiscal?: string | null
          condicion_iva?: string | null
          created_at?: string
          cuit?: string | null
          emite_factura_a?: boolean
          empresa_id?: string
          es_fallback?: boolean
          estado?: string
          id?: string
          key_pem?: string | null
          metodos_auto?: Json
          proveedor?: string
          punto_venta?: number | null
          razon_social?: string | null
          sucursal_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturacion_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturacion_config_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_factcfg_sucursal"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas: {
        Row: {
          ambiente: string
          cae: string | null
          cae_vencimiento: string | null
          cond_iva_receptor: number
          created_at: string | null
          doc_nro: string
          doc_tipo: number
          empresa_id: string
          error_msg: string | null
          estado: string
          facturacion_config_id: string | null
          id: string
          imp_iva: number | null
          imp_neto: number | null
          nro_cbte: number | null
          pedido_id: string
          punto_venta: number
          sucursal_id: string | null
          tipo_cbte: number
          total: number
        }
        Insert: {
          ambiente: string
          cae?: string | null
          cae_vencimiento?: string | null
          cond_iva_receptor?: number
          created_at?: string | null
          doc_nro?: string
          doc_tipo?: number
          empresa_id: string
          error_msg?: string | null
          estado?: string
          facturacion_config_id?: string | null
          id?: string
          imp_iva?: number | null
          imp_neto?: number | null
          nro_cbte?: number | null
          pedido_id: string
          punto_venta: number
          sucursal_id?: string | null
          tipo_cbte?: number
          total: number
        }
        Update: {
          ambiente?: string
          cae?: string | null
          cae_vencimiento?: string | null
          cond_iva_receptor?: number
          created_at?: string | null
          doc_nro?: string
          doc_tipo?: number
          empresa_id?: string
          error_msg?: string | null
          estado?: string
          facturacion_config_id?: string | null
          id?: string
          imp_iva?: number | null
          imp_neto?: number | null
          nro_cbte?: number | null
          pedido_id?: string
          punto_venta?: number
          sucursal_id?: string | null
          tipo_cbte?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "fact_factcfg_fk"
            columns: ["facturacion_config_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "facturacion_config"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "facturas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_opciones: {
        Row: {
          activo: boolean
          empresa_id: string
          id: string
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          empresa_id: string
          id?: string
          nombre: string
          orden?: number
        }
        Update: {
          activo?: boolean
          empresa_id?: string
          id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "grupos_opciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      inventario_opciones: {
        Row: {
          disponible: boolean
          empresa_id: string
          id: string
          opcion_id: string
          stock: number | null
          sucursal_id: string
          updated_at: string
        }
        Insert: {
          disponible?: boolean
          empresa_id: string
          id?: string
          opcion_id: string
          stock?: number | null
          sucursal_id: string
          updated_at?: string
        }
        Update: {
          disponible?: boolean
          empresa_id?: string
          id?: string
          opcion_id?: string
          stock?: number | null
          sucursal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventario_opciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_opciones_opcion_id_fkey"
            columns: ["opcion_id"]
            isOneToOne: false
            referencedRelation: "opciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_opciones_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      mesa_cuentas: {
        Row: {
          closed_at: string | null
          created_at: string
          empresa_id: string
          estado: string
          id: string
          nombre_cliente: string | null
          numero_mesa: number
          sucursal_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          id?: string
          nombre_cliente?: string | null
          numero_mesa: number
          sucursal_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          id?: string
          nombre_cliente?: string | null
          numero_mesa?: number
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mesa_cuentas_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_credenciales: {
        Row: {
          access_token: string
          activo: boolean
          created_at: string | null
          empresa_id: string
          expires_at: string | null
          facturacion_config_id: string | null
          id: string
          mp_user_id: string
          nombre: string
          public_key: string | null
          refresh_token: string
          sucursal_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          activo?: boolean
          created_at?: string | null
          empresa_id: string
          expires_at?: string | null
          facturacion_config_id?: string | null
          id?: string
          mp_user_id: string
          nombre?: string
          public_key?: string | null
          refresh_token: string
          sucursal_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          activo?: boolean
          created_at?: string | null
          empresa_id?: string
          expires_at?: string | null
          facturacion_config_id?: string | null
          id?: string
          mp_user_id?: string
          nombre?: string
          public_key?: string | null
          refresh_token?: string
          sucursal_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_mpcred_sucursal"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_credenciales_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mpc_factcfg_fk"
            columns: ["facturacion_config_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "facturacion_config"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      opciones: {
        Row: {
          activo: boolean
          codigo: string | null
          color: string | null
          deleted_at: string | null
          descripcion: string | null
          emoji: string | null
          empresa_id: string
          es_novedad: boolean
          grupo_id: string
          id: string
          imagen_url: string | null
          nombre: string
          orden: number
          precio_adicional: number | null
          puntos_canje: number | null
          visible_kiosk: boolean
        }
        Insert: {
          activo?: boolean
          codigo?: string | null
          color?: string | null
          deleted_at?: string | null
          descripcion?: string | null
          emoji?: string | null
          empresa_id: string
          es_novedad?: boolean
          grupo_id: string
          id?: string
          imagen_url?: string | null
          nombre: string
          orden?: number
          precio_adicional?: number | null
          puntos_canje?: number | null
          visible_kiosk?: boolean
        }
        Update: {
          activo?: boolean
          codigo?: string | null
          color?: string | null
          deleted_at?: string | null
          descripcion?: string | null
          emoji?: string | null
          empresa_id?: string
          es_novedad?: boolean
          grupo_id?: string
          id?: string
          imagen_url?: string | null
          nombre?: string
          orden?: number
          precio_adicional?: number | null
          puntos_canje?: number | null
          visible_kiosk?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "opciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opciones_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_opciones"
            referencedColumns: ["id"]
          },
        ]
      }
      operadores: {
        Row: {
          activo: boolean
          created_at: string
          deleted_at: string | null
          empresa_id: string
          id: string
          nombre: string
          pin_hash: string
          puede_cobrar: boolean
          puede_preparar: boolean
          sucursal_id: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          deleted_at?: string | null
          empresa_id: string
          id?: string
          nombre: string
          pin_hash: string
          puede_cobrar?: boolean
          puede_preparar?: boolean
          sucursal_id?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          deleted_at?: string | null
          empresa_id?: string
          id?: string
          nombre?: string
          pin_hash?: string
          puede_cobrar?: boolean
          puede_preparar?: boolean
          sucursal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operadores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operadores_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_sessions: {
        Row: {
          created_at: string
          dispositivo_id: string
          empresa_id: string
          estado: string
          fin: string | null
          id: string
          inicio: string
          operador_id: string
          sucursal_id: string
        }
        Insert: {
          created_at?: string
          dispositivo_id: string
          empresa_id: string
          estado?: string
          fin?: string | null
          id?: string
          inicio?: string
          operador_id: string
          sucursal_id: string
        }
        Update: {
          created_at?: string
          dispositivo_id?: string
          empresa_id?: string
          estado?: string
          fin?: string | null
          id?: string
          inicio?: string
          operador_id?: string
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_sessions_dispositivo_id_fkey"
            columns: ["dispositivo_id"]
            isOneToOne: false
            referencedRelation: "dispositivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_sessions_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_sessions_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "operadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_sessions_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_compra: {
        Row: {
          created_at: string
          empresa_id: string
          estado: string
          fecha: string
          id: string
          numero: number
          observaciones: string | null
          proveedor_id: string
          sucursal_id: string | null
        }
        Insert: {
          created_at?: string
          empresa_id: string
          estado?: string
          fecha?: string
          id?: string
          numero: number
          observaciones?: string | null
          proveedor_id: string
          sucursal_id?: string | null
        }
        Update: {
          created_at?: string
          empresa_id?: string
          estado?: string
          fecha?: string
          id?: string
          numero?: number
          observaciones?: string | null
          proveedor_id?: string
          sucursal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_empresa_id_fkey"
            columns: ["proveedor_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "ordenes_compra_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_compra_items: {
        Row: {
          articulo_id: string
          cantidad: number
          costo_previsto: number | null
          created_at: string
          empresa_id: string
          id: string
          orden_compra_id: string
          presentacion_id: string | null
        }
        Insert: {
          articulo_id: string
          cantidad: number
          costo_previsto?: number | null
          created_at?: string
          empresa_id: string
          id?: string
          orden_compra_id: string
          presentacion_id?: string | null
        }
        Update: {
          articulo_id?: string
          cantidad?: number
          costo_previsto?: number | null
          created_at?: string
          empresa_id?: string
          id?: string
          orden_compra_id?: string
          presentacion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_items_articulo_id_empresa_id_fkey"
            columns: ["articulo_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "articulos"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "ordenes_compra_items_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_items_orden_compra_id_empresa_id_fkey"
            columns: ["orden_compra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "ordenes_compra_items_presentacion_id_fkey"
            columns: ["presentacion_id"]
            isOneToOne: false
            referencedRelation: "articulo_presentaciones_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_pago_imputaciones: {
        Row: {
          comprobante_id: string
          created_at: string
          empresa_id: string
          id: string
          monto: number
          orden_pago_id: string
        }
        Insert: {
          comprobante_id: string
          created_at?: string
          empresa_id: string
          id?: string
          monto: number
          orden_pago_id: string
        }
        Update: {
          comprobante_id?: string
          created_at?: string
          empresa_id?: string
          id?: string
          monto?: number
          orden_pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_pago_imputaciones_comprobante_id_empresa_id_fkey"
            columns: ["comprobante_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "comprobantes_compra"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "ordenes_pago_imputaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_pago_imputaciones_orden_pago_id_empresa_id_fkey"
            columns: ["orden_pago_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "ordenes_pago_proveedor"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      ordenes_pago_proveedor: {
        Row: {
          anulada: boolean
          created_at: string
          cuenta_pago_id: string | null
          empresa_id: string
          fecha: string
          fecha_anulacion: string | null
          id: string
          medio: string
          motivo_anulacion: string | null
          numero: number
          observaciones: string | null
          proveedor_id: string
          total: number
        }
        Insert: {
          anulada?: boolean
          created_at?: string
          cuenta_pago_id?: string | null
          empresa_id: string
          fecha?: string
          fecha_anulacion?: string | null
          id?: string
          medio: string
          motivo_anulacion?: string | null
          numero: number
          observaciones?: string | null
          proveedor_id: string
          total: number
        }
        Update: {
          anulada?: boolean
          created_at?: string
          cuenta_pago_id?: string | null
          empresa_id?: string
          fecha?: string
          fecha_anulacion?: string | null
          id?: string
          medio?: string
          motivo_anulacion?: string | null
          numero?: number
          observaciones?: string | null
          proveedor_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_pago_proveedor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_pago_proveedor_proveedor_id_empresa_id_fkey"
            columns: ["proveedor_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      ordenes_pago_valores: {
        Row: {
          cheque_id: string | null
          created_at: string
          cuenta_banco_id: string | null
          empresa_id: string
          id: string
          monto: number
          orden_pago_id: string
          orden_pago_origen_id: string | null
          tipo: string
        }
        Insert: {
          cheque_id?: string | null
          created_at?: string
          cuenta_banco_id?: string | null
          empresa_id: string
          id?: string
          monto: number
          orden_pago_id: string
          orden_pago_origen_id?: string | null
          tipo: string
        }
        Update: {
          cheque_id?: string | null
          created_at?: string
          cuenta_banco_id?: string | null
          empresa_id?: string
          id?: string
          monto?: number
          orden_pago_id?: string
          orden_pago_origen_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_pago_valores_cheque_id_empresa_id_fkey"
            columns: ["cheque_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "cheques"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "ordenes_pago_valores_cuenta_banco_id_empresa_id_fkey"
            columns: ["cuenta_banco_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "cuentas_banco"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "ordenes_pago_valores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_pago_valores_orden_pago_id_empresa_id_fkey"
            columns: ["orden_pago_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "ordenes_pago_proveedor"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "ordenes_pago_valores_orden_pago_origen_id_fkey"
            columns: ["orden_pago_origen_id"]
            isOneToOne: false
            referencedRelation: "ordenes_pago_proveedor"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_estados_log: {
        Row: {
          created_at: string
          estado_anterior: string | null
          estado_nuevo: string
          id: string
          operador_id: string | null
          pedido_id: string
        }
        Insert: {
          created_at?: string
          estado_anterior?: string | null
          estado_nuevo: string
          id?: string
          operador_id?: string | null
          pedido_id: string
        }
        Update: {
          created_at?: string
          estado_anterior?: string | null
          estado_nuevo?: string
          id?: string
          operador_id?: string | null
          pedido_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_estados_log_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "operadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_estados_log_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_item_opciones: {
        Row: {
          color_snap: string | null
          emoji_snap: string | null
          id: string
          nombre_snap: string
          opcion_id: string | null
          pedido_item_id: string
        }
        Insert: {
          color_snap?: string | null
          emoji_snap?: string | null
          id?: string
          nombre_snap: string
          opcion_id?: string | null
          pedido_item_id: string
        }
        Update: {
          color_snap?: string | null
          emoji_snap?: string | null
          id?: string
          nombre_snap?: string
          opcion_id?: string | null
          pedido_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_item_opciones_opcion_id_fkey"
            columns: ["opcion_id"]
            isOneToOne: false
            referencedRelation: "opciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_item_opciones_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_items"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_items: {
        Row: {
          cantidad: number
          combo_ref: string | null
          factor_stock_snap: number | null
          id: string
          nombre_presentacion_snap: string
          nombre_producto_snap: string
          notas: string | null
          pedido_id: string
          precio_snap: number
          presentacion_id: string | null
          promo_id: string | null
          promo_nombre_snap: string | null
          promo_precio_snap: number | null
        }
        Insert: {
          cantidad?: number
          combo_ref?: string | null
          factor_stock_snap?: number | null
          id?: string
          nombre_presentacion_snap: string
          nombre_producto_snap: string
          notas?: string | null
          pedido_id: string
          precio_snap: number
          presentacion_id?: string | null
          promo_id?: string | null
          promo_nombre_snap?: string | null
          promo_precio_snap?: number | null
        }
        Update: {
          cantidad?: number
          combo_ref?: string | null
          factor_stock_snap?: number | null
          id?: string
          nombre_presentacion_snap?: string
          nombre_producto_snap?: string
          notas?: string | null
          pedido_id?: string
          precio_snap?: number
          presentacion_id?: string | null
          promo_id?: string | null
          promo_nombre_snap?: string | null
          promo_precio_snap?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_items_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_presentacion_id_fkey"
            columns: ["presentacion_id"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_pagos: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          metodo: string
          monto: number
          pedido_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          metodo: string
          monto: number
          pedido_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          metodo?: string
          monto?: number
          pedido_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          captura_transferencia_url: string | null
          codigo_retiro: string
          colaborador_id: string | null
          colaborador_nombre: string | null
          comanda_impresa_at: string | null
          costo_envio: number | null
          created_at: string
          datos_delivery: Json | null
          descuento_cobro: number
          descuento_cobro_detalle: string | null
          detalle_facturable: string | null
          dispositivo_id: string | null
          empresa_id: string
          entregado_at: string | null
          estado: string
          fecha_pedido: string
          hora_retiro: string | null
          id: string
          mesa_cuenta_id: string | null
          metodo_pago: string | null
          motivo_cancelacion: string | null
          mp_credencial_id: string | null
          mp_payment_id: string | null
          mp_preference_id: string | null
          nombre_cliente: string | null
          notas: string | null
          numero_mesa: number | null
          numero_pedido: number
          operator_session_id: string | null
          origen: string
          pagado: boolean
          prioridad: string
          receptor_cond_iva: number | null
          receptor_doc_nro: string | null
          receptor_doc_tipo: number | null
          receptor_razon_social: string | null
          session_id: string | null
          stock_descontado: boolean
          sucursal_id: string | null
          telefono_beneficios: string | null
          ticket_impreso_at: string | null
          tiempo_estimado: number | null
          tipo_pedido: string | null
          total: number
          transferencia_cuenta_id: string | null
          updated_at: string
          visitante_id: string | null
        }
        Insert: {
          captura_transferencia_url?: string | null
          codigo_retiro?: string
          colaborador_id?: string | null
          colaborador_nombre?: string | null
          comanda_impresa_at?: string | null
          costo_envio?: number | null
          created_at?: string
          datos_delivery?: Json | null
          descuento_cobro?: number
          descuento_cobro_detalle?: string | null
          detalle_facturable?: string | null
          dispositivo_id?: string | null
          empresa_id: string
          entregado_at?: string | null
          estado?: string
          fecha_pedido?: string
          hora_retiro?: string | null
          id?: string
          mesa_cuenta_id?: string | null
          metodo_pago?: string | null
          motivo_cancelacion?: string | null
          mp_credencial_id?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          nombre_cliente?: string | null
          notas?: string | null
          numero_mesa?: number | null
          numero_pedido: number
          operator_session_id?: string | null
          origen?: string
          pagado?: boolean
          prioridad?: string
          receptor_cond_iva?: number | null
          receptor_doc_nro?: string | null
          receptor_doc_tipo?: number | null
          receptor_razon_social?: string | null
          session_id?: string | null
          stock_descontado?: boolean
          sucursal_id?: string | null
          telefono_beneficios?: string | null
          ticket_impreso_at?: string | null
          tiempo_estimado?: number | null
          tipo_pedido?: string | null
          total?: number
          transferencia_cuenta_id?: string | null
          updated_at?: string
          visitante_id?: string | null
        }
        Update: {
          captura_transferencia_url?: string | null
          codigo_retiro?: string
          colaborador_id?: string | null
          colaborador_nombre?: string | null
          comanda_impresa_at?: string | null
          costo_envio?: number | null
          created_at?: string
          datos_delivery?: Json | null
          descuento_cobro?: number
          descuento_cobro_detalle?: string | null
          detalle_facturable?: string | null
          dispositivo_id?: string | null
          empresa_id?: string
          entregado_at?: string | null
          estado?: string
          fecha_pedido?: string
          hora_retiro?: string | null
          id?: string
          mesa_cuenta_id?: string | null
          metodo_pago?: string | null
          motivo_cancelacion?: string | null
          mp_credencial_id?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          nombre_cliente?: string | null
          notas?: string | null
          numero_mesa?: number | null
          numero_pedido?: number
          operator_session_id?: string | null
          origen?: string
          pagado?: boolean
          prioridad?: string
          receptor_cond_iva?: number | null
          receptor_doc_nro?: string | null
          receptor_doc_tipo?: number | null
          receptor_razon_social?: string | null
          session_id?: string | null
          stock_descontado?: boolean
          sucursal_id?: string | null
          telefono_beneficios?: string | null
          ticket_impreso_at?: string | null
          tiempo_estimado?: number | null
          tipo_pedido?: string | null
          total?: number
          transferencia_cuenta_id?: string | null
          updated_at?: string
          visitante_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_dispositivo_id_fkey"
            columns: ["dispositivo_id"]
            isOneToOne: false
            referencedRelation: "dispositivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_mesa_cuenta_id_fkey"
            columns: ["mesa_cuenta_id"]
            isOneToOne: false
            referencedRelation: "mesa_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_mp_credencial_id_fkey"
            columns: ["mp_credencial_id"]
            isOneToOne: false
            referencedRelation: "mp_credenciales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_operator_session_id_fkey"
            columns: ["operator_session_id"]
            isOneToOne: false
            referencedRelation: "operator_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "operator_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_transferencia_cuenta_id_fkey"
            columns: ["transferencia_cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas_transferencia"
            referencedColumns: ["id"]
          },
        ]
      }
      presentacion_grupos: {
        Row: {
          grupo_id: string
          id: string
          presentacion_id: string
        }
        Insert: {
          grupo_id: string
          id?: string
          presentacion_id: string
        }
        Update: {
          grupo_id?: string
          id?: string
          presentacion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentacion_grupos_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_opciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentacion_grupos_presentacion_id_fkey"
            columns: ["presentacion_id"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      presentaciones: {
        Row: {
          activo: boolean
          empresa_id: string
          es_novedad: boolean
          factor_stock: number
          id: string
          imagen_url: string | null
          nombre: string
          opciones_max: number
          opciones_min: number
          orden: number
          permite_opciones: boolean
          precio: number
          producto_id: string
          visible_kiosk: boolean
        }
        Insert: {
          activo?: boolean
          empresa_id: string
          es_novedad?: boolean
          factor_stock?: number
          id?: string
          imagen_url?: string | null
          nombre: string
          opciones_max?: number
          opciones_min?: number
          orden?: number
          permite_opciones?: boolean
          precio: number
          producto_id: string
          visible_kiosk?: boolean
        }
        Update: {
          activo?: boolean
          empresa_id?: string
          es_novedad?: boolean
          factor_stock?: number
          id?: string
          imagen_url?: string | null
          nombre?: string
          opciones_max?: number
          opciones_min?: number
          orden?: number
          permite_opciones?: boolean
          precio?: number
          producto_id?: string
          visible_kiosk?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "presentaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentaciones_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      producto_imagenes: {
        Row: {
          created_at: string
          empresa_id: string
          es_principal: boolean
          id: string
          orden: number
          presentacion_id: string | null
          producto_id: string
          url: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          es_principal?: boolean
          id?: string
          orden?: number
          presentacion_id?: string | null
          producto_id: string
          url: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          es_principal?: boolean
          id?: string
          orden?: number
          presentacion_id?: string | null
          producto_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "producto_imagenes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_imagenes_presentacion_id_fkey"
            columns: ["presentacion_id"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_imagenes_producto_empresa_fk"
            columns: ["producto_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      producto_stock: {
        Row: {
          cantidad: number
          empresa_id: string
          id: string
          producto_id: string
          stock_minimo: number
          sucursal_id: string
          updated_at: string
        }
        Insert: {
          cantidad?: number
          empresa_id: string
          id?: string
          producto_id: string
          stock_minimo?: number
          sucursal_id: string
          updated_at?: string
        }
        Update: {
          cantidad?: number
          empresa_id?: string
          id?: string
          producto_id?: string
          stock_minimo?: number
          sucursal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "producto_stock_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_stock_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_stock_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          categoria_id: string
          codigo: string | null
          controla_stock: boolean
          deleted_at: string | null
          descripcion: string | null
          empresa_id: string
          id: string
          imagen_url: string | null
          nombre: string
          orden: number
          slug: string | null
          visible_delivery: boolean
          visible_kiosk: boolean
          visible_mesa: boolean
          visible_takeaway: boolean
        }
        Insert: {
          activo?: boolean
          categoria_id: string
          codigo?: string | null
          controla_stock?: boolean
          deleted_at?: string | null
          descripcion?: string | null
          empresa_id: string
          id?: string
          imagen_url?: string | null
          nombre: string
          orden?: number
          slug?: string | null
          visible_delivery?: boolean
          visible_kiosk?: boolean
          visible_mesa?: boolean
          visible_takeaway?: boolean
        }
        Update: {
          activo?: boolean
          categoria_id?: string
          codigo?: string | null
          controla_stock?: boolean
          deleted_at?: string | null
          descripcion?: string | null
          empresa_id?: string
          id?: string
          imagen_url?: string | null
          nombre?: string
          orden?: number
          slug?: string | null
          visible_delivery?: boolean
          visible_kiosk?: boolean
          visible_mesa?: boolean
          visible_takeaway?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "productos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_slot_presentaciones: {
        Row: {
          empresa_id: string
          id: string
          presentacion_id: string
          slot_id: string
        }
        Insert: {
          empresa_id: string
          id?: string
          presentacion_id: string
          slot_id: string
        }
        Update: {
          empresa_id?: string
          id?: string
          presentacion_id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_slot_presentaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_slot_presentaciones_presentacion_id_fkey"
            columns: ["presentacion_id"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_slot_presentaciones_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "promo_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_slots: {
        Row: {
          cantidad: number
          empresa_id: string
          id: string
          orden: number
          promo_id: string
          titulo: string
        }
        Insert: {
          cantidad?: number
          empresa_id: string
          id?: string
          orden: number
          promo_id: string
          titulo?: string
        }
        Update: {
          cantidad?: number
          empresa_id?: string
          id?: string
          orden?: number
          promo_id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_slots_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_slots_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
        ]
      }
      promociones: {
        Row: {
          activo: boolean
          created_at: string
          descripcion: string | null
          empresa_id: string
          es_novedad: boolean
          id: string
          imagen_url: string | null
          nombre: string
          precio: number
          precio_regular: number | null
          vigencia_desde: string | null
          vigencia_hasta: string | null
          visible_delivery: boolean
          visible_kiosk: boolean
          visible_mesa: boolean
          visible_takeaway: boolean
        }
        Insert: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          empresa_id: string
          es_novedad?: boolean
          id?: string
          imagen_url?: string | null
          nombre: string
          precio: number
          precio_regular?: number | null
          vigencia_desde?: string | null
          vigencia_hasta?: string | null
          visible_delivery?: boolean
          visible_kiosk?: boolean
          visible_mesa?: boolean
          visible_takeaway?: boolean
        }
        Update: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          empresa_id?: string
          es_novedad?: boolean
          id?: string
          imagen_url?: string | null
          nombre?: string
          precio?: number
          precio_regular?: number | null
          vigencia_desde?: string | null
          vigencia_hasta?: string | null
          visible_delivery?: boolean
          visible_kiosk?: boolean
          visible_mesa?: boolean
          visible_takeaway?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "promociones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      proveedores: {
        Row: {
          activo: boolean
          created_at: string
          cuit: string | null
          direccion: string | null
          email: string | null
          empresa_id: string
          id: string
          nombre: string
          observaciones: string | null
          razon_social: string | null
          telefono: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          cuit?: string | null
          direccion?: string | null
          email?: string | null
          empresa_id: string
          id?: string
          nombre: string
          observaciones?: string | null
          razon_social?: string | null
          telefono?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          cuit?: string | null
          direccion?: string | null
          email?: string | null
          empresa_id?: string
          id?: string
          nombre?: string
          observaciones?: string | null
          razon_social?: string | null
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      remitos_compra: {
        Row: {
          confirmado_at: string | null
          created_at: string
          empresa_id: string
          estado: string
          fecha: string
          id: string
          numero: number
          numero_proveedor: string | null
          observaciones: string | null
          orden_compra_id: string | null
          proveedor_id: string
          sucursal_id: string
          tipo: string
        }
        Insert: {
          confirmado_at?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          fecha?: string
          id?: string
          numero: number
          numero_proveedor?: string | null
          observaciones?: string | null
          orden_compra_id?: string | null
          proveedor_id: string
          sucursal_id: string
          tipo?: string
        }
        Update: {
          confirmado_at?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          fecha?: string
          id?: string
          numero?: number
          numero_proveedor?: string | null
          observaciones?: string | null
          orden_compra_id?: string | null
          proveedor_id?: string
          sucursal_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "remitos_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_compra_orden_compra_id_empresa_id_fkey"
            columns: ["orden_compra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "remitos_compra_proveedor_id_empresa_id_fkey"
            columns: ["proveedor_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "remitos_compra_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      remitos_compra_items: {
        Row: {
          articulo_id: string
          cantidad: number
          cantidad_operativa: number
          cantidad_pedida: number | null
          costo_unitario: number
          created_at: string
          empresa_id: string
          factor_snap: number
          id: string
          presentacion_id: string | null
          remito_id: string
        }
        Insert: {
          articulo_id: string
          cantidad: number
          cantidad_operativa: number
          cantidad_pedida?: number | null
          costo_unitario: number
          created_at?: string
          empresa_id: string
          factor_snap: number
          id?: string
          presentacion_id?: string | null
          remito_id: string
        }
        Update: {
          articulo_id?: string
          cantidad?: number
          cantidad_operativa?: number
          cantidad_pedida?: number | null
          costo_unitario?: number
          created_at?: string
          empresa_id?: string
          factor_snap?: number
          id?: string
          presentacion_id?: string | null
          remito_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remitos_compra_items_articulo_id_empresa_id_fkey"
            columns: ["articulo_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "articulos"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "remitos_compra_items_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_compra_items_presentacion_id_fkey"
            columns: ["presentacion_id"]
            isOneToOne: false
            referencedRelation: "articulo_presentaciones_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_compra_items_remito_id_empresa_id_fkey"
            columns: ["remito_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "remitos_compra"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      reparto_posiciones: {
        Row: {
          colaborador_id: string
          empresa_id: string
          lat: number
          lng: number
          sucursal_id: string | null
          updated_at: string
        }
        Insert: {
          colaborador_id: string
          empresa_id: string
          lat: number
          lng: number
          sucursal_id?: string | null
          updated_at?: string
        }
        Update: {
          colaborador_id?: string
          empresa_id?: string
          lat?: number
          lng?: number
          sucursal_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reparto_posiciones_colaborador_id_empresa_id_fkey"
            columns: ["colaborador_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "reparto_posiciones_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: true
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movimientos: {
        Row: {
          articulo_id: string | null
          comprobante_compra_id: string | null
          costo_unitario: number | null
          created_at: string
          delta: number
          detalle: string | null
          empresa_id: string
          id: string
          motivo: string
          pedido_id: string | null
          producto_id: string | null
          remito_id: string | null
          sucursal_id: string
        }
        Insert: {
          articulo_id?: string | null
          comprobante_compra_id?: string | null
          costo_unitario?: number | null
          created_at?: string
          delta: number
          detalle?: string | null
          empresa_id: string
          id?: string
          motivo: string
          pedido_id?: string | null
          producto_id?: string | null
          remito_id?: string | null
          sucursal_id: string
        }
        Update: {
          articulo_id?: string | null
          comprobante_compra_id?: string | null
          costo_unitario?: number | null
          created_at?: string
          delta?: number
          detalle?: string | null
          empresa_id?: string
          id?: string
          motivo?: string
          pedido_id?: string | null
          producto_id?: string | null
          remito_id?: string | null
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sm_comprobante_fk"
            columns: ["comprobante_compra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "comprobantes_compra"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "stock_movimientos_articulo_id_fkey"
            columns: ["articulo_id"]
            isOneToOne: false
            referencedRelation: "articulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movimientos_comprobante_compra_id_fkey"
            columns: ["comprobante_compra_id"]
            isOneToOne: false
            referencedRelation: "comprobantes_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movimientos_remito_id_fkey"
            columns: ["remito_id"]
            isOneToOne: false
            referencedRelation: "remitos_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      sucursal_catalogo_config: {
        Row: {
          disponible: boolean
          empresa_id: string
          entidad_id: string
          entidad_tipo: string
          id: string
          sucursal_id: string
        }
        Insert: {
          disponible?: boolean
          empresa_id: string
          entidad_id: string
          entidad_tipo: string
          id?: string
          sucursal_id: string
        }
        Update: {
          disponible?: boolean
          empresa_id?: string
          entidad_id?: string
          entidad_tipo?: string
          id?: string
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sucursal_catalogo_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sucursal_catalogo_config_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      sucursal_pagos: {
        Row: {
          acepta_efectivo: boolean
          acepta_efectivo_delivery: boolean
          acepta_efectivo_kiosk: boolean
          acepta_efectivo_mesa: boolean
          acepta_efectivo_takeaway: boolean
          acepta_mp: boolean
          acepta_mp_delivery: boolean | null
          acepta_mp_kiosk: boolean | null
          acepta_mp_mesa: boolean
          acepta_mp_takeaway: boolean
          acepta_transferencia: boolean
          acepta_transferencia_delivery: boolean
          acepta_transferencia_kiosk: boolean
          acepta_transferencia_mesa: boolean
          acepta_transferencia_takeaway: boolean
          created_at: string
          empresa_id: string
          id: string
          sucursal_id: string
        }
        Insert: {
          acepta_efectivo?: boolean
          acepta_efectivo_delivery?: boolean
          acepta_efectivo_kiosk?: boolean
          acepta_efectivo_mesa?: boolean
          acepta_efectivo_takeaway?: boolean
          acepta_mp?: boolean
          acepta_mp_delivery?: boolean | null
          acepta_mp_kiosk?: boolean | null
          acepta_mp_mesa?: boolean
          acepta_mp_takeaway?: boolean
          acepta_transferencia?: boolean
          acepta_transferencia_delivery?: boolean
          acepta_transferencia_kiosk?: boolean
          acepta_transferencia_mesa?: boolean
          acepta_transferencia_takeaway?: boolean
          created_at?: string
          empresa_id: string
          id?: string
          sucursal_id: string
        }
        Update: {
          acepta_efectivo?: boolean
          acepta_efectivo_delivery?: boolean
          acepta_efectivo_kiosk?: boolean
          acepta_efectivo_mesa?: boolean
          acepta_efectivo_takeaway?: boolean
          acepta_mp?: boolean
          acepta_mp_delivery?: boolean | null
          acepta_mp_kiosk?: boolean | null
          acepta_mp_mesa?: boolean
          acepta_mp_takeaway?: boolean
          acepta_transferencia?: boolean
          acepta_transferencia_delivery?: boolean
          acepta_transferencia_kiosk?: boolean
          acepta_transferencia_mesa?: boolean
          acepta_transferencia_takeaway?: boolean
          created_at?: string
          empresa_id?: string
          id?: string
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sucursal_pagos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sucursal_pagos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: true
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      sucursales: {
        Row: {
          activo: boolean
          comanda_auto: boolean
          created_at: string
          dias_apertura: number[] | null
          direccion: string | null
          empresa_id: string
          horario_general: Json | null
          horario_por_dia: Json | null
          id: string
          mensaje_cerrado: string | null
          nombre: string
          rubro: string
          slug: string
          ticket_auto: boolean
          tolerancia_cierre: number | null
        }
        Insert: {
          activo?: boolean
          comanda_auto?: boolean
          created_at?: string
          dias_apertura?: number[] | null
          direccion?: string | null
          empresa_id: string
          horario_general?: Json | null
          horario_por_dia?: Json | null
          id?: string
          mensaje_cerrado?: string | null
          nombre: string
          rubro?: string
          slug: string
          ticket_auto?: boolean
          tolerancia_cierre?: number | null
        }
        Update: {
          activo?: boolean
          comanda_auto?: boolean
          created_at?: string
          dias_apertura?: number[] | null
          direccion?: string | null
          empresa_id?: string
          horario_general?: Json | null
          horario_por_dia?: Json | null
          id?: string
          mensaje_cerrado?: string | null
          nombre?: string
          rubro?: string
          slug?: string
          ticket_auto?: boolean
          tolerancia_cierre?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sucursales_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      takeaway_config: {
        Row: {
          acepta_anticipado: boolean
          activo: boolean
          costo_servicio: number
          created_at: string
          empresa_id: string
          horarios: Json
          mensaje_fuera_horario: string | null
          mostrar_en_app: boolean
          sucursal_id: string
          tolerancia_cierre: number
        }
        Insert: {
          acepta_anticipado?: boolean
          activo?: boolean
          costo_servicio?: number
          created_at?: string
          empresa_id: string
          horarios?: Json
          mensaje_fuera_horario?: string | null
          mostrar_en_app?: boolean
          sucursal_id: string
          tolerancia_cierre?: number
        }
        Update: {
          acepta_anticipado?: boolean
          activo?: boolean
          costo_servicio?: number
          created_at?: string
          empresa_id?: string
          horarios?: Json
          mensaje_fuera_horario?: string | null
          mostrar_en_app?: boolean
          sucursal_id?: string
          tolerancia_cierre?: number
        }
        Relationships: [
          {
            foreignKeyName: "takeaway_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeaway_config_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: true
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      usuario_admin_roles: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          rol: string
          sucursal_id: string | null
          usuario_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          rol: string
          sucursal_id?: string | null
          usuario_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          rol?: string
          sucursal_id?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usuario_admin_roles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuario_admin_roles_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuario_admin_roles_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios_admin"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios_admin: {
        Row: {
          activo: boolean
          created_at: string
          empresa_id: string | null
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          empresa_id?: string | null
          id: string
          nombre: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          empresa_id?: string | null
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_admin_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas_canal: {
        Row: {
          canal: string
          ciudad: string | null
          empresa_id: string
          fecha: string
          first_seen: string
          hits: number
          last_seen: string
          referrer: string | null
          sucursal_id: string | null
          utm: Json | null
          visitante_id: string
        }
        Insert: {
          canal: string
          ciudad?: string | null
          empresa_id: string
          fecha?: string
          first_seen?: string
          hits?: number
          last_seen?: string
          referrer?: string | null
          sucursal_id?: string | null
          utm?: Json | null
          visitante_id: string
        }
        Update: {
          canal?: string
          ciudad?: string | null
          empresa_id?: string
          fecha?: string
          first_seen?: string
          hits?: number
          last_seen?: string
          referrer?: string | null
          sucursal_id?: string | null
          utm?: Json | null
          visitante_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      facturacion_config_admin: {
        Row: {
          activo: boolean | null
          ambiente: string | null
          cert_cargado: boolean | null
          condicion_fiscal: string | null
          cuit: string | null
          empresa_id: string | null
          punto_venta: number | null
          razon_social: string | null
        }
        Insert: {
          activo?: boolean | null
          ambiente?: string | null
          cert_cargado?: never
          condicion_fiscal?: string | null
          cuit?: string | null
          empresa_id?: string | null
          punto_venta?: number | null
          razon_social?: string | null
        }
        Update: {
          activo?: boolean | null
          ambiente?: string | null
          cert_cargado?: never
          condicion_fiscal?: string | null
          cuit?: string | null
          empresa_id?: string | null
          punto_venta?: number | null
          razon_social?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturacion_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_saldo_proveedor: {
        Row: {
          empresa_id: string | null
          proveedor_id: string | null
          saldo: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cuenta_corriente_proveedor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuenta_corriente_proveedor_proveedor_id_empresa_id_fkey"
            columns: ["proveedor_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
    }
    Functions: {
      _ingresar_compra_stock: {
        Args: {
          p_comprobante_id: string
          p_detalle_prefijo: string
          p_empresa_id: string
          p_lineas: Json
          p_motivo: string
          p_remito_id: string
          p_sign: number
          p_sucursal_id: string
        }
        Returns: Json
      }
      _registrar_comprobante_compra: {
        Args: {
          p_cae: string
          p_empresa_id: string
          p_fecha: string
          p_items: Json
          p_iva: number
          p_letra: string
          p_neto: number
          p_numero_proveedor: string
          p_observaciones: string
          p_proveedor_id: string
          p_recepcionar: boolean
          p_remito_ids: string[]
          p_sucursal_id: string
          p_tipo: string
          p_tipo_remito: string
          p_total: number
          p_vencimiento: string
        }
        Returns: Json
      }
      ajustar_stock: {
        Args: {
          p_detalle?: string
          p_empresa_id: string
          p_modo?: string
          p_motivo?: string
          p_pedido_id?: string
          p_producto_id: string
          p_sucursal_id: string
          p_valor: number
        }
        Returns: Json
      }
      anular_orden_pago: {
        Args: {
          p_empresa_id: string
          p_motivo: string
          p_orden_pago_id: string
        }
        Returns: Json
      }
      aplicar_credito_op: {
        Args: {
          p_comprobante_id: string
          p_empresa_id: string
          p_monto: number
          p_orden_pago_id: string
        }
        Returns: Json
      }
      auth_empresa_id: { Args: never; Returns: string }
      auth_rol: { Args: never; Returns: string }
      bump_catalogo_empresa: { Args: { p_empresa: string }; Returns: undefined }
      bump_catalogo_sucursal: {
        Args: { p_empresa: string; p_sucursal: string }
        Returns: undefined
      }
      cobrar_cheque: {
        Args: { p_cheque_id: string; p_empresa_id: string }
        Returns: Json
      }
      confirmar_arqueo_stock: {
        Args: {
          p_arqueo_id: string
          p_confirmado_por?: string
          p_empresa_id: string
        }
        Returns: Json
      }
      crear_arqueo_stock: {
        Args: {
          p_alcance: string
          p_contado_por: string
          p_empresa_id: string
          p_items: Json
          p_observaciones: string
          p_sucursal_id: string
        }
        Returns: Json
      }
      crear_orden_compra: {
        Args: {
          p_empresa_id: string
          p_items: Json
          p_observaciones: string
          p_proveedor_id: string
          p_sucursal_id: string
        }
        Returns: Json
      }
      crear_pedido_stock: {
        Args: {
          p_codigo_retiro: string
          p_costo_envio: number
          p_datos_delivery: Json
          p_dispositivo_id: string
          p_empresa_id: string
          p_estado: string
          p_items: Json
          p_mesa_cuenta_id?: string
          p_metodo_pago: string
          p_nombre_cliente?: string
          p_numero_mesa?: number
          p_origen: string
          p_pagado?: boolean
          p_sucursal_id: string
          p_tipo_pedido: string
        }
        Returns: Json
      }
      crear_remito_borrador:
        | {
            Args: {
              p_empresa_id: string
              p_numero_proveedor: string
              p_observaciones: string
              p_orden_compra_id: string
              p_proveedor_id: string
              p_sucursal_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_empresa_id: string
              p_numero_proveedor: string
              p_observaciones: string
              p_orden_compra_id: string
              p_proveedor_id: string
              p_sucursal_id: string
              p_tipo?: string
            }
            Returns: Json
          }
      delete_dispositivo: { Args: { p_id: string }; Returns: undefined }
      delete_sucursal: { Args: { p_id: string }; Returns: undefined }
      force_vacuum_now: { Args: never; Returns: string }
      get_db_size: { Args: never; Returns: number }
      get_next_pedido_numero: {
        Args: { p_fecha: string; p_sucursal_id: string }
        Returns: number
      }
      get_table_stats: {
        Args: never
        Returns: {
          n_dead_tup: number
          n_live_tup: number
          relname: string
        }[]
      }
      get_vacuum_status: {
        Args: never
        Returns: {
          filas: number
          muertas: number
          tabla: string
        }[]
      }
      hashear_pin: { Args: { p_pin: string }; Returns: string }
      ingresar_remito_stock: {
        Args: { p_empresa_id: string; p_remito_id: string }
        Returns: Json
      }
      pendiente_comprobante: {
        Args: { p_comprobante_id: string; p_empresa_id: string }
        Returns: number
      }
      rebotar_cheque: {
        Args: { p_cheque_id: string; p_empresa_id: string }
        Returns: Json
      }
      recalcular_estado_comprobante: {
        Args: { p_comprobante_id: string; p_empresa_id: string }
        Returns: undefined
      }
      registrar_factura_compra: {
        Args: {
          p_cae?: string
          p_empresa_id: string
          p_fecha: string
          p_items: Json
          p_iva: number
          p_letra: string
          p_neto: number
          p_numero_proveedor: string
          p_observaciones: string
          p_proveedor_id: string
          p_recepcionar?: boolean
          p_remito_ids: string[]
          p_sucursal_id?: string
          p_total: number
          p_vencimiento?: string
        }
        Returns: Json
      }
      registrar_nc_compra: {
        Args: {
          p_cae?: string
          p_empresa_id: string
          p_fecha: string
          p_items: Json
          p_iva: number
          p_letra: string
          p_neto: number
          p_numero_proveedor: string
          p_observaciones: string
          p_proveedor_id: string
          p_remito_ids: string[]
          p_sucursal_id?: string
          p_total: number
          p_vencimiento?: string
        }
        Returns: Json
      }
      registrar_orden_pago: {
        Args: {
          p_empresa_id: string
          p_fecha: string
          p_imputaciones: Json
          p_observaciones: string
          p_proveedor_id: string
          p_valores: Json
        }
        Returns: Json
      }
      reordenar_imagenes: {
        Args: {
          p_ids: string[]
          p_presentacion_id: string
          p_producto_id: string
        }
        Returns: undefined
      }
      set_imagen_principal: {
        Args: { p_imagen_id: string }
        Returns: undefined
      }
      set_pin_colaborador: {
        Args: { p_colaborador: string; p_empresa: string; p_pin: string }
        Returns: boolean
      }
      set_pin_operador: {
        Args: { p_empresa: string; p_operador: string; p_pin: string }
        Returns: boolean
      }
      siguiente_numero_pedido: {
        Args: { p_empresa_id: string }
        Returns: number
      }
      verificar_pin_operador: {
        Args: { p_hash: string; p_pin: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
