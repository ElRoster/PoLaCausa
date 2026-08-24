# PoLa Causa

Software monolito de ventas e inventario para una tienda de cervezas.

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Base de datos: PostgreSQL
- Auth: email + password hasheado + JWT
- Adjuntos: imagenes de productos con `multer`

## Inicio rapido

1. Instala dependencias:

```bash
npm install
```

2. Levanta PostgreSQL:

```bash
docker compose up -d
```

3. Crea `server/.env` desde el ejemplo:

```bash
cp server/.env.example server/.env
```

4. Ejecuta migraciones y semilla:

```bash
npm run db:migrate
npm run db:seed
```

5. Inicia el proyecto:

```bash
npm run dev
```

Credenciales iniciales:

- Email: `admin@polacausa.com`
- Password: `PolaCausa2026!`

Frontend: http://localhost:3000
API: http://localhost:4000
