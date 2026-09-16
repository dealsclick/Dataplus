const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { installHttpDrain } = require('../lib/http-drain');
(async () => {
  const signals = new EventEmitter(); let finish;
  const started = new Promise(resolve => { finish = resolve; });
  const server = http.createServer((req, res) => { finish(); setTimeout(() => res.end('saved'), 50); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let exits = 0;
  const closed = new Promise(resolve => installHttpDrain(server, {signals, log:()=>{}, exit: code => { exits++; assert.equal(code,0); resolve(); }}));
  const response = new Promise((resolve,reject) => http.get(`http://127.0.0.1:${server.address().port}`, res => {
    let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(body));
  }).on('error',reject));
  await started; signals.emit('SIGTERM'); signals.emit('SIGINT');
  assert.equal(await response,'saved'); await closed; assert.equal(exits,1);
  console.log('PASS HTTP shutdown preserves active response and ignores repeated shutdown');
})().catch(error => { console.error(error); process.exitCode = 1; });
