// main.ts
import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*', // permitir todos los orígenes
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false, // ❗ sin credenciales
    maxAge: 86400,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? 5001);

  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Auth & Users API')
      .setDescription('API para gestión de usuarios y autenticación')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addServer(`http://localhost:${port}`)
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, { swaggerOptions: { persistAuthorization: true } });
  }

  await app.listen(port);
}
bootstrap();
