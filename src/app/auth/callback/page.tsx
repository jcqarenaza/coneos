'use client'

// /auth/callback — Impersonación (magiclink) e Invitaciones (invite) desde QP C&IA.
// Consume token_hash via verifyOtp. El parámetro `tipo` SOLO selecciona el tipo de
// verificación (invite | email); NO es fuente de autorización: la credencial es el token.

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [estado, setEstado] = useState<'verificando' | 'error'>('verificando')
  const [mensaje, setMensaje] = useState('Verificando acceso...')
  const corrido = useRef(false)

  useEffect(() => {
    if (corrido.current) return
    corrido.current = true

    const tokenHash = searchParams.get('token_hash')
    const tipoParam = searchParams.get('tipo')
    const tipoVerificacion: 'invite' | 'email' = tipoParam === 'invite' ? 'invite' : 'email'

    // Limpiar la URL de inmediato: el token es una credencial temporal.
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/auth/callback')
    }

    const fallar = (msg: string) => {
      setMensaje(msg)
      setEstado('error')
    }

    if (!tokenHash) {
      fallar('Acceso inválido: falta el token.')
      return
    }

    const supabase = createClient()

    ;(async () => {
      try {
        // Sesión existente: reemplazo determinista, scope local.
        const { data: sesionPrevia } = await supabase.auth.getSession()
        if (sesionPrevia?.session) {
          await supabase.auth.signOut({ scope: 'local' })
        }

        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: tipoVerificacion,
        })

        if (error || !data?.session || !data?.user) {
          fallar('El acceso expiró, ya fue utilizado o no es válido. Pedí un link nuevo.')
          return
        }

        // GATE (issue Supabase #45210): invitado sin contraseña NO entra al admin.
        const debeEstablecer = data.user.user_metadata?.debe_establecer_password === true
        if (debeEstablecer) {
          router.replace('/auth/establecer-contrasena')
          return
        }

        const uid = data.user.id

        const { data: adminRow } = await supabase
          .from('usuarios_admin')
          .select('empresa_id, activo')
          .eq('id', uid)
          .maybeSingle()

        if (!adminRow || adminRow.activo === false || !adminRow.empresa_id) {
          await supabase.auth.signOut({ scope: 'local' })
          fallar('El usuario no tiene acceso de administrador activo.')
          return
        }

        const { data: empresaRow } = await supabase
          .from('empresas')
          .select('slug, activo')
          .eq('id', adminRow.empresa_id)
          .maybeSingle()

        if (!empresaRow || !empresaRow.slug || empresaRow.activo === false) {
          await supabase.auth.signOut({ scope: 'local' })
          fallar('La empresa del usuario no está disponible.')
          return
        }

        // NOTA auditoría (futuro): punto de inserción de impersonation_id.

        router.replace('/' + empresaRow.slug + '/admin')
      } catch {
        fallar('No se pudo completar el acceso. Probá de nuevo desde el panel.')
      }
    })()
  }, [router, searchParams])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#ffffff', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        {estado === 'verificando' ? (
          <>
            <div style={{
              width: 36, height: 36, margin: '0 auto 16px', borderRadius: '50%',
              border: '3px solid #E2E8F0', borderTopColor: '#0B9EDA',
              animation: 'qpspin 0.8s linear infinite',
            }} />
            <style>{'@keyframes qpspin{to{transform:rotate(360deg)}}'}</style>
            <div style={{ fontSize: 14, color: '#64748B' }}>{mensaje}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2e4a', marginBottom: 6 }}>
              No se pudo iniciar la sesión
            </div>
            <div style={{ fontSize: 13, color: '#64748B' }}>{mensaje}</div>
          </>
        )}
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  )
}
