'use client'

// /auth/establecer-contrasena — Primera contraseña de un admin invitado.
// Requiere sesión activa (creada por el invite en /auth/callback).
// Al guardar: updateUser({password}) + limpia la marca debe_establecer_password,
// y recién ahí redirige al admin de su empresa.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function EstablecerContrasenaPage() {
  const router = useRouter()
  const [estado, setEstado] = useState<'cargando' | 'form' | 'guardando' | 'error'>('cargando')
  const [mensaje, setMensaje] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session?.user) {
        setMensaje('El link expiró o no es válido. Pedí una invitación nueva.')
        setEstado('error')
        return
      }
      setEmail(data.session.user.email || '')
      setEstado('form')
    })
  }, [])

  const guardar = async () => {
    if (pass.length < 8) { setMensaje('La contraseña debe tener al menos 8 caracteres.'); return }
    if (pass !== pass2) { setMensaje('Las contraseñas no coinciden.'); return }
    setMensaje('')
    setEstado('guardando')
    const supabase = createClient()
    try {
      const { error } = await supabase.auth.updateUser({
        password: pass,
        data: { debe_establecer_password: false },
      })
      if (error) {
        setMensaje(error.message.includes('weak') || error.message.includes('easy')
          ? 'Esa contraseña es demasiado común. Elegí una más segura.'
          : 'No se pudo guardar: ' + error.message)
        setEstado('form')
        return
      }
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData?.user?.id
      if (!uid) { setMensaje('Sesión inválida. Pedí una invitación nueva.'); setEstado('error'); return }

      const { data: adminRow } = await supabase
        .from('usuarios_admin')
        .select('empresa_id, activo')
        .eq('id', uid)
        .maybeSingle()
      if (!adminRow || adminRow.activo === false || !adminRow.empresa_id) {
        setMensaje('Tu usuario no tiene un comercio asignado todavía. Avisale a quien te invitó.')
        setEstado('error')
        return
      }
      const { data: empresaRow } = await supabase
        .from('empresas')
        .select('slug, activo')
        .eq('id', adminRow.empresa_id)
        .maybeSingle()
      if (!empresaRow?.slug || empresaRow.activo === false) {
        setMensaje('Tu comercio no está disponible. Avisale a quien te invitó.')
        setEstado('error')
        return
      }
      router.replace('/' + empresaRow.slug + '/admin')
    } catch {
      setMensaje('Error inesperado. Probá de nuevo.')
      setEstado('form')
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #E2E8F0',
    borderRadius: 10, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#ffffff', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {estado === 'cargando' && (
          <div style={{ textAlign: 'center', color: '#64748B', fontSize: 14 }}>Cargando...</div>
        )}

        {estado === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2e4a', marginBottom: 6 }}>
              No se pudo continuar
            </div>
            <div style={{ fontSize: 13, color: '#64748B' }}>{mensaje}</div>
          </div>
        )}

        {(estado === 'form' || estado === 'guardando') && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2e4a' }}>Elegí tu contraseña</div>
              {email && <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>{email}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="password" placeholder="Nueva contraseña (mín. 8)" style={inputStyle}
                value={pass} onChange={e => setPass(e.target.value)}
              />
              <input
                type="password" placeholder="Repetir contraseña" style={inputStyle}
                value={pass2} onChange={e => setPass2(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') guardar() }}
              />
              {mensaje && <div style={{ fontSize: 12, color: '#C0392B' }}>{mensaje}</div>}
              <button
                onClick={guardar}
                disabled={estado === 'guardando'}
                style={{
                  padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#fff',
                  background: '#0B9EDA', border: 'none', borderRadius: 10, cursor: 'pointer',
                  opacity: estado === 'guardando' ? 0.6 : 1,
                }}
              >
                {estado === 'guardando' ? 'Guardando...' : 'Guardar y entrar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
