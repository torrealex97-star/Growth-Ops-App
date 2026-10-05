import { AppLoading } from '@/components/ui/carga/AppLoading'

/** Feedback inmediato mientras Next carga el código/datos de la ruta siguiente. */
export default function TenantRouteLoading() {
  return <AppLoading mensaje="Abriendo la pantalla…" />
}
