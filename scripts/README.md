PowerShell and Build Helpers

1) Build (CMD)

Open a regular Command Prompt (CMD) in the project root and run:

```cmd
cd C:\Users\jesus\OneDrive\Documentos\Proyectos jesu\lovabox-checkout-main
set VITE_API_URL=https://tu-backend-en-render.com
npm ci
npm run build
```

2) Build (PowerShell temporary env)

Open PowerShell in the project root and run:

```powershell
# for current session only
$env:VITE_API_URL = "https://tu-backend-en-render.com"
npm ci
npm run build
```

If PowerShell blocks `npm` because of script execution policy, run CMD instead or open PowerShell as Administrator and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

3) Create ZIP of `dist` (PowerShell)

After a successful build, create `dist.zip` by running in PowerShell:

```powershell
cd C:\Users\jesus\OneDrive\Documentos\Proyectos jesu\lovabox-checkout-main
.\scripts\zip-dist.ps1
```

Or using the GUI: right-click `dist` -> Send to -> Compressed (zipped) folder.
