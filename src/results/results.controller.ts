import { Controller, Get } from '@nestjs/common';
import { ResultEntry, ResultsService } from './results.service';

@Controller('results')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get()
  list(): Promise<ResultEntry[]> {
    return this.resultsService.list();
  }
}
