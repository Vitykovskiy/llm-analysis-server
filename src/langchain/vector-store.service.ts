import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Document } from '@langchain/core/documents';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { OpenAIEmbeddings } from '@langchain/openai';
import { ChromaCollection, ChromaCollectionGetResult } from './types';

type ChromaWithCollection = Chroma & { collection?: ChromaCollection };

interface SearchResult {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private readonly collectionName = 'requirements';
  private readonly chromaUrl = process.env.CHROMA_URL;
  private readonly embeddings: OpenAIEmbeddings | null;
  private storePromise?: Promise<Chroma>;

  constructor() {
    const apiKey = process.env.LLM_API_TOKEN;
    if (!apiKey) {
      this.logger.warn('LLM_API_TOKEN не задан; интеграция с Chroma отключена');
      this.embeddings = null;
      return;
    }

    if (!this.chromaUrl) {
      this.logger.warn('CHROMA_URL не задан; интеграция с Chroma отключена');
      this.embeddings = null;
      return;
    }

    this.embeddings = new OpenAIEmbeddings({ apiKey });
  }

  async indexConversation(payload: {
    userText: string;
    botReply: string;
    messageId: number;
    createdAt: string;
  }): Promise<void> {
    if (!this.isEnabled()) return;

    const documents = [
      new Document({
        pageContent: payload.userText,
        metadata: {
          messageId: payload.messageId,
          role: 'user',
          createdAt: payload.createdAt,
        },
      }),
      new Document({
        pageContent: payload.botReply,
        metadata: {
          messageId: payload.messageId,
          role: 'assistant',
          createdAt: payload.createdAt,
        },
      }),
    ].filter((doc) => Boolean(doc.pageContent?.trim()));

    if (!documents.length) return;

    try {
      const store = await this.getStore();
      await store.addDocuments(documents);
    } catch (err) {
      this.logger.warn(
        `Не удалось проиндексировать диалог в Chroma: ${
          (err as Error).message
        }`,
      );
      this.resetStore();
    }
  }

  async addDocument(input: {
    content: string;
    metadata?: Record<string, unknown>;
    id?: string;
  }): Promise<{ id: string }> {
    if (!this.isEnabled()) throw new Error('Chroma не настроена');

    const trimmed = input.content?.trim();
    if (!trimmed) {
      throw new Error('Требуется содержимое');
    }

    const id = input.id?.toString() ?? randomUUID();
    const doc = new Document({
      pageContent: trimmed,
      metadata: input.metadata ?? {},
    });

    const store = await this.getStore();
    await store.addDocuments([doc], { ids: [id] });
    return { id };
  }

  async updateDocument(input: {
    id: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    if (!this.isEnabled()) throw new Error('Chroma не настроена');
    const id = input.id?.toString();
    if (!id) throw new Error('Требуется идентификатор документа');
    if (!input.content && !input.metadata) {
      throw new Error('Укажите содержимое или метаданные для обновления');
    }

    const store = await this.getStore();
    const collection = (store as ChromaWithCollection).collection;
    if (!collection?.get) {
      throw new Error('Не удалось получить доступ к коллекции Chroma');
    }

    const existing = await collection.get({
      ids: [id],
      include: ['documents', 'metadatas'],
    });

    if (!existing?.ids?.length) {
      throw new Error(`Документ ${id} не найден`);
    }

    const currentContent = existing.documents?.[0];
    const currentMetadata: Record<string, unknown> =
      existing.metadatas?.[0] ?? {};

    const newContent = input.content?.trim() || currentContent || '';
    if (!newContent) {
      throw new Error('Обновленное содержимое не может быть пустым');
    }

    const newMetadata = input.metadata
      ? { ...currentMetadata, ...input.metadata }
      : currentMetadata;

    if (!collection.update) {
      // Резервный вариант: удалить и добавить заново
      if (!collection.delete || !collection.add) {
        throw new Error('Коллекция Chroma недоступна');
      }
      await collection.delete({ ids: [id] });
      await collection.add({
        ids: [id],
        documents: [newContent],
        metadatas: [newMetadata],
      });
      return { id };
    }

    await collection.update({
      ids: [id],
      documents: [newContent],
      metadatas: [newMetadata],
    });

    return { id };
  }

  async deleteDocument(id: string): Promise<{ deleted: boolean }> {
    if (!this.isEnabled()) throw new Error('Chroma не настроена');
    const safeId = id?.toString();
    if (!safeId) throw new Error('Требуется идентификатор документа');

    const store = await this.getStore();
    const collection = (store as ChromaWithCollection).collection;
    if (!collection?.delete) {
      throw new Error('Не удалось получить доступ к коллекции Chroma');
    }

    await collection.delete({ ids: [safeId] });
    return { deleted: true };
  }

  async similaritySearch(query: string, limit = 3): Promise<SearchResult[]> {
    if (!this.isEnabled()) return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    try {
      const store = await this.getStore();
      const vector = await this.embeddings!.embedQuery(trimmed);
      const results = await store.similaritySearchVectorWithScore(
        vector,
        Math.min(Math.max(limit, 1), 10),
      );
      return results.map(([doc, score]) => ({
        content: doc.pageContent,
        metadata: doc.metadata as Record<string, unknown>,
        score,
      }));
    } catch (err) {
      this.logger.warn(
        `Поиск похожих документов в Chroma завершился ошибкой: ${
          (err as Error).message
        }`,
      );
      this.resetStore();
      return [];
    }
  }

  async getDocument(id: string): Promise<SearchResult | null> {
    if (!this.isEnabled()) throw new Error('Chroma не настроена');
    const safeId = id?.toString();
    if (!safeId) throw new Error('Требуется идентификатор документа');

    const store = await this.getStore();
    const collection = (store as ChromaWithCollection).collection;
    if (!collection?.get) {
      throw new Error('Не удалось получить доступ к коллекции Chroma');
    }

    const found = (await collection.get({
      ids: [safeId],
      include: ['documents', 'metadatas', 'distances'],
    })) as ChromaCollectionGetResult;

    if (!found?.ids?.length) return null;

    return {
      content: found.documents?.[0] ?? '',
      metadata: found.metadatas?.[0] ?? {},
      score: found.distances?.[0] ?? 0,
    };
  }

  private isEnabled(): boolean {
    return Boolean(this.embeddings && this.chromaUrl);
  }

  private async getStore(): Promise<Chroma> {
    if (!this.isEnabled() || !this.embeddings || !this.chromaUrl) {
      throw new Error('Chroma не настроена');
    }

    if (!this.storePromise) {
      this.storePromise = Chroma.fromExistingCollection(this.embeddings, {
        collectionName: this.collectionName,
        url: this.chromaUrl,
      }).catch(async (err) => {
        this.logger.warn(
          `Не удалось найти коллекцию Chroma (${(err as Error).message}), пробуем создать новую`,
        );
        return Chroma.fromTexts([], [], this.embeddings!, {
          collectionName: this.collectionName,
          url: this.chromaUrl,
        });
      });
    }

    return this.storePromise;
  }

  private resetStore(): void {
    this.storePromise = undefined;
  }
}
