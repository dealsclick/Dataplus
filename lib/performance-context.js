"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

const requestPerformanceStorage = new AsyncLocalStorage();

function createRequestPerformanceContext(initial = {}) {
  return {
    ...initial,
    databaseMs: 0,
    databaseQueries: 0,
    databaseRows: 0,
    databaseSlowQueries: []
  };
}

function enterRequestPerformanceContext(context) {
  requestPerformanceStorage.enterWith(context);
  return context;
}

function recordDatabaseQuery(durationMs = 0, rowCount = 0, fingerprint = "") {
  const context = requestPerformanceStorage.getStore();
  if (!context) return;
  const duration = Number(durationMs || 0);
  const rows = Number(rowCount || 0);
  if (Number.isFinite(duration) && duration >= 0) context.databaseMs += duration;
  if (Number.isFinite(rows) && rows >= 0) context.databaseRows += rows;
  context.databaseQueries += 1;
  if (Number.isFinite(duration) && duration >= 250 && fingerprint) {
    const slowQueries = Array.isArray(context.databaseSlowQueries) ? context.databaseSlowQueries : [];
    slowQueries.push({ fingerprint: String(fingerprint).slice(0, 160), durationMs: Math.round(duration * 100) / 100, rows });
    slowQueries.sort((left, right) => right.durationMs - left.durationMs);
    context.databaseSlowQueries = slowQueries.slice(0, 8);
  }
}

module.exports = {
  createRequestPerformanceContext,
  enterRequestPerformanceContext,
  recordDatabaseQuery
};
