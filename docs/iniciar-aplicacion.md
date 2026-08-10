# Iniciar la aplicacion

## Requisitos

- Node.js 22
- pnpm 9
- Rust stable MSVC
- WebView2

## Primera instalacion

```powershell
pnpm install
```

## Levantar backend unico

```powershell
D:\BD_LOCAL\iniciar_servidor.bat
```

## Iniciar la aplicacion de escritorio

No debe existir ningun listener en `8010`. En otra terminal, desde `D:\SEDAPALGIS`:

```powershell
pnpm tauri dev
```

## Opcional: solo frontend web

```powershell
pnpm dev
```
