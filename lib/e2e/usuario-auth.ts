// BÚSQUEDA DE USUARIOS AUTH PARA LOS FIXTURES DEL E2E, A PRUEBA DE UNA FILA ROTA.
//
// `auth.admin.listUsers()` falla para TODOS si una sola fila de auth.users tiene columnas de token a
// NULL (le pasa a los usuarios creados a mano por SQL: GoTrue no sabe leer NULL en esos campos). El
// script de fixtures descartaba ese error (`const { data: listed } = …`), concluía «el usuario no
// existe», intentaba crearlo y el E2E de TODAS las PRs moría con 422 `email_exists`, sin que nada
// apuntara a la verdadera causa (3-oct: un usuario de prueba manual lo dejó roto durante horas).
//
// `public.users` guarda el mismo id (el script lo upserta justo después) y no depende de ese listado,
// así que es la segunda fuente.

type UsuarioAuth = { id: string; email?: string | null }

// Interfaz mínima que se usa de supabase-js: permite probarlo sin red.
export type ClienteFixtures = {
  auth: {
    admin: {
      listUsers: (opts?: { perPage?: number }) => Promise<{
        data: { users?: UsuarioAuth[] } | null
        error: { message: string } | null
      }>
    }
  }
  from: (tabla: 'users') => {
    select: (cols: string) => {
      eq: (
        col: string,
        valor: string
      ) => {
        maybeSingle: () => Promise<{ data: { id: string } | null }>
      }
    }
  }
}

export async function buscarIdAuth(
  sb: ClienteFixtures,
  email: string,
  avisar: (mensaje: string) => void = console.warn
): Promise<string | null> {
  const { data: listado, error } = await sb.auth.admin.listUsers({ perPage: 1000 })
  const hallado = (listado?.users ?? []).find((u) => u.email === email)
  if (hallado) return hallado.id
  // Un error de listado NO es «no existe»: se dice, y se busca por la otra vía.
  if (error) avisar(`[e2e] listUsers falló (${error.message}); se busca ${email} en public.users`)
  const { data: fila } = await sb.from('users').select('id').eq('email', email).maybeSingle()
  return fila?.id ?? null
}
