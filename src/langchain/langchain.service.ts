import { Injectable, Logger } from '@nestjs/common';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { Task, TasksService } from '../tasks/tasks.service';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from './vector-store.service';

@Injectable()
export class LangchainService {
  private readonly logger = new Logger(LangchainService.name);

  private readonly model: ChatOpenAI;

  private readonly echoChain: RunnableSequence<{ input: string }, string>;

  private readonly taskTools: DynamicStructuredTool[];

  constructor(
    private readonly tasksService: TasksService,
    private readonly databaseService: DatabaseService,
    private readonly vectorStoreService: VectorStoreService,
  ) {
    const apiKey = process.env.LLM_API_TOKEN;
    if (!apiKey) {
      throw new Error('LLM_API_TOKEN is not set');
    }

    this.model = new ChatOpenAI({
      apiKey,
      model: process.env.LLM_MODEL ?? 'gpt-4.1',
      temperature: 0.2,
    });

    this.echoChain = RunnableSequence.from([
      PromptTemplate.fromTemplate('Echo from LangChain: {input}'),
      this.model,
      new StringOutputParser(),
    ]);

    this.taskTools = this.buildTaskTools();
  }

  async generateEcho(input: string): Promise<string> {
    this.logger.debug('Sending prompt to OpenAI');
    return this.echoChain.invoke({ input });
  }

  /**
   * Главная точка входа для диалога с инструментами задач.
   * Простая петля вызова инструментов, чтобы модель могла действовать по запросу.
   */
  async generateTaskAwareReply(input: string): Promise<string> {
    const toolModel = this.model.bindTools(this.taskTools);
    const messages: BaseMessage[] = [
      new SystemMessage(`Ты - LLM-агент, выполняющий функцию сбора и уточнения требований к автоматизации.

Твоя единственная задача - пошагово собирать информацию от пользователя.
Ты НЕ формируешь решения, требования, диаграммы, выводы или рекомендации.
Ты НЕ объясняешь пользователю, что и зачем будет сделано.

Правила работы:
1. Ты работаешь в режиме диалога и задаёшь ТОЛЬКО уточняющие вопросы.
2. За один шаг ты задаёшь не более 1–3 логически связанных вопросов.
3. Каждый вопрос должен быть направлен на уточнение фактов, а не предположений.
4. Если информации достаточно по текущему блоку — переходи к следующему блоку.
5. Не интерпретируй ответы пользователя вслух.
6. Не суммируй и не пересказывай полученную информацию пользователю.
7. Не предлагай вариантов решений, автоматизации или архитектуры.

Обработка информации:
— после каждого ответа пользователя извлекай факты;
— сохраняй извлечённую информацию во внутреннее хранилище;
— структурируй данные по категориям (процесс, роли, данные, события, проблемы, ограничения);
- информация должна быть пригодна для последующего векторного поиска.

Стиль общения:
— нейтральный, деловой;
— короткие, понятные вопросы;
— без терминов, если пользователь их не использовал.

Последовательность сбора информации:
1. Цель автоматизации.
2. Описание текущего процесса («как есть»).
3. Участники процесса и их действия.
4. Входные и выходные данные.
5. Проблемы и узкие места.
6. Ограничения и допущения.
7. Критерии завершённости процесса (когда считается, что всё выполнено).

Если пользователь уходит в рассуждения - мягко возвращай его к фактам.
`),
    ];
    const history = await this.loadRecentHistory();
    messages.push(...history, new HumanMessage(input));

    for (let step = 0; step < 6; step += 1) {
      const response = (await toolModel.invoke(messages)) as AIMessage;
      messages.push(response);

      if (!response.tool_calls?.length) {
        const content =
          typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);
        return content;
      }

      for (const call of response.tool_calls) {
        const toolCallId = call.id ?? 'tool-call';
        const tool = this.taskTools.find((item) => item.name === call.name);
        if (!tool) {
          messages.push(
            new ToolMessage({
              content: 'Инструмент ${call.name} недоступен',
              tool_call_id: toolCallId,
            }),
          );
          continue;
        }

        try {
          const result = await tool.invoke(call.args);
          messages.push(
            new ToolMessage({
              content: result,
              tool_call_id: toolCallId,
            }),
          );
        } catch (err) {
          messages.push(
            new ToolMessage({
              content: 'Ошибка инструмента: ${(err as Error).message}',
              tool_call_id: toolCallId,
            }),
          );
        }
      }
    }

    return 'Не удалось выполнить запрос доступными инструментами.';
  }

  getTaskTools(): DynamicStructuredTool[] {
    return this.taskTools;
  }

  private buildTaskTools(): DynamicStructuredTool[] {
    const statusEnum = z.enum([
      'Открыта',
      'Требует уточнения',
      'Готова к продолжению',
      'Декомпозирована',
      'Выполнена',
    ]);
    const typeEnum = z.enum(['epic', 'task', 'subtask']);
    const idArray = z
      .array(z.number().int().positive())
      .describe('Список идентификаторов задач');
    const vectorMetadata = z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Необязательный объект метаданных');
    const addVectorSchema = z
      .object({
        content: z.string().min(1),
        metadata: vectorMetadata,
        id: z.string().min(1).optional(),
      })
      .describe('Добавить документ в векторное хранилище') as z.ZodTypeAny;
    const searchVectorSchema = z
      .object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(10).optional(),
      })
      .describe('Поиск похожих документов') as z.ZodTypeAny;
    const getVectorSchema = z
      .object({
        id: z.string().min(1),
      })
      .describe('Получить документ по id') as z.ZodTypeAny;
    const updateVectorSchema = z
      .object({
        id: z.string().min(1),
        content: z.string().min(1).optional(),
        metadata: vectorMetadata,
      })
      .describe(
        'Обновить содержимое и/или метаданные документа',
      ) as z.ZodTypeAny;
    const deleteVectorSchema = z
      .object({
        id: z.string().min(1),
      })
      .describe('Удалить документ по id') as z.ZodTypeAny;
    const listTasksSchema = z
      .object({
        status: statusEnum
          .optional()
          .describe('Необязательный фильтр по статусу'),
      })
      .describe('Параметры получения задач') as z.ZodTypeAny;
    const createTaskSchema = z
      .object({
        type: typeEnum,
        title: z.string().min(1),
        description: z.string().min(1),
        status: statusEnum.optional(),
        parentIds: idArray.optional(),
        childIds: idArray.optional(),
      })
      .describe('Параметры создания задачи') as z.ZodTypeAny;
    const updateTaskSchema = z
      .object({
        id: z.number().int().positive(),
        type: typeEnum.optional(),
        title: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        status: statusEnum.optional(),
        parentIds: idArray.optional(),
        childIds: idArray.optional(),
      })
      .describe('Параметры обновления задачи') as z.ZodTypeAny;
    const deleteTaskSchema = z
      .object({
        id: z.number().int().positive(),
      })
      .describe('Параметры удаления задачи') as z.ZodTypeAny;

    const tools: DynamicStructuredTool[] = [
      new DynamicStructuredTool<any>({
        name: 'list_tasks',
        description:
          'Список задач с кодами, статусами, типами и связями. Используй, чтобы понять текущие работы.',
        schema: listTasksSchema,
        func: async ({ status }) => {
          const tasks = await this.tasksService.list();
          const filtered = status
            ? tasks.filter((task) => task.status === status)
            : tasks;

          if (!filtered.length) {
            return 'Задач по фильтру не найдено.';
          }

          return filtered.map((task) => this.formatTask(task)).join('\n---\n');
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'create_task',
        description:
          'Создать задачу или эпик с необязательными связями родитель/потомок. Обязательно укажи название и описание.',
        schema: createTaskSchema,
        func: async ({
          type,
          title,
          description,
          status,
          parentIds,
          childIds,
        }) => {
          const created = await this.tasksService.create({
            type,
            title,
            description,
            status,
            parentIds,
            childIds,
          });
          return `Создана задача:\n${this.formatTask(created)}`;
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'update_task',
        description:
          'Обновить поля или связи существующей задачи. Передай id и только те поля, что нужно изменить.',
        schema: updateTaskSchema,
        func: async ({ id, ...payload }) => {
          const updated = await this.tasksService.update(id, payload);
          return `Обновлена задача ${id}:\n${this.formatTask(updated)}`;
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'delete_task',
        description:
          'Удалить задачу по id. Используй после подтверждения, что её нужно убрать.',
        schema: deleteTaskSchema,
        func: async ({ id }) => {
          await this.tasksService.delete(id);
          return `Удалена задача ${id}`;
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'vector_add_document',
        description:
          'Добавить документ в векторное хранилище Chroma. Передай текст и при необходимости метаданные/id.',
        schema: addVectorSchema,
        func: async ({ content, metadata, id }) => {
          const result = await this.vectorStoreService.addDocument({
            content,
            metadata,
            id,
          });
          return `Добавлен векторный документ с id ${result.id}`;
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'vector_search',
        description:
          'Поиск похожих документов в векторном хранилище. Передай запрос и необязательный лимит (1-10).',
        schema: searchVectorSchema,
        func: async ({ query, limit }) => {
          const results = await this.vectorStoreService.similaritySearch(
            query,
            limit ?? 3,
          );
          if (!results.length) return 'Похожие документы не найдены.';
          return JSON.stringify(results, null, 2);
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'vector_get',
        description: 'Получить документ из векторного хранилища по id.',
        schema: getVectorSchema,
        func: async ({ id }) => {
          const doc = await this.vectorStoreService.getDocument(id);
          if (!doc) return `Документ ${id} не найден.`;
          return JSON.stringify(doc, null, 2);
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'vector_update',
        description:
          'Обновить содержимое и/или метаданные документа в векторном хранилище. Передай id и поля для изменения.',
        schema: updateVectorSchema,
        func: async ({ id, content, metadata }) => {
          const result = await this.vectorStoreService.updateDocument({
            id,
            content,
            metadata,
          });
          return `Обновлён векторный документ ${result.id}`;
        },
      }) as unknown as DynamicStructuredTool,
      new DynamicStructuredTool<any>({
        name: 'vector_delete',
        description: 'Удалить документ из векторного хранилища по id.',
        schema: deleteVectorSchema,
        func: async ({ id }) => {
          await this.vectorStoreService.deleteDocument(id);
          return `Удалён векторный документ ${id}`;
        },
      }) as unknown as DynamicStructuredTool,
    ];

    return tools;
  }

  private formatTask(task: Task): string {
    const parents = task.parents.map((item) => `${item.code} (${item.title})`);
    const children = task.children.map(
      (item) => `${item.code} (${item.title})`,
    );

    const lines = [
      `${task.code} [${task.type}] (${task.status})`,
      `Название: ${task.title}`,
      `Описание: ${task.description}`,
      `Создано: ${task.createdAt}`,
    ];

    if (parents.length) {
      lines.push(`Родители: ${parents.join(', ')}`);
    }
    if (children.length) {
      lines.push(`Дети: ${children.join(', ')}`);
    }

    return lines.join('\n');
  }

  private async loadRecentHistory(): Promise<BaseMessage[]> {
    try {
      const recent = await this.databaseService.getRecentMessages(10);
      const history: BaseMessage[] = [];
      recent.forEach((item) => {
        history.push(new HumanMessage(item.userText));
        history.push(new AIMessage(item.botReply));
      });
      return history;
    } catch (err) {
      this.logger.warn(
        `Could not load recent messages for context: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
