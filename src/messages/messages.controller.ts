import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiProperty,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { ChatMessage, SimilarEntry } from './messages.service';

class ChatMessageDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Опиши текущий процесс' })
  userText!: string;

  @ApiProperty({ example: 'Какая команда отвечает за этот процесс?' })
  botReply!: string;

  @ApiProperty({ example: '2026-01-11T12:00:00Z' })
  createdAt!: string;
}

class SimilarEntryDto {
  @ApiProperty({ example: 'Опиши текущий процесс' })
  content!: string;

  @ApiProperty({ example: { messageId: 1, role: 'user' } })
  metadata!: Record<string, unknown>;

  @ApiProperty({ example: 0.12 })
  score!: number;
}

class SendMessageDto {
  @ApiProperty({ example: 'Опиши текущий процесс' })
  text!: string;
}

@ApiTags('messages')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('similar')
  @ApiOperation({ summary: 'Найти похожие сообщения в векторном хранилище' })
  @ApiQuery({ name: 'query', example: 'Текущий процесс согласования' })
  @ApiQuery({ name: 'limit', required: false, example: 3 })
  @ApiOkResponse({ type: SimilarEntryDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Параметр query обязателен' })
  getSimilar(
    @Query('query') query: string,
    @Query('limit') limit?: string,
  ): Promise<SimilarEntry[]> {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : 3;
    return this.messagesService.searchSimilar(query, safeLimit);
  }

  @Get()
  @ApiOperation({ summary: 'Список последних сообщений' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiOkResponse({ type: ChatMessageDto, isArray: true })
  getMessages(@Query('limit') limit?: string): Promise<ChatMessage[]> {
    const parsedLimit = Number(limit);
    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 20;
    return this.messagesService.listMessages(safeLimit);
  }

  @Post()
  @ApiOperation({ summary: 'Отправить сообщение ассистенту' })
  @ApiBody({ type: SendMessageDto })
  @ApiOkResponse({ type: ChatMessageDto })
  @ApiBadRequestResponse({ description: 'Текст сообщения обязателен' })
  sendMessage(@Body('text') text: string): Promise<ChatMessage> {
    return this.messagesService.sendMessage(text);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Очистить историю чата' })
  @ApiNoContentResponse()
  clearMessages(): Promise<void> {
    return this.messagesService.clearMessages();
  }
}
