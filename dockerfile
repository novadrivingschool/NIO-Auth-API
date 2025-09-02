# ---------- 1. Build stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependencias del sistema necesarias para compilar bcrypt y otras libs
RUN apk add --no-cache python3 make g++

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias (incluyendo devDependencies para compilar)
RUN npm install

# Copiar el resto del código
COPY . .

# Compilar la app
RUN npm run build

# ---------- 2. Runtime stage ----------
FROM node:20-alpine AS runner

WORKDIR /app

# Instalar solo dependencias necesarias en producción
RUN apk add --no-cache bash

COPY package*.json ./
RUN npm install --only=production

# Copiar los artefactos compilados desde la etapa anterior
COPY --from=builder /app/dist ./dist

# Variables de entorno
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Comando de inicio
CMD ["node", "dist/main.js"]
