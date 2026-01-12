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
import { Task, TasksService } from '../tasks/tasks.service';
import { DatabaseMessagesService } from '../database/database-messages.service';
import { VectorStoreService } from './vector-store.service';
import { buildTaskTools } from './agent-tools';

@Injectable()
export class LangchainService {
  private readonly logger = new Logger(LangchainService.name);

  private readonly model: ChatOpenAI;

  private readonly echoChain: RunnableSequence<{ input: string }, string>;

  private readonly taskTools: DynamicStructuredTool[];

  constructor(
    private readonly tasksService: TasksService,
    private readonly databaseService: DatabaseMessagesService,
    private readonly vectorStoreService: VectorStoreService,
  ) {
    const apiKey = process.env.LLM_API_TOKEN;
    if (!apiKey) {
      throw new Error('LLM_API_TOKEN не задан');
    }

    this.model = new ChatOpenAI({
      apiKey,
      model: process.env.LLM_MODEL ?? 'gpt-4.1',
      temperature: 0.2,
    });

    this.echoChain = RunnableSequence.from([
      PromptTemplate.fromTemplate('Эхо от LangChain: {input}'),
      this.model,
      new StringOutputParser(),
    ]);

    this.taskTools = buildTaskTools({
      tasksService: this.tasksService,
      vectorStoreService: this.vectorStoreService,
      formatTask: (task) => this.formatTask(task),
    });
  }

  async generateEcho(input: string): Promise<string> {
    this.logger.debug('Отправка запроса в OpenAI');
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
              content: `Инструмент ${call.name} недоступен`,
              tool_call_id: toolCallId,
            }),
          );
          continue;
        }

        try {
          const rawResult: unknown = await tool.invoke(
            call.args as Record<string, unknown>,
          );
          const content =
            typeof rawResult === 'string'
              ? rawResult
              : JSON.stringify(rawResult);
          messages.push(
            new ToolMessage({
              content,
              tool_call_id: toolCallId,
            }),
          );
        } catch (err) {
          messages.push(
            new ToolMessage({
              content: `Ошибка инструмента: ${(err as Error).message}`,
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
        `Не удалось загрузить недавние сообщения для контекста: ${
          (err as Error).message
        }`,
      );
      return [];
    }
  }
}
