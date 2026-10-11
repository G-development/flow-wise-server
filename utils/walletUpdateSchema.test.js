import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";

import { validate } from "./validate.js";
import { walletUpdateSchema } from "./schemas.js";

/**
 * Contratto sotto test: `PUT /wallet/:id` accetta il saldo di APERTURA
 * (`opening_balance_cents`: intero in centesimi, segno ammesso — è il punto di
 * partenza della somma derivata, non il saldo finale), non `balance`, che resta
 * derivato dalle transazioni.
 *
 * La prova passa da Express e dal middleware `validate` reali: il vincolo deve
 * valere sul percorso HTTP, non solo chiamando lo schema a mano.
 */

const withServer = async (run) => {
  const app = express();
  app.use(express.json());
  app.put("/wallet/:id", validate(walletUpdateSchema), (req, res) =>
    res.status(200).json(req.body)
  );

  const server = app.listen(0);
  await once(server, "listening");

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
};

const put = (base, body) =>
  fetch(`${base}/wallet/1`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("accetta un'apertura in centesimi interi e la conserva", async () => {
  await withServer(async (base) => {
    const response = await put(base, { opening_balance_cents: 215000 });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).opening_balance_cents, 215000);
  });
});

test("accetta un'apertura negativa: un wallet può nascere in debito", async () => {
  await withServer(async (base) => {
    const response = await put(base, { opening_balance_cents: -100000 });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).opening_balance_cents, -100000);
  });
});

test("rifiuta un'apertura non intera, indicando il campo", async () => {
  await withServer(async (base) => {
    const response = await put(base, { opening_balance_cents: 12.5 });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, "Validation error");
    assert.equal(payload.details[0].path, "opening_balance_cents");
    assert.match(payload.details[0].message, /integer/);
  });
});

test("rifiuta una stringa al posto di un numero", async () => {
  await withServer(async (base) => {
    const response = await put(base, { opening_balance_cents: "100" });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.details[0].path, "opening_balance_cents");
    assert.match(payload.details[0].message, /must be a number/);
  });
});

test("`balance` resta fuori dallo schema: viene scartato, non scritto", async () => {
  await withServer(async (base) => {
    const response = await put(base, {
      name: "Conto",
      balance: 999999,
      opening_balance_cents: 100,
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.balance, undefined);
    assert.equal(payload.name, "Conto");
    assert.equal(payload.opening_balance_cents, 100);
  });
});

test("name e is_default continuano a valere come prima", async () => {
  await withServer(async (base) => {
    const response = await put(base, { name: "Conto", is_default: true });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: "Conto", is_default: true });
  });
});
