/**
 * Memory Repository
 * 
 * 记忆数据访问层，支持向量检索
 */

import { BaseRepository } from './base.repository.mjs';

export class MemoryRepository extends BaseRepository {
  constructor(db) {
    super(db, 'memories');
  }

  /**
   * 创建记忆（包含向量）
   */
  async create(data) {
    const {
      user_id,
      type,
      content_raw,
      content_struct,
      source,
      system_tags,
      user_tags,
      embedding,
      confidence,
      reminder_date,
      attachment_url,
    } = data;

    return this.db.query(
      `INSERT INTO memories (
        user_id, type, content_raw, content_struct, source,
        system_tags, user_tags, embedding, confidence,
        reminder_date, attachment_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10, $11)
      RETURNING *`,
      [
        user_id,
        type,
        content_raw,
        JSON.stringify(content_struct || {}),
        source || 'text',
        system_tags || [],
        user_tags || [],
        embedding ? `[${embedding.join(',')}]` : null,
        confidence || 1.0,
        reminder_date,
        attachment_url,
      ]
    );
  }

  /**
   * 文本搜索
   */
  async searchByText(userId, query, options = {}) {
    const { type, tags, limit = 20 } = options;
    
    let sql = `
      SELECT * FROM memories 
      WHERE user_id = $1 
        AND content_raw ILIKE $2
    `;
    const params = [userId, `%${query}%`];
    let paramIndex = 3;

    if (type) {
      sql += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (tags && tags.length > 0) {
      sql += ` AND (system_tags && $${paramIndex} OR user_tags && $${paramIndex})`;
      params.push(tags);
      paramIndex++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    return this.db.queryAll(sql, params);
  }

  /**
   * 向量相似度搜索
   */
  async searchByVector(userId, embedding, options = {}) {
    const { type, tags, limit = 20, threshold = 0.5 } = options;
    
    let sql = `
      SELECT 
        *,
        1 - (embedding <=> $2::vector) as similarity
      FROM memories 
      WHERE user_id = $1 
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> $2::vector) > $3
    `;
    const params = [userId, `[${embedding.join(',')}]`, threshold];
    let paramIndex = 4;

    if (type) {
      sql += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (tags && tags.length > 0) {
      sql += ` AND (system_tags && $${paramIndex} OR user_tags && $${paramIndex})`;
      params.push(tags);
      paramIndex++;
    }

    sql += ` ORDER BY similarity DESC LIMIT $${paramIndex}`;
    params.push(limit);

    return this.db.queryAll(sql, params);
  }

  /**
   * 混合搜索（文本 + 向量）
   */
  async hybridSearch(userId, query, embedding, options = {}) {
    const { type, tags, limit = 20 } = options;
    
    let sql = `
      SELECT 
        *,
        CASE 
          WHEN embedding IS NOT NULL 
          THEN 1 - (embedding <=> $3::vector) 
          ELSE 0 
        END as vector_score,
        CASE 
          WHEN content_raw ILIKE $2 
          THEN 1.0 
          ELSE 0 
        END as text_score
      FROM memories 
      WHERE user_id = $1 
        AND (
          content_raw ILIKE $2 
          OR (embedding IS NOT NULL AND 1 - (embedding <=> $3::vector) > 0.5)
        )
    `;
    const params = [userId, `%${query}%`, `[${embedding.join(',')}]`];
    let paramIndex = 4;

    if (type) {
      sql += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (tags && tags.length > 0) {
      sql += ` AND (system_tags && $${paramIndex} OR user_tags && $${paramIndex})`;
      params.push(tags);
      paramIndex++;
    }

    // 综合排序：关键记忆优先，然后按向量分数
    sql += `
      ORDER BY 
        CASE WHEN type IN ('personal_trait', 'key_event', 'date_reminder') THEN 0 ELSE 1 END,
        (vector_score + text_score) DESC,
        impact_score DESC,
        created_at DESC
      LIMIT $${paramIndex}
    `;
    params.push(limit);

    return this.db.queryAll(sql, params);
  }

  /**
   * 查找即将到来的日期提醒
   */
  async findUpcomingReminders(userId, daysAhead = 7) {
    const today = new Date().toISOString().split('T')[0];
    const future = new Date();
    future.setDate(future.getDate() + daysAhead);
    const futureDate = future.toISOString().split('T')[0];

    return this.db.queryAll(
      `SELECT * FROM memories 
       WHERE user_id = $1 
         AND type = 'date_reminder'
         AND reminder_date >= $2
         AND reminder_date <= $3
       ORDER BY reminder_date ASC`,
      [userId, today, futureDate]
    );
  }

  /**
   * 根据类型统计
   */
  async countByType(userId) {
    return this.db.queryAll(
      `SELECT type, COUNT(*) as count 
       FROM memories 
       WHERE user_id = $1 
       GROUP BY type`,
      [userId]
    );
  }

  /**
   * 更新使用次数
   */
  async incrementUsage(id) {
    return this.db.query(
      `UPDATE memories 
       SET usage_count = usage_count + 1, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
  }
}

export default MemoryRepository;

















