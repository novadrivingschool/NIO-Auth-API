# auth-and-users-api

API de autenticación y usuarios — Nova In Out.  
NestJS · PostgreSQL (DigitalOcean) · JWT · WebSockets

Puerto: **5013**

---

## Variables de entorno

Crea el archivo `.env` en la raíz del proyecto antes de cualquier deploy:

```env
NODE_ENV=production

# Base de datos (DigitalOcean Managed PostgreSQL)
DB_HOST=db-postgresql-nyc3-01214-do-user-16052381-0.c.db.ondigitalocean.com
DB_PORT=25060
DB_NAME=dev_nova_in_out
DB_USER=doadmin
DB_PASS=AQUI_VA_EL_PASS
DB_SSL=true
DB_SYNC=false

# Puerto de la API
PORT=5013

# JWT — generar con: openssl rand -base64 64
JWT_ACCESS_TTL=1h
JWT_REFRESH_TTL=7d
JWT_ACCESS_SECRET=CAMBIAR_POR_SECRET_SEGURO
JWT_REFRESH_SECRET=CAMBIAR_POR_SECRET_SEGURO

# Bootstrap del admin inicial (solo primera vez, luego poner false)
ADMIN_BOOTSTRAP=true
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=CAMBIAR_PASSWORD
ADMIN_NAME=Owner
ADMIN_ROLE=super_admin
OWNER_FIRST_NAME=Javier
OWNER_LAST_NAME=González

# CORS — separar múltiples orígenes con coma
CORS_ORIGINS=http://localhost:5173,http://137.184.146.19

# WebSocket
WS_PUBLIC_URL=http://localhost:5013
WS_PATH=/ws
WS_TIMEOUT_MS=3000
```

> ⚠️ El archivo `.env` nunca se sube al repositorio.

---

## Deploy con Docker Compose (recomendado)

### Primera vez en el servidor

```bash
# 1. Clonar el repo
git clone <repo-url> auth-and-users-api
cd auth-and-users-api

# 2. Crear el .env con los valores de producción
nano .env

# 3. Construir y levantar
docker-compose up -d --build

# 4. Verificar que levantó
docker-compose ps
docker-compose logs -f
```

### Actualizar después de un cambio de código

```bash
git pull
docker-compose up -d --build
```

### Comandos útiles

```bash
# Ver estado
docker-compose ps

# Logs en tiempo real
docker-compose logs -f

# Reiniciar sin rebuild
docker-compose restart

# Detener y eliminar contenedor (sin borrar imagen)
docker-compose down

# Rebuild limpio desde cero
docker-compose down --rmi local
docker-compose up -d --build
```

---

## Deploy manual con Docker (sin Compose)

```bash
# Construir imagen
docker build -t dev-nova-in-out-auth-api .

# Correr contenedor
docker run -d \
  --name dev-nova-in-out-auth-api \
  --restart always \
  -p 5013:5013 \
  --env-file .env \
  dev-nova-in-out-auth-api

# Ver logs
docker logs -f dev-nova-in-out-auth-api

# Detener y eliminar
docker stop dev-nova-in-out-auth-api && docker rm dev-nova-in-out-auth-api
```

---

## Desarrollo local (sin Docker)

```bash
# Instalar dependencias
npm install

# Modo desarrollo con hot-reload
npm run start:dev

# Compilar y correr en modo producción
npm run build
npm run start:prod
```

---

## Migraciones

```bash
# Generar migración
mkdir -p src/db/migrations
npm run db:migration:generate -- src/db/migrations/nombre-migracion

# Correr migraciones
npm run db:migration:run
```

---

## Tests

```bash
# Todos los tests unitarios
npm run test

# Watch mode
npm run test:watch

# Cobertura
npm run test:cov

# Archivo específico
npm run test users.service.spec.ts
npm run test users.controller.spec.ts
```

---

## Git — configuración SSH con clave dedicada

```bash
ssh-keygen -t ed25519 -C "beestomer@gmail.com" -f ~/.ssh/id_ed25519_beestomer

cat >> ~/.ssh/config <<'EOF'
Host github-beestomer
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_beestomer
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
chmod 600 ~/.ssh/id_ed25519_beestomer

git remote remove origin
git remote add origin git@github-beestomer:beestomer/auth-and-users-api.git
```

---

## Versiones del servidor

```
Docker:          29.1.3
docker-compose:  1.29.2
Node (imagen):   20-alpine
```
