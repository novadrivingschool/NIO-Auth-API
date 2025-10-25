## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```
# Migrations
mkdir -p src/db/migrations

npm run db:migration:generate -- src/db/migrations/create-users
npm run db:migration:run

# Pruebas Unitarias
npm run test users.service.spec.ts
npm run test users.controller.spec.ts

# GITHUB
git remote remove origin
git remote add origin git@github-beestomer:beestomer/auth-and-users-api.git

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


# Docker
docker build -t dev-nova-in-out-auth-api .

docker run -d --name dev-nova-in-out-auth-api -p 5013:5013 --env-file .env dev-nova-in-out-auth-api

docker logs -f dev-nova-in-out-auth-api
