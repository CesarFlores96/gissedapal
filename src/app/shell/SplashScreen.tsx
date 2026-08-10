import splashImage from "../../assets/splash-sedapal.jpg"

export function SplashScreen({ status }: { status: string }): React.JSX.Element {
  return (
    <main
      className="relative grid h-screen place-items-center overflow-hidden bg-neutral-900"
      data-tauri-drag-region
    >
      <img
        src={splashImage}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-35"
      />
      <div className="absolute inset-0 bg-neutral-900/55" />
      <div className="relative z-10 flex flex-col items-center gap-4 text-white">
        <span className="text-2xl font-semibold tracking-wide drop-shadow">SEDAPAL GIS</span>
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white"
        />
        <span aria-live="polite" className="text-sm text-white/90">{status}</span>
      </div>
    </main>
  )
}
