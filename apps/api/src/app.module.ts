import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { LocalAuthController } from './auth/local-auth.controller';
import { AuthGuard, PrincipalService } from './auth/principal';
import { SessionService } from './auth/session.service';
import { AiService } from './chat/ai.service';
import { ChatController, HrController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { AccountsService } from './directory/accounts.service';
import { ActivationService } from './directory/activation.service';
import { ActivationController, MeController, WorkController } from './directory/work.controller';
import { HealthController } from './health.controller';
import { LeaveService } from './hr/leave.service';
import './provisioning/handlers';

@Module({
  controllers: [HealthController, AuthController, LocalAuthController, WorkController, ActivationController, MeController, ChatController, HrController],
  providers: [SessionService, PrincipalService, AccountsService, ActivationService, ChatService, LeaveService, AiService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
