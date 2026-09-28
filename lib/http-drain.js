function installHttpDrain(server, { timeoutMs = 55000, signals = process, exit = code => process.exit(code), log = console.log } = {}) {
  let draining = false;
  const drain = () => {
    if (draining) return;
    draining = true;
    log('Web shutdown: draining in-flight HTTP requests.');
    const timer = setTimeout(() => { server.closeAllConnections?.(); exit(1); }, timeoutMs);
    timer.unref?.();
    server.close(() => { clearTimeout(timer); log('Web shutdown: HTTP drain complete.'); exit(0); });
    server.closeIdleConnections?.();
  };
  signals.once('SIGTERM', drain);
  signals.once('SIGINT', drain);
  return drain;
}
module.exports = { installHttpDrain };
