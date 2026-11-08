'use client'
// Advertencia de pedido repetido (GO CTO 8/11). Texto fijado por el CTO. "Volver" no crea nada; "Sí, continuar"
// reenvía la MISMA operación con confirmar_advertencia (el servidor valida que corresponda a lo ya advertido).
export const TEXTO_PEDIDO_REPETIDO = 'Estás cargando un pedido igual al que realizaste hace unos minutos. ¿Querés generar otro pedido?'

export default function AdvertenciaPedidoRepetido({ color = '#171717', numeroPedido, verPedidoHref, onVolver, onContinuar }: {
  color?: string; numeroPedido?: number | null; verPedidoHref?: string | null; onVolver: () => void; onContinuar: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onVolver} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-7 text-center">
        <div className="text-5xl mb-3">🧾</div>
        <h3 className="font-black text-neutral-900 text-xl mb-2">Pedido repetido</h3>
        <p className="text-neutral-600 text-sm mb-6">{TEXTO_PEDIDO_REPETIDO}</p>
        {verPedidoHref && numeroPedido != null && (
          <a href={verPedidoHref} className="block w-full py-3 mb-2 text-sm font-bold underline" style={{ color }}>Ver mi pedido #{numeroPedido}</a>
        )}
        <button onClick={onVolver} className="w-full py-3.5 rounded-2xl text-white font-bold text-base mb-2 active:scale-98 transition-all" style={{ backgroundColor: color }}>Volver</button>
        <button onClick={onContinuar} className="w-full py-3.5 rounded-2xl border-2 border-neutral-200 text-neutral-700 font-bold text-base active:bg-neutral-50 transition-colors">Sí, continuar</button>
      </div>
    </div>
  )
}
