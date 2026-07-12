/**
 * Load services/backend-api/.env before LLM router initialization.
 *
 * Node's --env-file does not override already-set env vars; shells (and some
 * cloud previews) often inject ANTHROPIC_API_KEY="" which blocks .env values.
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.join(process.cwd(), '.env');

const API_KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

/** Treat shell-injected empty strings as unset so .env can supply the real value. */
function clearEmptyApiKeySlots() {
  for (const key of API_KEY_VARS) {
    const v = process.env[key];
    if (v !== undefined && String(v).trim() === '') {
      delete process.env[key];
    }
  }
}

function parseEnvFile(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function loadEnvFile() {
  clearEmptyApiKeySlots();

  if (!fs.existsSync(ENV_PATH)) {
    return { loaded: false, path: ENV_PATH };
  }

  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(ENV_PATH);
    } else {
      parseEnvFile(fs.readFileSync(ENV_PATH, 'utf8'));
    }
    clearEmptyApiKeySlots();
    console.log(`[backend-api] Loaded .env from ${ENV_PATH}`);
    return { loaded: true, path: ENV_PATH };
  } catch (err) {
    console.warn('[backend-api] Failed to load .env:', err.message);
    return { loaded: false, path: ENV_PATH, error: err.message };
  }
}

loadEnvFile();
