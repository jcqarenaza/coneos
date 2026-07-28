export type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      empresas: {
        Row: {
          id: string
          nombre: string
          slug: string
          activo: boolean
          plan: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['empresas']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['empresas']['Insert']>
      }
      sucursales: {
        Row: {
          id: string
          empresa_id: string
          nombre: string
          slug: string
          direccion: string | null
          activo: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sucursales']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['sucursales']['Insert']>
      }
      dispositivos: {
        Row: {
          id: string
          empresa_id: string
          sucursal_id: string
          nombre: string
          tipo: 'KIOSK' | 'CAJA' | 'PREPARACION' | 'DISPLAY'
          device_token: string
          activo: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['dispositivos']['Row'], 'id' | 'created_at' | 'device_token'>
        Update: Partial<Database['public']['Tables']['dispositivos']['Insert']>
      }
      operadores: {
        Row: {
          id: string
          empresa_id: string
          sucursal_id: string | null
          nombre: string
          pin_hash: string
          puede_cobrar: boolean
          puede_preparar: boolean
          activo: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['operadores']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['operadores']['Insert']>
      }
      pedidos: {
        Row: {
          id: string
          empresa_id: string
          sucursal_id: string
          dispositivo_id: string | null
          operator_session_id: string | null
          turno_id: string | null
          cliente_id: string | null
          numero_pedido: number
          fecha_pedido: string
          codigo_retiro: string
          origen: 'KIOSK' | 'CAJA' | 'ONLINE' | 'APP'
          estado: 'CREATED' | 'PENDING_PAYMENT' | 'PAID' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED'
          prioridad: 'NORMAL' | 'ALTA'
          tiempo_estimado: number | null
          metodo_pago: 'efectivo' | 'transferencia' | 'mp' | null
          total: number
          notas: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['pedidos']['Row'], 'id' | 'created_at' | 'updated_at' | 'codigo_retiro' | 'numero_pedido'>
        Update: Partial<Database['public']['Tables']['pedidos']['Insert']>
      }
      operator_sessions: {
        Row: {
          id: string
          operador_id: string
          dispositivo_id: string
          sucursal_id: string
          empresa_id: string
          inicio: string
          fin: string | null
          estado: 'ACTIVA' | 'CERRADA'
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['operator_sessions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['operator_sessions']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: {
      get_next_pedido_numero: {
        Args: { p_sucursal_id: string; p_fecha: string }
        Returns: number
      }
      auth_empresa_id: {
        Args: Record<string, never>
        Returns: string
      }
      auth_rol: {
        Args: Record<string, never>
        Returns: string
      }
    }
    Enums: Record<string, never>
  }
}
