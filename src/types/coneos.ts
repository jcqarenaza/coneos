export type TipoDispositivo = 'KIOSK' | 'CAJA' | 'PREPARACION' | 'DISPLAY'

export type EstadoPedido =
  | 'CREATED' | 'PENDING_PAYMENT' | 'PAID'
  | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED'

export type MetodoPago = 'efectivo' | 'transferencia' | 'mp'

export type RolAdmin = 'SUPER_ADMIN' | 'ADMIN_EMPRESA' | 'ADMIN_SUCURSAL'

export type OrigenPedido = 'KIOSK' | 'CAJA' | 'ONLINE' | 'APP'

export type PrioridadPedido = 'NORMAL' | 'ALTA'

export interface DispositivoContext {
  deviceToken: string
  empresaId: string
  sucursalId: string
  empresaSlug: string
  sucursalSlug: string
  tipo: TipoDispositivo
}

export interface SesionOperador {
  sessionId: string
  operadorId: string
  nombre: string
  puedeCobrar: boolean
  puedePreparar: boolean
}

export interface ItemCarrito {
  presentacionId: string
  nombreProducto: string
  nombrePresentacion: string
  precio: number
  cantidad: number
  opcionesElegidas: {
    opcionId: string
    nombre: string
    color: string | null
    emoji: string | null
  }[]
}
