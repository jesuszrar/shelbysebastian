# Shelby Checkout

Guia rapida para dejar el proyecto funcionando en produccion con Railway + Render + Hostinger.

## 1) Backend en Render

Render debe leer el blueprint de [render.yaml](render.yaml).

Configuracion esperada del servicio web:

- Root Directory: backend
- Build Command: npm install && npx prisma generate && npx prisma migrate deploy && npm run build
- Start Command: npm run start
- Health Check Path: /health

## 2) Variables en Render

Crear estas variables en el servicio backend:

- DATABASE_URL
- JWT_SECRET
- CORS_ORIGIN

Valor para DATABASE_URL (sin comillas):

mysql://USUARIO:PASSWORD@HOST:PUERTO/NOMBRE_DB

Valor recomendado para CORS_ORIGIN:

https://your-frontend-domain.com

JWT_SECRET debe ser una cadena larga y unica.

## 3) Tablas en MySQL

No hay que crearlas manualmente. Durante el deploy Render ejecuta:

npx prisma migrate deploy

Eso crea las tablas del esquema Prisma:

- User
- Product
- Order
- CedulaEmail

## 4) Frontend en Hostinger

Hostinger sirve sitios estáticos. Build del frontend debe generarse con la variable de entorno correcta y luego subir la carpeta `dist` al panel de Hostinger (o mediante FTP).

- Localmente: exporta la variable `VITE_API_URL` apuntando a tu backend en Render y ejecuta `npm run build`.
	- Ejemplo (Windows PowerShell): `setx VITE_API_URL "https://shelby-backend.onrender.com"` y luego `npm run build`.
- Sube la carpeta `dist` resultante a Hostinger.
- Asegúrate de incluir `public/.htaccess` para reglas SPA (ya agregado en el repo).

## 5) Verificacion final

- Backend: abrir /health y verificar {"ok":true}
- Frontend: probar registro/login
- Admin: crear o editar productos
- Checkout: crear orden
