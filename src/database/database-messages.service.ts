import { Injectable } from '@nestjs/common';
import { DatabaseCoreService } from './database.core.service';

@Injectable()
export class DatabaseMessagesService {
  constructor(private readonly db: DatabaseCoreService) {}

  async saveMessage(
    userText: string,
    botReply: string,
  ): Promise<{
    id: number;
    userText: string;
    botReply: string;
    createdAt: string;
  }> {
    await this.db.run(
      'INSERT INTO messages (user_text, bot_reply) VALUES (?, ?)',
      [userText, botReply],
    );

    const row = await this.db.get<{
      id: number;
      user_text: string;
      bot_reply: string;
      created_at: string;
    }>(
      'SELECT id, user_text, bot_reply, created_at FROM messages WHERE id = last_insert_rowid()',
    );

    if (!row) {
      throw new Error('Не удалось сохранить сообщение');
    }

    return {
      id: row.id,
      userText: row.user_text,
      botReply: row.bot_reply,
      createdAt: row.created_at,
    };
  }

  async getRecentMessages(limit = 10): Promise<
    {
      id: number;
      userText: string;
      botReply: string;
      createdAt: string;
    }[]
  > {
    const rows = await this.db.all<{
      id: number;
      user_text: string;
      bot_reply: string;
      created_at: string;
    }>(
      'SELECT id, user_text, bot_reply, created_at FROM messages ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows
      .map((row) => ({
        id: row.id,
        userText: row.user_text,
        botReply: row.bot_reply,
        createdAt: row.created_at,
      }))
      .reverse();
  }

  async clearMessages(): Promise<void> {
    await this.db.run('DELETE FROM messages');
  }
}
