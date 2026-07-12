/**
 * Goal Repository
 * 
 * 目标数据访问层
 */

import { BaseRepository } from './base.repository.mjs';

export class GoalRepository extends BaseRepository {
  constructor(db) {
    super(db, 'goals');
  }

  /**
   * 按状态查找目标
   */
  async findByStatus(userId, status) {
    return this.db.queryAll(
      `SELECT * FROM goals 
       WHERE user_id = $1 AND status = $2 
       ORDER BY created_at DESC`,
      [userId, status]
    );
  }

  /**
   * 按生命之花维度查找
   */
  async findByDimension(userId, dimension) {
    return this.db.queryAll(
      `SELECT * FROM goals 
       WHERE user_id = $1 AND life_wheel_dimension = $2 
       ORDER BY status, created_at DESC`,
      [userId, dimension]
    );
  }

  /**
   * 获取生命之花维度分布
   */
  async getDimensionDistribution(userId) {
    return this.db.queryAll(
      `SELECT 
        life_wheel_dimension as dimension,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
       FROM goals 
       WHERE user_id = $1 
       GROUP BY life_wheel_dimension`,
      [userId]
    );
  }

  /**
   * 更新目标状态
   */
  async updateStatus(id, status) {
    const progress = status === 'completed' ? 100 : undefined;
    
    let sql = `UPDATE goals SET status = $2, updated_at = NOW()`;
    const params = [id, status];
    
    if (progress !== undefined) {
      sql += `, progress = $3`;
      params.push(progress);
    }
    
    sql += ` WHERE id = $1 RETURNING *`;
    
    return this.db.query(sql, params);
  }

  /**
   * 更新进度
   */
  async updateProgress(id, progress) {
    return this.db.query(
      `UPDATE goals 
       SET progress = $2, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id, progress]
    );
  }

  /**
   * 获取目标及其任务
   */
  async findWithTasks(goalId) {
    const goal = await this.findById(goalId);
    if (!goal) return null;

    const tasks = await this.db.queryAll(
      `SELECT t.* FROM tasks t
       JOIN plan_nodes pn ON t.plan_node_id = pn.id
       WHERE pn.goal_id = $1
       ORDER BY t.scheduled_date, t.priority DESC`,
      [goalId]
    );

    return { ...goal, tasks };
  }

  /**
   * 获取活跃目标统计
   */
  async getActiveStats(userId) {
    const result = await this.db.query(
      `SELECT 
        COUNT(*) as total_active,
        AVG(progress) as avg_progress,
        COUNT(*) FILTER (WHERE progress >= 80) as near_complete
       FROM goals 
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    
    return {
      totalActive: parseInt(result?.total_active || '0'),
      avgProgress: parseFloat(result?.avg_progress || '0'),
      nearComplete: parseInt(result?.near_complete || '0'),
    };
  }
}

export default GoalRepository;

















