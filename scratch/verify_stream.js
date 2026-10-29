require('dotenv').config({ path: '.env' });
const { streamSqlServerRows, querySqlServer, getSqlServerPool } = require('../src/config/sqlserver');

const Q = `SELECT TOP 600000 a.object_id AS id, a.name AS name, REPLICATE('x', 200) AS pad FROM sys.all_objects a CROSS JOIN sys.all_columns b`;
const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);

async function main() {
  // 1. Streaming: hitung baris + peak memori, dengan consumer lambat
  let n = 0, peak = 0, batches = 0, maxBatch = 0;
  global.gc && global.gc();
  const base = mb();
  await streamSqlServerRows(Q, 2000, async (b) => {
    n += b.length; batches++; maxBatch = Math.max(maxBatch, b.length);
    peak = Math.max(peak, mb());
    await new Promise(r => setTimeout(r, 1));
  });
  console.log(`[stream] rows=${n} batches=${batches} maxBatch=${maxBatch} heap base=${base}MB peak=${peak}MB`);

  // 2. Bandingkan dengan recordset penuh
  global.gc && global.gc();
  const r = await querySqlServer(Q);
  console.log(`[full recordset] rows=${r.recordset.length} heap=${mb()}MB`);
  r.recordset.length = 0;

  // 3. Error di consumer -> reject, pool tetap sehat
  let thrown = null;
  try {
    await streamSqlServerRows(Q, 1000, async () => { throw new Error('boom-consumer'); });
  } catch (e) { thrown = e.message; }
  console.log(`[consumer error] rejected=${thrown}`);
  const ok = await querySqlServer('SELECT 1 AS x');
  console.log(`[pool setelah error] query ok=${ok.recordset[0].x === 1}`);

  // 4. Error query (kolom tidak ada)
  thrown = null;
  try { await streamSqlServerRows('SELECT nope FROM sys.all_objects', 100, async () => {}); } catch (e) { thrown = e.message; }
  console.log(`[query error] rejected=${thrown}`);

  // 5. Hasil kosong
  let cnt = 0;
  await streamSqlServerRows('SELECT 1 AS x WHERE 1=0', 100, async (b) => { cnt += b.length; });
  console.log(`[empty] rows=${cnt}`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
