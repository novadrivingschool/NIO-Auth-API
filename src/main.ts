// main.ts
import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const isProd = process.env.NODE_ENV === 'production';

  // 🔓 CORS abierto (todos los orígenes)
  // Nota: si en algún momento usas cookies/sesiones (credentials: true),
  // NO puedes usar '*' y deberás cambiar origin a 'true' o una lista explícita.
  app.enableCors({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Deja allowedHeaders indefinido para que el middleware refleje lo que pida el preflight
    allowedHeaders: undefined,
    credentials: false, // si vas a usar cookies httpOnly, cambia a true y NO uses '*'
    maxAge: 86400,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  if (!isProd) {
    const port = process.env.PORT ?? 5001;
    const config = new DocumentBuilder()
      .setTitle('Auth & Users API')
      .setDescription('API para gestión de usuarios y autenticación')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addServer(`http://localhost:${port}`)
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(process.env.PORT ?? 5001);
}
bootstrap();
