'use client'
// Advertencia de pedido repetido (GO CTO 8/11) + BLOQUEO de duplicados (opción C, CTO 13/11).
// `modo` por defecto = 'advertencia': comportamiento aprobado el 8/11, sin cambios (kiosco, mesas y empresas con la llave apagada).
//   · 'advertencia'      "Volver" no crea nada; "Sí, continuar" reenvía la MISMA operación con confirmar_advertencia.
//   · 'bloqueo_identico' pedido igual en curso: NO hay "Sí, continuar". Solo "Ver mi pedido #N" y "Volver".
//   · 'pedido_activo'    el teléfono ya tiene un pedido en curso con OTRO contenido: acción principal "Ver mi pedido #N", secundaria "Volver";
//                        la excepción "Es otro pedido, continuar" es deliberada (texto propio, jerarquía baja) para familias con teléfono compartido.
export const TEXTO_PEDIDO_REPETIDO = 'Estás cargando un pedido igual al que realizaste hace unos minutos. ¿Querés generar otro pedido?'
export const TEXTO_BLOQUEO_IDENTICO = 'Ya tenés un pedido igual en curso. Para no duplicarlo, no podemos cargar otro idéntico.'
export const TEXTO_PEDIDO_ACTIVO = 'Este teléfono ya tiene un pedido en curso. Si querés sumar algo a ese pedido, comunicate con el local.'
export type ModoAdvertencia = 'advertencia' | 'bloqueo_identico' | 'pedido_activo'

export default function AdvertenciaPedidoRepetido({ color = '#171717', numeroPedido, verPedidoHref, onVolver, onContinuar, modo = 'advertencia' }: {
  color?: string; numeroPedido?: number | null; verPedidoHref?: string | null; onVolver: () => void; onContinuar?: () => void; modo?: ModoAdvertencia
}) {
  const titulo = modo === 'advertencia' ? 'Pedido repetido' : modo === 'bloqueo_identico' ? 'Ya tenés este pedido' : 'Ya tenés un pedido en curso'
  const texto = modo === 'advertencia' ? TEXTO_PEDIDO_REPETIDO : modo === 'bloqueo_identico' ? TEXTO_BLOQUEO_IDENTICO : TEXTO_PEDIDO_ACTIVO
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
        ) : modo === 'bloqueo_identico' ? (
          <>
            {hayVer && <a href={verPedidoHref!} className="block w-full py-3.5 rounded-2xl text-white font-bold text-base mb-2 active:scale-98 transition-all" style={{ backgroundColor: color }}>Ver mi pedido #{numeroPedido}</a>}
            <button onClick={onVolver} className={hayVer ? 'w-full py-3.5 rounded-2xl border-2 border-neutral-200 text-neutral-700 font-bold text-base active:bg-neutral-50 transition-colors' : 'w-full py-3.5 rounded-2xl text-white font-bold text-base active:scale-98 transition-all'} style={hayVer ? undefined : { backgroundColor: color }}>Volver</button>
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
