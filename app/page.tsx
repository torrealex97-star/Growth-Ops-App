// Sin listado público de subcuentas (evita exponer nombres de clientes a
// visitantes no autenticados). Cada subcuenta se accede por su propia URL:
// /<tenant>/login. Esta raíz es solo una pantalla de marca mínima.
export default function HomePage() {
  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center p-4" data-theme="os">
      <div className="text-center">
        <span className="text-3xl font-semibold tracking-tight text-white">Scalix Systems</span>
        <p className="text-muted-foreground text-sm mt-2">
          Accede desde el enlace de tu subcuenta.
        </p>
      </div>
    </div>
  )
}
