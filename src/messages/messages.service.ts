import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { LangchainService } from '../langchain/langchain.service';
import { VectorStoreService } from '../langchain/vector-store.service';

export interface ChatMessage {
  id: number;
  userText: string;
  botReply: string;
  createdAt: string;
}

export interface SimilarEntry {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly langchainService: LangchainService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  async sendMessage(text: string): Promise<ChatMessage> {
    const userText = text ?? '';
    const trimmed = userText.trim();

    if (!trimmed) {
      throw new BadRequestException('Message text is required');
    }

    const botReply =
      await this.langchainService.generateTaskAwareReply(userText);
    const saved = await this.databaseService.saveMessage(userText, botReply);
    await this.indexInVectorStore(userText, botReply, saved);
    this.logger.debug(`Saved message #${saved.id}`);
    return saved;
  }

  async listMessages(limit = 20): Promise<ChatMessage[]> {
    return this.databaseService.getRecentMessages(limit);
  }

  async clearMessages(): Promise<void> {
    await this.databaseService.clearMessages();
    this.logger.debug('Cleared chat history');
  }

  async searchSimilar(query: string, limit = 3): Promise<SimilarEntry[]> {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new BadRequestException('Query is required');
    }

    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10) : 3;
    return this.vectorStoreService.similaritySearch(trimmed, safeLimit);
  }

  private async indexInVectorStore(
    userText: string,
    botReply: string,
    saved: ChatMessage,
  ): Promise<void> {
    try {
      await this.vectorStoreService.indexConversation({
        userText,
        botReply,
        messageId: saved.id,
        createdAt: saved.createdAt,
      });
    } catch (err) {
      this.logger.warn(
        `Vector store indexing failed: ${(err as Error).message}`,
      );
    }
  }
}
