'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { CheckCircle } from 'lucide-react'

function PagoOkContent() {
  const params = useSearchParams()
  const pedido = params.get('pedido')

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: '#faf8f5' }}>
      <CheckCircle className="h-16 w-16 text-green-500 mb-5" />
      <h1 className="text-2xl font-black text-neutral-800 mb-2">¡Pago recibido!</h1>
      {pedido && <p className="text-neutral-500 mb-1">Tu pedido <span className="font-bold text-neutral-700">#{pedido}</span> está confirmado.</p>}
      <p className="text-neutral-400 text-sm max-w-xs">Ya estamos preparando tu pedido. Te va a llegar pronto 🍦</p>
    </div>
  )
}

export default function PagoOk() {
  return <Suspense fallback={null}><PagoOkContent /></Suspense>
}
