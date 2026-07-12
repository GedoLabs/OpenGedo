/**
 * 基础 Repository 类
 * 
 * 提供通用的 CRUD 操作
 */

export class BaseRepository {
  constructor(db, tableName) {
    this.db = db;
    this.tableName = tableName;
  }

  /**
   * 根据 ID 查找
   */
  async findById(id) {
    return this.db.query(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
  }

  /**
   * 根据用户 ID 查找所有
   */
  async findByUserId(userId, options = {}) {
    const { limit = 100, offset = 0, orderBy = 'created_at DESC' } = options;
    return this.db.queryAll(
      `SELECT * FROM ${this.tableName} 
       WHERE user_id = $1 
       ORDER BY ${orderBy} 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  }

  /**
   * 创建记录
   */
  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    return this.db.query(
      `INSERT INTO ${this.tableName} (${keys.join(', ')}) 
       VALUES (${placeholders}) 
       RETURNING *`,
      values
    );
  }

  /**
   * 更新记录
   */
  async update(id, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    
    return this.db.query(
      `UPDATE ${this.tableName} 
       SET ${setClause}, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id, ...values]
    );
  }

  /**
   * 删除记录
   */
  async delete(id) {
    const result = await this.db.query(
      `DELETE FROM ${this.tableName} WHERE id = $1 RETURNING id`,
      [id]
    );
    return result !== null;
  }

  /**
   * 统计数量
   */
  async count(userId) {
    const result = await this.db.query(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE user_id = $1`,
      [userId]
    );
    return parseInt(result?.count || '0');
  }
}

export default BaseRepository;

















