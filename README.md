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

## Deploy con registry (GHCR) — recomendado

El servidor **no compila nada**: descarga la imagen publicada en GitHub Container Registry y la arranca.

| Dato | Valor |
|---|---|
| Imagen | `ghcr.io/novadrivingschool/nio-auth-api:<versión>` (la versión va sin `v`) |
| Repo / cuenta GitHub | `novadrivingschool/NIO-Auth-API` |
| Carpeta en el servidor | `~/NovaInOut` |
| Archivos en el servidor | `auth.yml` y `auth.env` (`.env` independiente por servicio) |
| Contenedor / proyecto | `nio-auth-dev` / `nio-auth` |
| Puerto | `127.0.0.1:5013` (nginx lo expone por HTTPS) |
| URL | `https://dev.auth-user.nio.novadrivingone.net` |
| Healthcheck | `GET /health` → `{"status":"ok","db":"up"}` |

> El servidor usa **docker-compose v1** (`docker-compose`, con guion). Atajo para cada sesión:
>
> ```bash
> cd ~/NovaInOut
> DC="docker-compose --env-file auth.env -f auth.yml -p nio-auth"
> ```

### A. Publicar una versión (tu PC) — primera vez y cada actualización

```bash
npm run build
git add -A && git commit -m "mensaje" && git push origin main
git tag v1.0.1 && git push origin v1.0.1        # el tag lleva "v"; la imagen queda sin "v"
```

Esperar el ✅ verde en **Actions**. Sin `git push origin vX.Y.Z` el workflow no se dispara.

### B. Primera vez en el servidor

**1. Login a GHCR** (si ya se hizo para otro servicio, saltar): `docker login ghcr.io -u novadrivingschool`
con un token clásico con **solo** `read:packages` como contraseña. Debe decir `Login Succeeded`.

**2. Crear los archivos** (`~/NovaInOut`):

```bash
nano auth.yml     # contenido de deploy/auth.yml
nano auth.env     # basado en deploy/auth.env.example, con los valores reales
chmod 600 auth.env
```

Reglas del `auth.env`:
- Sin espacios alrededor del `=` y **sin comentarios en la misma línea** del valor (docker-compose v1 los toma como parte del valor).
- `AUTH_IMAGE_TAG` = versión publicada, sin `v`.
- `NODE_ENV=production`, `ADMIN_BOOTSTRAP=false` (solo `true` la primera vez en una BD vacía).
- `WS_PUBLIC_URL=https://dev.auth-user.nio.novadrivingone.net`.
- Nunca subir `auth.env` a git (`deploy/*.env` está en `.gitignore`).

**3. Puerto libre:** `ss -ltnp | grep 5013` (no debe mostrar nada).

**4. Descargar y levantar:**

```bash
docker pull ghcr.io/novadrivingschool/nio-auth-api:1.0.0
$DC stop; $DC rm -f
$DC up -d
sleep 25
$DC ps                                    # Up (healthy)
$DC logs --tail=50
curl -s http://127.0.0.1:5013/health      # {"status":"ok","db":"up",...}
```

**5. nginx y SSL** (solo la primera vez). El DNS A de `dev.auth-user.nio.novadrivingone.net` debe apuntar al servidor.
No borrar otros vhosts. Se detiene solo si el DNS aún no resuelve:

```bash
getent hosts dev.auth-user.nio.novadrivingone.net && \
cat > /etc/nginx/sites-available/nio-auth <<'EOF'
# contenido de nginx.host.conf (de este repo)
EOF
ln -sf /etc/nginx/sites-available/nio-auth /etc/nginx/sites-enabled/nio-auth && \
nginx -t && systemctl reload nginx && \
certbot --nginx -d dev.auth-user.nio.novadrivingone.net && \
curl -s https://dev.auth-user.nio.novadrivingone.net/health
```

Sustituir la línea `# contenido de nginx.host.conf...` por el contenido real de `nginx.host.conf`
(incluye los headers `Upgrade`/`Connection` para WebSocket). Elegir **redirect** a HTTPS en certbot.

### C. Actualizar (cada versión nueva)

1. En tu PC, publicar la versión (sección **A**) y esperar el ✅.
2. En el servidor:

```bash
cd ~/NovaInOut
DC="docker-compose --env-file auth.env -f auth.yml -p nio-auth"
sed -i 's/^AUTH_IMAGE_TAG=.*/AUTH_IMAGE_TAG=1.0.1/' auth.env     # la versión nueva
$DC pull
$DC stop; $DC rm -f          # obligatorio en docker-compose v1 (bug ContainerConfig)
$DC up -d
sleep 25
$DC ps
curl -s http://127.0.0.1:5013/health
```

### D. Rollback

Poner la versión anterior en `AUTH_IMAGE_TAG` y repetir `pull`, `stop`, `rm -f` y `up -d`. No revierte migraciones ya aplicadas.

### Migraciones

No se ejecutan al arrancar (`DB_SYNC=false`) y la imagen solo trae el código compilado.
Las migraciones nuevas se corren **desde tu PC** contra la BD (con el `.env` local apuntando a ella):

```bash
npm run db:migration:run
```

Hacerlo **antes** de publicar la versión que las necesita.

### Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `docker: unknown command: docker compose` | Usar `docker-compose` (con guion). |
| `pull` → `denied` | Login con otra cuenta o token sin `read:packages`. Repetir el login con `novadrivingschool`. |
| `pull` → `manifest unknown` | Esa versión no existe: la Action no terminó o falta `git push origin vX.Y.Z`. |
| `ContainerConfig` al hacer `up -d` | Hacer `$DC stop; $DC rm -f` antes del `up -d`. |
| `all predefined address pools have been fully subnetted` | El servidor no tiene rangos para redes nuevas. `auth.yml` usa `network_mode: bridge` para no crear una. |
| Contenedor `unhealthy` | Ver `$DC logs`: BD inalcanzable o variable faltante en `auth.env`. |
| WebSocket no conecta | Revisar `Upgrade`/`Connection` en el vhost de nginx y `WS_PUBLIC_URL`. |
| Variable con valor raro | Comentario en la misma línea del valor en `auth.env`: quitarlo. |

---

## Deploy con Docker Compose (legado, build en el servidor)

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
docker logs -f nio-auth-dev
```

### Actualizar después de un cambio de código

```bash
git pull
docker-compose down
docker-compose up -d --build
```

### Comandos útiles

```bash
# Ver estado
docker-compose ps

# Logs en tiempo real
docker logs -f nio-auth-dev

# Reiniciar sin rebuild
docker-compose restart

# Detener y eliminar contenedor (sin borrar imagen)
docker-compose down

# Rebuild limpio desde cero
docker-compose down
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
