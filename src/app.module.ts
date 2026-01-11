import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { LangchainModule } from './langchain/langchain.module';
import { MessagesModule } from './messages/messages.module';
import { TasksModule } from './tasks/tasks.module';
import { ResultsModule } from './results/results.module';

@Module({
  imports: [
    DatabaseModule,
    LangchainModule,
    MessagesModule,
    TasksModule,
    ResultsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
