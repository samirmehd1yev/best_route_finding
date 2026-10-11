import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("SQLite statements survive asynchronous garbage collection and database shutdown", () => {
  const result = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=128", "-e", `
    const Database = require('better-sqlite3');
    const db = new Database('data/ayna.sqlite', { readonly: true, fileMustExist: true });
    (async () => {
      for (let i = 0; i < 12; i++) {
        const rows = db.prepare('SELECT latitude, longitude FROM route_coordinates').all();
        if (rows.length === 0) throw new Error('Missing route geometry');
        await new Promise(resolve => setImmediate(resolve));
        global.gc();
      }
      db.close();
      await new Promise(resolve => setImmediate(resolve));
      global.gc();
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});
