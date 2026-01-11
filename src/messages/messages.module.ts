import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { DatabaseModule } from '../database/database.module';
import { LangchainModule } from '../langchain/langchain.module';

@Module({
  imports: [DatabaseModule, LangchainModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
