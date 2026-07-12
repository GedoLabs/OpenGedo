/**
 * PostgreSQL 数据库连接
 * 
 * 使用 pg 库进行连接池管理
 */

import pg from 'pg';

const { Pool } = pg;

// 数据库配置
const config = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'gedoai',
  user: process.env.POSTGRES_USER || 'gedo',
  password: process.env.POSTGRES_PASSWORD || 'gedo_dev_password',
  // 连接池配置
  max: parseInt(process.env.POSTGRES_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// 创建连接池
let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool(config);
    
    // 连接错误处理
    pool.on('error', (err) => {
      console.error('[DB] Unexpected error on idle client', err);
    });
    
    // 连接成功日志
    pool.on('connect', () => {
      console.log('[DB] New client connected to PostgreSQL');
    });
  }
  return pool;
}

/**
 * 数据库操作封装
 */
export class Database {
  constructor() {
    this.pool = getPool();
  }

  /**
   * 执行单条查询，返回第一行
   */
  async query(sql, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * 执行查询，返回所有行
   */
  async queryAll(sql, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * 执行事务
   */
  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const result = await this.query('SELECT NOW() as now');
      return { ok: true, time: result?.now };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * 关闭连接池
   */
  async close() {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }
}

// 导出单例
export const db = new Database();

export default { getPool, Database, db };

















