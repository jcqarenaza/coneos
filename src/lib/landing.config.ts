// ═══════════════════════════════════════════════════════════════════
// CONFIG COMERCIAL DE LA LANDING — único lugar donde se tocan precios,
// contacto y textos configurables. La página los importa de acá.
// (Regla del brief: nada de esto hardcodeado disperso por componentes.)
// ═══════════════════════════════════════════════════════════════════

export const LANDING = {
  whatsapp: '5492236807302', // solo dígitos, con código de país
  demoMensaje: 'Hola, quiero una demo de GastrOS para mi negocio',

  precios: {
    fraseEscalera: 'Empezá con lo esencial. Sumá herramientas cuando tu negocio crece.',
    planes: [
      {
        id: 'starter', nombre: 'Starter', color: '#34A853', destacado: false,
        bajada: 'La operación diaria de tu negocio',
        precio: 'USD 100*', detalle: 'implementación · única vez por sucursal',
        base: null,
        modulos: ['Kiosco', 'Caja', 'Preparación', 'Display', 'Programa de beneficios'],
      },
      {
        id: 'pro', nombre: 'Pro', color: '#38BDF8', destacado: true, badge: 'Más elegido',
        bajada: 'Sumá nuevos canales de venta',
        precio: 'USD 150*', detalle: 'implementación · única vez por sucursal',
        base: 'Todo Starter +',
        modulos: ['Delivery', 'Mesas + QR', 'Take Away con modo prepago', 'Mercado Pago online: el cliente paga desde su celular'],
      },
      {
        id: 'full', nombre: 'Full', color: '#F6B91C', destacado: false,
        bajada: 'Toda tu operación integrada',
        precio: 'USD 200*', detalle: 'implementación · única vez por sucursal',
        base: 'Todo Pro +',
        modulos: ['Facturación electrónica automática', 'Control de stock', 'Cobros por canal (multi-cuenta)'],
      },
    ],
    mensualidad: 'Después de la implementación: fee mensual de USD 50, con hasta 4 dispositivos incluidos en cualquiera de los planes.',
    aclaraciones: [
      '* Precios más impuestos.',
      'Hardware no incluido.',
      '¿Necesitás más dispositivos o una configuración especial? Consultanos.',
    ],
  },

  empresa: {
    nombre: 'GastrOS',
    bajada: 'El sistema operativo para negocios gastronómicos, by Aoki.',
    copyright: '© Aoki',
  },
} as const

export const waLink = (mensaje: string = LANDING.demoMensaje) =>
  `https://wa.me/${LANDING.whatsapp}?text=${encodeURIComponent(mensaje)}`
