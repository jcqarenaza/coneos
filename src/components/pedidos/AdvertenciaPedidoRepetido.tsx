'use client'
// Advertencia de pedido repetido (GO CTO 8/11) + AVISO de posible duplicado (CTO 13/11, D1 del GO condicionado 14/11).
// `modo` por defecto = 'advertencia': comportamiento aprobado el 8/11, sin cambios (kiosco, mesas y empresas con la llave apagada).
//   · 'advertencia'   "Volver" no crea nada; "Sí, continuar" reenvía la MISMA operación con confirmar_advertencia.
//   · 'pedido_activo' el teléfono ya tiene un pedido en curso (idéntico o distinto: ya NO hay bloqueo duro). Acción principal "Ver mi pedido #N"
//                     (solo si es del mismo visitante), luego "Volver" y "Es otro pedido, continuar". Si el cliente continúa, el pedido se crea y
//                     queda en revisión en Caja (no se prepara hasta que el local lo confirme).
export const TEXTO_PEDIDO_REPETIDO = 'Estás cargando un pedido igual al que realizaste hace unos minutos. ¿Querés generar otro pedido?'
export const TEXTO_PEDIDO_ACTIVO = 'Este teléfono ya tiene un pedido en curso. Revisá que no estés cargando el mismo pedido nuevamente para evitar preparar dos veces lo mismo.'
export type ModoAdvertencia = 'advertencia' | 'pedido_activo'

export default function AdvertenciaPedidoRepetido({ color = '#171717', numeroPedido, verPedidoHref, onVolver, onContinuar, modo = 'advertencia' }: {
  color?: string; numeroPedido?: number | null; verPedidoHref?: string | null; onVolver: () => void; onContinuar?: () => void; modo?: ModoAdvertencia
}) {
  const titulo = modo === 'advertencia' ? 'Pedido repetido' : '¡Atención!'
  const texto = modo === 'advertencia' ? TEXTO_PEDIDO_REPETIDO : TEXTO_PEDIDO_ACTIVO
  const hayVer = !!verPedidoHref && numeroPedido != null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onVolver} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-7 text-center">
        <div className="text-5xl mb-3">🧾</div>
        <h3 className="font-black text-neutral-900 text-xl mb-2">{titulo}</h3>
        <p className="text-neutral-600 text-sm mb-6">{texto}</p>
        {modo === 'advertencia' ? (
          <>
            {hayVer && <a href={verPedidoHref!} className="block w-full py-3 mb-2 text-sm font-bold underline" style={{ color }}>Ver mi pedido #{numeroPedido}</a>}
            <button onClick={onVolver} className="w-full py-3.5 rounded-2xl text-white font-bold text-base mb-2 active:scale-98 transition-all" style={{ backgroundColor: color }}>Volver</button>
            <button onClick={onContinuar} className="w-full py-3.5 rounded-2xl border-2 border-neutral-200 text-neutral-700 font-bold text-base active:bg-neutral-50 transition-colors">Sí, continuar</button>
          </>
        ) : (
          <>
            {hayVer && <a href={verPedidoHref!} className="block w-full py-3.5 rounded-2xl text-white font-bold text-base mb-2 active:scale-98 transition-all" style={{ backgroundColor: color }}>Ver mi pedido #{numeroPedido}</a>}
            {/* Sin link (el pedido encontrado es de otro visitante: no se entrega acceso) "Volver" pasa a ser la acción principal. */}
            <button onClick={onVolver} className={hayVer ? 'w-full py-3.5 rounded-2xl border-2 border-neutral-200 text-neutral-700 font-bold text-base mb-3 active:bg-neutral-50 transition-colors' : 'w-full py-3.5 rounded-2xl text-white font-bold text-base mb-3 active:scale-98 transition-all'} style={hayVer ? undefined : { backgroundColor: color }}>Volver</button>
            {onContinuar && <button onClick={onContinuar} className="w-full py-2 text-sm font-semibold text-neutral-400 underline underline-offset-2">Es otro pedido, continuar</button>}
          </>
        )}
      </div>
    </div>
  )
}
