import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiProperty,
} from '@nestjs/swagger';
import { ResultEntry, ResultsService } from './results.service';

class ResultEntryDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Пользовательские сценарии' })
  title!: string;

  @ApiProperty({ example: 'markdown' })
  format!: string;

  @ApiProperty({ example: '...markdown содержимое...' })
  content!: string;

  @ApiProperty({ example: 'USER_SCENARIO' })
  category!: string;

  @ApiProperty({ example: 'text' })
  kind!: string;

  @ApiProperty({ example: 2 })
  version!: number;

  @ApiProperty({ example: 'https://example.com/render/1', nullable: true })
  renderUrl?: string | null;

  @ApiProperty({ example: '2026-01-11T12:00:00Z' })
  createdAt!: string;
}

@ApiTags('results')
@Controller('results')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get()
  @ApiOperation({ summary: 'Список последних артефактов' })
  @ApiOkResponse({ type: ResultEntryDto, isArray: true })
  list(): Promise<ResultEntry[]> {
    return this.resultsService.list();
  }
}
