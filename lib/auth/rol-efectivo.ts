// EL ROL, ACOTADO A LA SUBCUENTA QUE SE ESTÁ TOCANDO.
//
// EL AGUJERO. El modelo tiene DOS ejes de rol y solo uno estaba acotado por subcuenta:
//
//   · `users.role_id` → el rol FUNCIONAL (admin, director, closer, marketing…). Es GLOBAL: una sola
//     fila por identidad, la misma en todas las subcuentas.
//   · `tenant_members.role` → el rol de TENENCIA ('super_admin' | 'admin' | 'member'). Sí es por
//     subcuenta, y es el que dice si alguien administra ESTA subcuenta.
//
// Las políticas RLS y las rutas deciden con el primero (`get_my_role()`, `is_admin_or_director()`,
// `['admin','director'].includes(auth.role)`). El aislamiento RESTRICTIVE limita a alguien a las
// subcuentas de las que es miembro, pero DENTRO de cada una le aplica su rol funcional global. Es decir:
//
//   Alguien con rol funcional `director`, invitado a la subcuenta de otro cliente como simple `member`,
//   entra como director de ese cliente. Puede escribir sus ventas, sus cobros y sus contratos.
//
// Hoy es latente porque las dos subcuentas son del mismo dueño y quien las crea recibe `super_admin`
// (lib/tenants/provision.ts). Deja de ser latente el día que entre un cliente.
//
// LA REGLA. La membresía pone el TECHO: si en esta subcuenta eres `member`, no ejerces un rol de
// administración aquí aunque lo tengas en la tuya. Se recorta a `manager`, que no es una invención —
// existe en el modelo de roles, ve prácticamente todo y NO pasa `is_admin_or_director()`. O sea: sigue
// viendo, deja de administrar.
//
// POR QUÉ SE RECORTA EL ROL Y NO SE AÑADE UNA BANDERA. Una bandera (`puedeAdministrar`) obliga a
// acordarse de comprobarla en cada una de las rutas que gatean por rol. La que se olvide sigue abierta.
// Recortar el rol hace que TODAS las comprobaciones que ya existen se aprieten solas: el fallo por
// defecto es denegar, no permitir.

import type { AppRole } from './permissions'

/** Roles de tenencia de `tenant_members.role`. */
export type RolMembresia = 'super_admin' | 'admin' | 'member'

/**
 * Los roles funcionales que conceden administración real: son exactamente los que `is_admin_or_director()`
 * acepta en la base, para que el tope de aquí y el de las políticas hablen de lo mismo.
 */
export const ROLES_ELEVADOS: AppRole[] = ['admin', 'director']

/**
 * A qué se recorta un rol elevado sin administración en esta subcuenta.
 *
 * `manager` y no `null`: dejarlo sin rol echaría a la persona de una subcuenta a la que SÍ se le ha dado
 * acceso, lo cual convierte una corrección de seguridad en una avería.
 */
export const TOPE_SIN_ADMINISTRACION: AppRole = 'manager'

export type EntradaRol = {
  /** El rol funcional global, de `users.roles.key`. */
  rolGlobal: AppRole | null
  /** Rol de tenencia en ESTA subcuenta. `null` = no hay fila de membresía. */
  rolMembresia: RolMembresia | null
  /** super_admin de plataforma: manda sobre todo lo demás. */
  esSuperAdmin: boolean
}

export type RolResuelto = {
  /** El que deben usar las comprobaciones de permiso. Ya viene acotado. */
  rol: AppRole | null
  /** El global, sin acotar. Solo para diagnóstico y para explicarle a alguien por qué no puede. */
  rolGlobal: AppRole | null
  /** ¿Administra esta subcuenta? (`tenant_members.role` en admin/super_admin, o super_admin de plataforma) */
  administraTenant: boolean
  /** `true` cuando el rol se ha recortado: es lo que hay que poder ver en un log o en un 403. */
  recortado: boolean
  motivo: string | null
}

export function resolverRol(e: EntradaRol): RolResuelto {
  const administraTenant = e.esSuperAdmin || e.rolMembresia === 'admin' || e.rolMembresia === 'super_admin'

  // El super_admin de plataforma no se toca: por definición administra todas las subcuentas, y es lo que
  // sostiene el conmutador de subcuentas y el soporte.
  if (administraTenant) {
    return { rol: e.rolGlobal, rolGlobal: e.rolGlobal, administraTenant: true, recortado: false, motivo: null }
  }

  // Sin rol funcional no hay nada que recortar: ya no puede nada.
  if (!e.rolGlobal) {
    return { rol: null, rolGlobal: null, administraTenant: false, recortado: false, motivo: null }
  }

  if (!ROLES_ELEVADOS.includes(e.rolGlobal)) {
    // Un closer sigue siendo closer en cualquier subcuenta donde se le haya dado acceso: su rol no
    // concede administración en ninguna, así que no hay escalada que cerrar.
    return { rol: e.rolGlobal, rolGlobal: e.rolGlobal, administraTenant: false, recortado: false, motivo: null }
  }

  return {
    rol: TOPE_SIN_ADMINISTRACION,
    rolGlobal: e.rolGlobal,
    administraTenant: false,
    recortado: true,
    motivo: `El rol "${e.rolGlobal}" se ejerce en la subcuenta propia; aquí el acceso es de miembro, así que no incluye administración.`,
  }
}

/** Normaliza lo que venga de `tenant_members.role`, sin aceptar un valor inventado como si fuera válido. */
export function leerRolMembresia(raw: unknown): RolMembresia | null {
  return raw === 'super_admin' || raw === 'admin' || raw === 'member' ? raw : null
}
