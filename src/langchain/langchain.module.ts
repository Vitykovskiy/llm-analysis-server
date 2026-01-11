import { Module } from '@nestjs/common';
import { LangchainService } from './langchain.service';
import { VectorStoreService } from './vector-store.service';
import { TasksModule } from '../tasks/tasks.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [TasksModule, DatabaseModule],
  providers: [LangchainService, VectorStoreService],
  exports: [LangchainService, VectorStoreService],
})
export class LangchainModule {}
