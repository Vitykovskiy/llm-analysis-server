import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { TasksService, Task } from './tasks.service';

class TaskRelationDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'TASK-0001' })
  code!: string;

  @ApiProperty({ example: 'Сбор требований' })
  title!: string;
}

class TaskDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'task' })
  type!: string;

  @ApiProperty({ example: 'Сбор требований' })
  title!: string;

  @ApiProperty({ example: 'Провести интервью о текущем процессе' })
  description!: string;

  @ApiProperty({ example: 'Открыта' })
  status!: string;

  @ApiProperty({ example: 'TASK-0001' })
  code!: string;

  @ApiProperty({ example: '2026-01-11T12:00:00Z' })
  createdAt!: string;

  @ApiProperty({ type: TaskRelationDto, isArray: true })
  parents!: TaskRelationDto[];

  @ApiProperty({ type: TaskRelationDto, isArray: true })
  children!: TaskRelationDto[];
}

class CreateTaskDto {
  @ApiProperty({ example: 'task' })
  type!: string;

  @ApiProperty({ example: 'Сбор требований' })
  title!: string;

  @ApiProperty({ example: 'Провести интервью о текущем процессе' })
  description!: string;

  @ApiPropertyOptional({ example: 'Открыта' })
  status?: string;

  @ApiPropertyOptional({ type: Number, isArray: true, example: [1, 2] })
  parentIds?: number[];

  @ApiPropertyOptional({ type: Number, isArray: true, example: [3] })
  childIds?: number[];
}

class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'task' })
  type?: string;

  @ApiPropertyOptional({ example: 'Сбор требований' })
  title?: string;

  @ApiPropertyOptional({ example: 'Провести интервью о текущем процессе' })
  description?: string;

  @ApiPropertyOptional({ example: 'Открыта' })
  status?: string;

  @ApiPropertyOptional({ type: Number, isArray: true, example: [1, 2] })
  parentIds?: number[];

  @ApiPropertyOptional({ type: Number, isArray: true, example: [3] })
  childIds?: number[];
}

class DeleteResultDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Список задач' })
  @ApiOkResponse({ type: TaskDto, isArray: true })
  list(): Promise<Task[]> {
    return this.tasksService.list();
  }

  @Post()
  @ApiOperation({ summary: 'Создать задачу' })
  @ApiBody({ type: CreateTaskDto })
  @ApiCreatedResponse({ type: TaskDto })
  create(
    @Body('type') type: string,
    @Body('title') title: string,
    @Body('description') description: string,
    @Body('status') status?: string,
    @Body('parentIds') parentIds?: unknown,
    @Body('childIds') childIds?: unknown,
  ): Promise<Task> {
    return this.tasksService.create({
      type,
      title,
      description,
      status,
      parentIds,
      childIds,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить задачу' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiBody({ type: UpdateTaskDto })
  @ApiOkResponse({ type: TaskDto })
  @ApiBadRequestResponse({
    description: 'ID задачи должен быть положительным числом',
  })
  update(
    @Param('id') id: string,
    @Body('type') type?: string,
    @Body('title') title?: string,
    @Body('description') description?: string,
    @Body('status') status?: string,
    @Body('parentIds') parentIds?: unknown,
    @Body('childIds') childIds?: unknown,
  ): Promise<Task> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new BadRequestException(
        'ID задачи должен быть положительным числом',
      );
    }

    return this.tasksService.update(numericId, {
      type,
      title,
      description,
      status,
      parentIds,
      childIds,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить задачу' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: DeleteResultDto })
  @ApiBadRequestResponse({
    description: 'ID задачи должен быть положительным числом',
  })
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new BadRequestException(
        'ID задачи должен быть положительным числом',
      );
    }

    await this.tasksService.delete(numericId);
    return { deleted: true };
  }
}
