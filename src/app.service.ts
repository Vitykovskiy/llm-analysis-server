import { Injectable } from '@nestjs/common';
import { LangchainService } from './langchain/langchain.service';

@Injectable()
export class AppService {
  constructor(private readonly langchainService: LangchainService) {}

  getHello(): Promise<string> {
    return this.langchainService.generateEcho('NestJS сервер готов к работе');
  }
}
