import { Module } from '@nestjs/common';
import { DatabaseArtifactsService } from './database-artifacts.service';
import { DatabaseCoreService } from './database.core.service';
import { DatabaseMessagesService } from './database-messages.service';
import { DatabaseTasksService } from './database-tasks.service';

@Module({
  providers: [
    DatabaseCoreService,
    DatabaseMessagesService,
    DatabaseTasksService,
    DatabaseArtifactsService,
  ],
  exports: [
    DatabaseMessagesService,
    DatabaseTasksService,
    DatabaseArtifactsService,
  ],
})
export class DatabaseModule {}
