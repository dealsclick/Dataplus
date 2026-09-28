// Count work outlives an HTTP request, but never outlives its bounded DB query.
function createCatalogCountJobs({ concurrency = 1, capacity = 50, ttlMs = 60000, now = Date.now } = {}) {
  const jobs = new Map();
  const queue = [];
  let active = 0;
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      job.status = 'running';
      Promise.resolve().then(job.run).then(result => {
        if (!result?.totalKnown) throw new Error('Count query timed out');
        job.result = result;
        job.status = 'complete';
      }).catch(() => { job.status = 'failed'; }).finally(() => {
        job.finishedAt = now();
        job.run = null;
        active--;
        drain();
      });
    }
  }
  function request(key, run, { retry = false } = {}) {
    for (const [id, job] of jobs) if (job.finishedAt != null && now() - job.finishedAt > ttlMs) jobs.delete(id);
    let job = jobs.get(key);
    if (retry && job?.status === 'failed') { jobs.delete(key); job = null; }
    if (!job) {
      if (jobs.size >= capacity) return { totalKnown: false, countStatus: 'busy', retryAfterMs: 5000 };
      job = { status: 'queued', run };
      jobs.set(key, job);
      queue.push(job);
      drain();
    }
    if (job.status === 'complete') return { ...job.result, countStatus: 'complete' };
    return { totalKnown: false, countStatus: job.status, retryAfterMs: 2000 };
  }
  return { request };
}
module.exports = { createCatalogCountJobs };
