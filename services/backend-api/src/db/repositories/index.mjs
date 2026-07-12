/**
 * Repository 导出
 */

export { BaseRepository } from './base.repository.mjs';
export { MemoryRepository } from './memory.repository.mjs';
export { GoalRepository } from './goal.repository.mjs';
export { TaskRepository } from './task.repository.mjs';

// 工厂函数
import { db } from '../connection.mjs';
import { MemoryRepository } from './memory.repository.mjs';
import { GoalRepository } from './goal.repository.mjs';
import { TaskRepository } from './task.repository.mjs';

let repositories = null;

export function getRepositories() {
  if (!repositories) {
    repositories = {
      memory: new MemoryRepository(db),
      goal: new GoalRepository(db),
      task: new TaskRepository(db),
    };
  }
  return repositories;
}

export default { getRepositories };

















