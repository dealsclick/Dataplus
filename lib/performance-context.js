"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

const requestPerformanceStorage = new AsyncLocalStorage();

function createRequestPerformanceContext(initial = {}) {
  return {
    ...initial,
    databaseMs: 0,
    databaseQueries: 0,
    databaseRows: 0
  };
}

function enterRequestPerformanceContext(context) {
  requestPerformanceStorage.enterWith(context);
  return context;
}

function recordDatabaseQuery(durationMs = 0, rowCount = 0) {
  const context = requestPerformanceStorage.getStore();
  if (!context) return;
  const duration = Number(durationMs || 0);
  const rows = Number(rowCount || 0);
  if (Number.isFinite(duration) && duration >= 0) context.databaseMs += duration;
  if (Number.isFinite(rows) && rows >= 0) context.databaseRows += rows;
  context.databaseQueries += 1;
}

module.exports = {
  createRequestPerformanceContext,
  enterRequestPerformanceContext,
  recordDatabaseQuery
};
