import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}