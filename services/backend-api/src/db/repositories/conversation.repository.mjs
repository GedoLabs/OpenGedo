/**
 * Conversation Repository
 * 
 * Manages conversations and messages for the chat system
 */

import { BaseRepository } from './base.repository.mjs';

export class ConversationRepository extends BaseRepository {
  constructor(db) {
    super(db, 'conversations');
  }

  /**
   * Create a new conversation
   */
  async createConversation(userId, title = '新对话') {
    return this.db.query(
      `INSERT INTO conversations (user_id, title) 
       VALUES ($1, $2) 
       RETURNING *`,
      [userId, title]
    );
  }

  /**
   * Get user's conversations, ordered by most recent
   */
  async listByUser(userId, { limit = 20, offset = 0 } = {}) {
    return this.db.queryAll(
      `SELECT c.*, 
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM conversations c
       WHERE c.user_id = $1
       ORDER BY c.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  }

  /**
   * Get a conversation with its messages
   */
  async getWithMessages(conversationId, userId, { limit = 50, before = null } = {}) {
    const conversation = await this.db.query(
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    );

    if (!conversation) return null;

    let messagesQuery = `SELECT * FROM messages WHERE conversation_id = $1`;
    const params = [conversationId];

    if (before) {
      messagesQuery += ` AND created_at < $${params.length + 1}`;
      params.push(before);
    }

    messagesQuery += ` ORDER BY created_at ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const messages = await this.db.queryAll(messagesQuery, params);

    return { ...conversation, messages };
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(conversationId, { role, content, toolCalls, toolCallId, toolResult, metadata }) {
    const message = await this.db.query(
      `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id, tool_result, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        conversationId,
        role,
        content,
        toolCalls ? JSON.stringify(toolCalls) : null,
        toolCallId || null,
        toolResult ? JSON.stringify(toolResult) : null,
        metadata ? JSON.stringify(metadata) : '{}',
      ]
    );

    // Update conversation stats
    await this.db.query(
      `UPDATE conversations 
       SET message_count = message_count + 1, 
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    return message;
  }

  /**
   * Get recent messages for context (used by agent router)
   */
  async getRecentMessages(conversationId, limit = 20) {
    return this.db.queryAll(
      `SELECT * FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [conversationId, limit]
    );
  }

  /**
   * Update conversation title
   */
  async updateTitle(conversationId, userId, title) {
    return this.db.query(
      `UPDATE conversations 
       SET title = $3, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [conversationId, userId, title]
    );
  }

  /**
   * Delete a conversation and its messages
   */
  async deleteConversation(conversationId, userId) {
    const result = await this.db.query(
      `DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
      [conversationId, userId]
    );
    return result !== null;
  }
}

export default ConversationRepository;
