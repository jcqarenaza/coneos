'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function PagoErrorContent() {
  const params = useSearchParams()
  const pedido = params.get('pedido')

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="text-5xl mb-5">😕</div>
      <h1 className="text-2xl font-black text-neutral-800 mb-2">El pago no se completó</h1>
      {pedido && <p className="text-neutral-500 mb-1">Tu pedido <span className="font-bold text-neutral-700">#{pedido}</span> quedó registrado.</p>}
      <p className="text-neutral-400 text-sm max-w-xs">Podés pagarlo en efectivo al recibirlo, o contactanos si tuviste un problema con Mercado Pago.</p>
    </div>
  )
}

export default function PagoError() {
  return <Suspense fallback={null}><PagoErrorContent /></Suspense>
}
