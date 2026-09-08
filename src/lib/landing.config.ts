// ═══════════════════════════════════════════════════════════════════
// CONFIG COMERCIAL DE LA LANDING — único lugar donde se tocan precios,
// contacto y textos configurables. La página los importa de acá.
// (Regla del brief: nada de esto hardcodeado disperso por componentes.)
// ═══════════════════════════════════════════════════════════════════

export const LANDING = {
  whatsapp: '542302456497', // solo dígitos, con código de país
  demoMensaje: 'Hola, quiero una demo de ConeOS para mi negocio',

  precios: {
    fraseEscalera: 'Empezá con lo esencial. Sumá herramientas cuando tu negocio crece.',
    planes: [
      {
        id: 'starter', nombre: 'Starter', color: '#34A853', destacado: false,
        bajada: 'La operación diaria de tu negocio',
        precio: '$150.000', detalle: 'implementación · única vez por sucursal',
        base: null,
        modulos: ['Kiosco', 'Caja', 'Preparación', 'Display', 'Programa de beneficios'],
      },
      {
        id: 'pro', nombre: 'Pro', color: '#2F7DE1', destacado: true, badge: 'Más elegido',
        bajada: 'Sumá nuevos canales de venta',
        precio: '$250.000', detalle: 'implementación · única vez por sucursal',
        base: 'Todo Starter +',
        modulos: ['Delivery', 'Mesas + QR'],
      },
      {
        id: 'full', nombre: 'Full', color: '#1B2A4A', destacado: false,
        bajada: 'Toda tu operación integrada',
        precio: '$350.000', detalle: 'implementación · única vez por sucursal',
        base: 'Todo Pro +',
        modulos: ['Facturación electrónica', 'Mercado Pago'],
      },
    ],
    mensualidad: 'Después de la implementación: fee mensual según los dispositivos que uses, desde $75.000.',
    aclaraciones: [
      'Precios + IVA.',
      'Todos los planes se adaptan a la cantidad de dispositivos que necesitás.',
      'Hardware no incluido.',
      '¿Necesitás más dispositivos o una configuración especial? Consultanos.',
    ],
  },

  empresa: {
    nombre: 'ConeOS',
    bajada: 'La plataforma de gestión y operación para negocios gastronómicos.',
    copyright: '© QP Cloud & Inteligencia Artificial',
  },
} as const

export const waLink = (mensaje: string = LANDING.demoMensaje) =>
  `https://wa.me/${LANDING.whatsapp}?text=${encodeURIComponent(mensaje)}`
