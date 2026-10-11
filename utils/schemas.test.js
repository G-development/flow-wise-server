import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";

import { validate } from "./validate.js";
import {
  transactionCreateSchema,
  transactionUpdateSchema,
} from "./schemas.js";

/**
 * Contratto sotto test: `amount` è sempre >= 0, il segno lo decide `type`
 * ("I" entrata / "E" spesa). Lo zero è ammesso: la convenzione vieta i negativi,
 * non l'importo nullo (l'import CSV deriva il tipo da `>= 0`).
 *
 * La prova passa da Express e dal middleware `validate` reali: il vincolo deve
 * valere sul percorso HTTP, non solo chiamando lo schema a mano.
 */

const validBody = () => ({
  description: "Spesa di prova",
  amount: 50,
  date: "2026-10-11",
  type: "E",
  wallet_id: 1,
  category_id: 2,
});

const withServer = async (run) => {
  const app = express();
  app.use(express.json());
  app.post("/transaction", validate(transactionCreateSchema), (req, res) =>
    res.status(201).json(req.body)
  );
  app.put("/transaction/1", validate(transactionUpdateSchema), (req, res) =>
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

const post = (base, path, body, method = "POST") =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const detailsFor = (payload, field) =>
  payload.details.find((detail) => detail.path === field);

test("POST con amount negativo -> 400 con errore esplicito sul segno", async () => {
  await withServer(async (base) => {
    const response = await post(base, "/transaction", {
      ...validBody(),
      amount: -50,
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, "Validation error");

    const amountError = detailsFor(payload, "amount");
    assert.ok(amountError, "il 400 deve indicare il campo amount");
    assert.match(amountError.message, /must not be negative/);
    assert.match(amountError.message, /type/);
    assert.equal(payload.details.length, 1, "nessun altro campo è in errore");
  });
});

test("POST con amount 50 e type E continua a funzionare come prima", async () => {
  await withServer(async (base) => {
    const response = await post(base, "/transaction", validBody());
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(payload, validBody());
  });
});

test("amount 0 è ammesso: la convenzione vieta i negativi, non lo zero", async () => {
  await withServer(async (base) => {
    const response = await post(base, "/transaction", {
      ...validBody(),
      amount: 0,
      type: "I",
    });

    assert.equal(response.status, 201);
    assert.equal((await response.json()).amount, 0);
  });
});

test("anche il PUT rifiuta i negativi (stesso schema del POST)", async () => {
  await withServer(async (base) => {
    const response = await post(
      base,
      "/transaction/1",
      { ...validBody(), amount: -0.01 },
      "PUT"
    );
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(
      detailsFor(payload, "amount").message,
      /must not be negative/
    );
  });
});

test("le altre regole dello schema restano invariate", async () => {
  await withServer(async (base) => {
    const cases = [
      [{ ...validBody(), description: "" }, "description"],
      [{ ...validBody(), type: "X" }, "type"],
      [{ ...validBody(), amount: "50" }, "amount"],
      [{ ...validBody(), date: "" }, "date"],
      [{ ...validBody(), wallet_id: undefined }, "wallet_id"],
    ];

    for (const [body, field] of cases) {
      const response = await post(base, "/transaction", body);
      const payload = await response.json();

      assert.equal(response.status, 400, `${field} deve essere rifiutato`);
      assert.ok(detailsFor(payload, field), `atteso errore su ${field}`);
    }

    const wrongType = await post(base, "/transaction", {
      ...validBody(),
      amount: "50",
    });
    assert.equal(
      detailsFor(await wrongType.json(), "amount").message,
      "amount must be a number"
    );
  });
});

test("lo schema non trasforma i negativi: nessuna coercizione silenziosa", () => {
  const parsed = transactionCreateSchema.safeParse({
    ...validBody(),
    amount: -50,
  });

  assert.equal(parsed.success, false);
  assert.equal(parsed.error.issues[0].path.join("."), "amount");
});
