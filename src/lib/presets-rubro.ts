// ═══════════════════════════════════════════════════════════════════
// PLANTILLAS DE ARRANQUE POR RUBRO — Multi-rubro F3
// Solo DATOS: al cargarse se convierten en catálogo normal, editable y
// borrable. Nunca reglas de negocio, nunca lógica en runtime.
// Contenido v1 — ajustable sin tocar la mecánica.
// ═══════════════════════════════════════════════════════════════════

export interface PresetOpcion { nombre: string; emoji?: string }
export interface PresetGrupo { nombre: string; opciones: PresetOpcion[] }
export interface PresetRubro {
  etiqueta: string
  categorias: string[]
  grupos: PresetGrupo[]
  texto_bienvenida: string
}

export const PRESETS_RUBRO: Record<string, PresetRubro> = {
  HELADERIA: {
    etiqueta: '🍦 Heladería',
    categorias: ['Helados por Kilo', 'Postres', 'Tortas', 'Bebidas'],
    grupos: [
      { nombre: 'Sabores', opciones: [{ nombre: 'Chocolate' }, { nombre: 'Dulce de leche' }, { nombre: 'Frutilla' }, { nombre: 'Vainilla' }] },
      { nombre: 'Accesorios', opciones: [{ nombre: 'Cucharita', emoji: '🥄' }, { nombre: 'Conservadora', emoji: '🧊' }] },
    ],
    texto_bienvenida: '¿Qué helado te tienta hoy?',
  },
  HAMBURGUESERIA: {
    etiqueta: '🍔 Hamburguesería',
    categorias: ['Hamburguesas', 'Combos', 'Papas', 'Bebidas', 'Postres'],
    grupos: [
      { nombre: 'Adicionales', opciones: [{ nombre: 'Medallón extra', emoji: '🥩' }, { nombre: 'Panceta', emoji: '🥓' }, { nombre: 'Huevo', emoji: '🍳' }, { nombre: 'Cheddar extra' }] },
      { nombre: 'Aderezos', opciones: [{ nombre: 'Mayonesa' }, { nombre: 'Ketchup' }, { nombre: 'Barbacoa' }] },
      { nombre: 'Punto de cocción', opciones: [{ nombre: 'Jugoso' }, { nombre: 'A punto' }, { nombre: 'Cocido' }] },
    ],
    texto_bienvenida: '¿Con hambre? Armá tu pedido',
  },
  RESTAURANTE: {
    etiqueta: '🍝 Restaurante',
    categorias: ['Entradas', 'Pastas', 'Carnes', 'Guarniciones', 'Bebidas', 'Postres'],
    grupos: [
      { nombre: 'Salsas', opciones: [{ nombre: 'Filetto' }, { nombre: 'Bolognesa' }, { nombre: 'Crema' }, { nombre: 'Cuatro quesos' }] },
      { nombre: 'Punto de cocción', opciones: [{ nombre: 'Jugoso' }, { nombre: 'A punto' }, { nombre: 'Bien cocido' }] },
      { nombre: 'Guarnición', opciones: [{ nombre: 'Papas fritas', emoji: '🍟' }, { nombre: 'Puré' }, { nombre: 'Ensalada', emoji: '🥗' }] },
    ],
    texto_bienvenida: 'Bienvenidos — pedí desde tu mesa',
  },
  BAR: {
    etiqueta: '🍺 Bar',
    categorias: ['Cervezas', 'Tragos', 'Vinos', 'Bebidas sin alcohol', 'Picadas', 'Comidas'],
    grupos: [
      { nombre: 'Extras', opciones: [{ nombre: 'Porción de fritas', emoji: '🍟' }, { nombre: 'Maní' }] },
    ],
    texto_bienvenida: 'Pedí desde tu mesa y seguí la charla',
  },
  PIZZERIA: {
    etiqueta: '🍕 Pizzería',
    categorias: ['Pizzas', 'Empanadas', 'Bebidas', 'Postres'],
    grupos: [
      { nombre: 'Adicionales', opciones: [{ nombre: 'Muzzarella extra', emoji: '🧀' }, { nombre: 'Huevo', emoji: '🍳' }, { nombre: 'Morrón' }] },
      { nombre: 'Gustos', opciones: [{ nombre: 'Muzzarella' }, { nombre: 'Napolitana' }, { nombre: 'Fugazzeta' }, { nombre: 'Calabresa' }] },
    ],
    texto_bienvenida: '¿Qué pizza pedimos hoy?',
  },
  SUSHI: {
    etiqueta: '🍣 Sushi',
    categorias: ['Combos', 'Rolls', 'Entradas', 'Bebidas'],
    grupos: [
      { nombre: 'Variedades', opciones: [{ nombre: 'Salmón' }, { nombre: 'Langostino' }, { nombre: 'Atún' }, { nombre: 'Veggie' }] },
    ],
    texto_bienvenida: 'Bienvenido — armá tu combo',
  },
  CAFETERIA: {
    etiqueta: '☕ Cafetería',
    categorias: ['Cafetería', 'Pastelería', 'Desayunos y meriendas', 'Bebidas frías'],
    grupos: [
      { nombre: 'Tipo de leche', opciones: [{ nombre: 'Entera' }, { nombre: 'Descremada' }, { nombre: 'Almendras' }] },
      { nombre: 'Extras', opciones: [{ nombre: 'Shot extra de café', emoji: '☕' }, { nombre: 'Crema' }] },
    ],
    texto_bienvenida: '¿Arrancamos con un café?',
  },
  PARRILLA: {
    etiqueta: '🥩 Parrilla',
    categorias: ['Parrilla', 'Entradas', 'Guarniciones', 'Bebidas', 'Postres'],
    grupos: [
      { nombre: 'Punto de cocción', opciones: [{ nombre: 'Jugoso' }, { nombre: 'A punto' }, { nombre: 'Bien cocido' }] },
      { nombre: 'Guarnición', opciones: [{ nombre: 'Papas fritas', emoji: '🍟' }, { nombre: 'Ensalada', emoji: '🥗' }, { nombre: 'Puré' }] },
    ],
    texto_bienvenida: 'Bienvenidos a la parrilla',
  },
  OTRO: {
    etiqueta: '🏪 Otro comercio',
    categorias: ['Principales', 'Bebidas', 'Postres'],
    grupos: [
      { nombre: 'Opciones', opciones: [{ nombre: 'Opción de ejemplo 1' }, { nombre: 'Opción de ejemplo 2' }] },
    ],
    texto_bienvenida: '¿Qué querés pedir hoy?',
  },
}
