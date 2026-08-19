import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Delivery',
  manifest: '/delivery-manifest.json',
}

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
