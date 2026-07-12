/**
 * Task Repository
 * 
 * 任务数据访问层
 */

import { BaseRepository } from './base.repository.mjs';

export class TaskRepository extends BaseRepository {
  constructor(db) {
    super(db, 'tasks');
  }

  /**
   * 获取今日任务
   */
  async findTodayTasks(userId) {
    const today = new Date().toISOString().split('T')[0];
    
    return this.db.queryAll(
      `SELECT t.*, g.title as goal_title
       FROM tasks t
       LEFT JOIN plan_nodes pn ON t.plan_node_id = pn.id
       LEFT JOIN goals g ON pn.goal_id = g.id
       WHERE t.user_id = $1 
         AND t.scheduled_date = $2
       ORDER BY 
         CASE t.status 
           WHEN 'in_progress' THEN 0 
           WHEN 'todo' THEN 1 
           WHEN 'completed' THEN 2 
           ELSE 3 
         END,
         t.priority DESC`,
      [userId, today]
    );
  }

  /**
   * 获取待办任务（不限日期）
   */
  async findPendingTasks(userId, limit = 20) {
    return this.db.queryAll(
      `SELECT t.*, g.title as goal_title
       FROM tasks t
       LEFT JOIN plan_nodes pn ON t.plan_node_id = pn.id
       LEFT JOIN goals g ON pn.goal_id = g.id
       WHERE t.user_id = $1 
         AND t.status IN ('todo', 'in_progress')
       ORDER BY t.scheduled_date ASC NULLS LAST, t.priority DESC
       LIMIT $2`,
      [userId, limit]
    );
  }

  /**
   * 更新任务状态
   */
  async updateStatus(id, status, actualDuration = null) {
    let sql = `UPDATE tasks SET status = $2, updated_at = NOW()`;
    const params = [id, status];
    let paramIndex = 3;

    if (status === 'completed') {
      sql += `, completed_at = NOW()`;
    }

    if (actualDuration !== null) {
      sql += `, actual_duration = $${paramIndex}`;
      params.push(actualDuration);
      paramIndex++;
    }

    sql += ` WHERE id = $1 RETURNING *`;

    return this.db.query(sql, params);
  }

  /**
   * 顺延任务
   */
  async postpone(id, newDate) {
    return this.db.query(
      `UPDATE tasks 
       SET scheduled_date = $2, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id, newDate]
    );
  }

  /**
   * 获取任务完成统计
   */
  async getCompletionStats(userId, days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.db.queryAll(
      `SELECT 
        DATE(completed_at) as date,
        COUNT(*) as completed_count,
        SUM(actual_duration) as total_duration
       FROM tasks 
       WHERE user_id = $1 
         AND status = 'completed'
         AND completed_at >= $2
       GROUP BY DATE(completed_at)
       ORDER BY date DESC`,
      [userId, since.toISOString()]
    );
  }

  /**
   * 按精力水平分组
   */
  async groupByEnergyLevel(userId) {
    return this.db.queryAll(
      `SELECT 
        energy_level,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
       FROM tasks 
       WHERE user_id = $1
       GROUP BY energy_level`,
      [userId]
    );
  }
}

export default TaskRepository;

















