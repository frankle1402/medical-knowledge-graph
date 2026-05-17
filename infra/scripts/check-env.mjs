// infra/scripts/check-env.mjs
import net from 'node:net';
import 'dotenv/config';

const checks = [
  { name: 'PostgreSQL', host: 'localhost', port: 5432 },
  { name: 'Neo4j Bolt', host: 'localhost', port: 7687 },
];

function probe({ host, port }) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    sock.setTimeout(1500);
    sock.once('connect', () => {
      sock.end();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
  });
}

let ok = true;
for (const c of checks) {
  const up = await probe(c);
  console.log(`${up ? '✅' : '❌'} ${c.name} (${c.host}:${c.port})`);
  if (!up) ok = false;
}
if (!ok) {
  console.error('\n请先按 infra/SETUP.md 安装并启动本地依赖。');
  process.exit(1);
}
