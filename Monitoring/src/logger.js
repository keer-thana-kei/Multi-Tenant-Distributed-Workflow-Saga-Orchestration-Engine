const fs = require('fs');
const path = require('path');

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

function sanitize(value) {
  if (typeof value === 'string') {
    // Redact sensitive patterns
    return value
      .replace(/mongodb\+srv:\/\/[^@]+@/gi, '[REDACTED_MONGODB]')
      .replace(/:[^:@\/]{8,}@/gi, ':[REDACTED_PASSWORD]@')
      .replace(/JWT_SECRET/gi, '[REDACTED]')
      .replace(/MONITORING_API_KEY/gi, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const k in value) copy[k] = sanitize(value[k]);
    return copy;
  }
  return value;
}

function log(level, msg, meta = {}) {
  if (!LOG_LEVELS.includes(level)) level = 'info';
  const entry = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...sanitize(meta),
  };
  // Write JSON line to stdout (Docker captures it)
  process.stdout.write(JSON.stringify(entry) + '\n');
}

module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};
