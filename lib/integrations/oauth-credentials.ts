const GOOGLE_CLIENT_ID = /^[a-z0-9._-]+\.apps\.googleusercontent\.com$/i
const META_APP_ID = /^\d{6,32}$/

export function isGoogleOAuthClientId(value: string | null | undefined): boolean {
  return GOOGLE_CLIENT_ID.test(String(value || '').trim())
}

export function isMetaAppId(value: string | null | undefined): boolean {
  return META_APP_ID.test(String(value || '').trim())
}

/**
 * Rechaza identificadores OAuth imposibles antes de cifrarlos. Además de ahorrar un viaje fallido
 * al proveedor, evita persistir un email autocompletado por el gestor de contraseñas del navegador.
 * Los secretos no se validan por prefijo: Google y Meta mantienen formatos históricos distintos.
 */
export function oauthCredentialValidationError(updates: Record<string, string>): string | null {
  for (const key of ['GOOGLE_CLIENT_ID', 'YOUTUBE_CLIENT_ID'] as const) {
    const value = updates[key]?.trim()
    if (value && !isGoogleOAuthClientId(value)) {
      return `${key} no tiene formato de Client ID OAuth de Google (.apps.googleusercontent.com).`
    }
  }

  const metaAppId = updates.META_APP_ID?.trim()
  if (metaAppId && !isMetaAppId(metaAppId)) {
    return 'META_APP_ID debe ser el identificador numérico de la aplicación de Meta.'
  }

  return null
}
