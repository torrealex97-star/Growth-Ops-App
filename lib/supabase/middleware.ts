import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { CABECERA_REQUEST_ID, CABECERA_RUTA, normalizarRuta, nuevoRequestId } from '@/lib/observability/peticion'

// Called by root middleware.ts for /<tenant>/* and /api/<tenant>/* paths that
// aren't in the public-suffix lists there. `tenant` is the resolved slug,
// used only to build the login redirect if there's no session.
export async function updateSession(request: NextRequest, tenant: string) {
  // CORRELACIÓN DE PETICIONES. Se inyectan aquí, en el único sitio por el que pasan TODAS las rutas con
  // sesión, para no tener que editar las 158 rutas una por una. El handler las lee con headers() y las
  // pasa a Sentry, y el mismo id vuelve en la respuesta de error para poder buscarlo después.
  // Se preserva un id que venga de fuera (proxy o cliente que ya traza) en vez de generar otro y romper
  // la traza, pero se acota a algo inofensivo: es texto que entra sin autenticar.
  const entrante = request.headers.get(CABECERA_REQUEST_ID)
  const requestId = entrante && /^[A-Za-z0-9-]{8,64}$/.test(entrante) ? entrante : nuevoRequestId()
  request.headers.set(CABECERA_REQUEST_ID, requestId)
  request.headers.set(CABECERA_RUTA, normalizarRuta(request.nextUrl.pathname))

  let response = NextResponse.next({ request })
  // También en la respuesta: sin esto, quien ve el error en el navegador no tiene el id que citar.
  response.headers.set(CABECERA_REQUEST_ID, requestId)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        response.headers.set(CABECERA_REQUEST_ID, requestId)
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const login = request.nextUrl.clone()
    login.pathname = `/${tenant}/login`
    login.search = ''
    return NextResponse.redirect(login)
  }
  return response
}
