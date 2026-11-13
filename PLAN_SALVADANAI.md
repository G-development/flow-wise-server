# Piano: salvadanai e spese annuali

Obiettivo: portare in Flow-Wise la parte di `Gestione 2026.xlsx` che oggi l'app non ha — i salvadanai
(Emergenze, Savings, Annuali, Trade Republic) e il piano delle spese annuali — in modo che l'Excel possa
essere dismesso. Lista operativa: `TODO_SALVADANAI.md`.

Regola di lavoro: **niente si costruisce su un'ipotesi non verificata**. Ogni fase parte solo quando le
decisioni e le verifiche che la precedono sono chiuse; quello che non sappiamo sta nella sezione
"Da verificare", non nel codice.

## 1. Cosa fa l'Excel (sintesi)

- Ogni mese l'avanzo (entrate − uscite + residuo del mese prima) viene assegnato a Savings, TR,
  Emergenze, Annuali finché non resta ~0 (fogli mensili, celle `C15:C20`).
- "Annuali" è un fondo: riceve una quota fissa (oggi 360 €) e paga assicurazione, bollo, rate
  dell'università, TaRi, AdE. Una spesa coperta dal fondo resta spesa del mese, compensata da
  un'assegnazione negativa (es. ottobre: assicurazione 477, `C19 = 360 − 300 − 400 − 60`).
- "Spese annuali" (foglio `Savings ISP`, righe 19–32) è l'elenco delle voci con scadenze;
  lo "Specchietto per uni" proietta il fondo rata per rata.

## 2. Fatti verificati (9 novembre 2026, lettura del codice e del database live, sola lettura)

1. **I movimenti dei salvadanai Intesa arrivano nell'import.** Descrizioni:
   `MOVIM. SALVADANAIO Accantonamento somma sul Salvadanaio` (uscita dal conto) e
   `MOVIM. SALVADANAIO Riunione somme dal salvadanaio` (rientro sul conto). 26 movimenti dal 30/07.
2. **Il movimento non dice quale salvadanaio.** In `raw_data` controparte vuota, nessun IBAN o nome:
   solo importo e data. Esempio 30/10: −100, −150, −60 (che nell'Excel corrispondono a Emergenze,
   Savings, Annuali di novembre). L'abbinamento al salvadanaio giusto non può essere automatico.
3. **La categoria "Giroconto" (E id 51, I id 52) mescola tre cose diverse:**
   - movimenti dei salvadanai (7 uscite per 620 €, 13 rientri per 1.240 € dal 10/08);
   - bonifici "a favore di: Giovanni Cuozzo" (150 il 30/09 e il 30/10, più 100, 80, 2,36);
   - soldi verso e da amici e coinquilini (Michele, Eduard, Akissi; rimborsi condominio 132,91 × 2;
     Revolut, PayPal), finiti lì tramite regole imparate sui nomi delle persone.
4. **Dashboard e statistiche contano i Giroconti come entrate e spese vere.** I widget sommano tutte
   le transazioni per tipo (`totalForType(rows, "E")`), senza escludere nulla. Da agosto a ottobre
   Giroconto vale 2.106,92 € di "spese" e 2.029,95 € di "entrate".
5. **Il modello dati conosce solo entrate e spese.** `Transaction.type` è `"I"` o `"E"`; non esiste
   un trasferimento tra wallet. Il saldo di un wallet è derivato dalle sue transazioni
   (`utils/walletService.js`).
6. **Massimo 3 wallet per utente**, imposto da un trigger del database (migrazione `004`).
   Oggi hai 2 wallet: "GC Default wallet" (id 1, default, dove entra l'import automatico) e
   "Trade Republic" (id 11), che contiene 5 transazioni di prova del 2025 ("lala", "io", "test"…).
7. **La tabella `Budget` esiste ma è vuota**; la pagina `/budgets` è un segnaposto.
8. **Esiste una categoria spesa "Annuali" (id 11)** con 31 transazioni dal 2021 a febbraio 2026
   (benzina, pub, bar…): un uso storico che non corrisponde al fondo Annuali dell'Excel.
9. I movimenti bancari partono dall'11/07/2026; l'import automatico nel wallet 1 dal 10/08/2026.
   `bank_connections` registra **un solo `account_id`** per collegamento.

## 3. Da verificare prima di progettare

- ~~**V1.**~~ **Chiusa il 9/11: no.** La requisition Intesa espone un solo conto, quello principale.
  I salvadanai esistono per GoCardless solo come movimenti "MOVIM. SALVADANAIO" sul conto, quindi i
  loro saldi li calcola l'app a partire dai saldi di apertura del 1° dicembre (V2) e dai giroconti.
- **V2.** Saldi reali dei salvadanai a una data di taglio, letti dall'app Intesa. L'Excel non è
  affidabile qui: `Savings ISP` dà tutti e tre i salvadanai a 0 a fine ottobre, mentre lo
  "Specchietto per uni" dice "Attuale in annuali 350".
- ~~**V3.**~~ **Chiusa il 9/11:** i bonifici "a favore di Giovanni Cuozzo" vanno a Trade Republic.
- ~~**V4.**~~ **Chiusa il 9/11:** i movimenti con Michele, Eduard e Akissi sono pagamenti tra amici
  (bar, uscite, cene): spese e rimborsi, non giroconti. Da confermare le eccezioni che i dati
  suggeriscono: bollette rimborsate a Michele e quote del condominio (to-do V4b).

## 4. Approccio

**Trasferimenti come nuovo tipo `"T"`** (deciso da Gio il 9/11, D1). Una transazione `T` ha un
wallet di origine e uno di destinazione e non è né entrata né spesa: le statistiche la ignorano per
costruzione. Costo da mettere in conto, perché oggi tutto assume `I`/`E`:

- calcolo del saldo dei wallet (`utils/walletService.js`): una `T` toglie dall'origine e aggiunge
  alla destinazione;
- schema Zod, route delle transazioni, import CSV, import bancario;
- regole delle categorie e categorie stesse (oggi tipizzate `I`/`E`): una `T` ha una categoria?
- ogni punto del client che filtra o somma per tipo.

Prima di scrivere codice serve l'elenco completo di questi punti (primo to-do della fase 1).

**Wallet di due tipi** (D2): `account` per i conti veri (conto ISP, Trade Republic) e `pot` per i
salvadanai ISP (Emergenze, Savings, Annuali), legati al conto ISP. I salvadanai non contano nel
limite di 3 e non possono essere default. Un giroconto ISP → Trade Republic è una `T` tra due conti;
un accantonamento è una `T` tra il conto ISP e un salvadanaio. Il salvadanaio di un movimento
importato si sceglie a mano, con un suggerimento.

**Ogni salvadanaio ha un tetto massimo** (D7): Emergenze 1.000 €, Savings 1.000 €, Annuali pari
alla somma delle spese del piano (quindi calcolato, e cambia quando cambiano le voci). Il consiglio
di versamento non supera il tetto. Il tetto può essere fisso o calcolato: va previsto nel modello.

**Piano Annuali = voci con rate esplicite** (data, importo previsto, importo effettivo), non una
regola "ogni N mesi": il condominio (D6) cambia importo e numero di rate ogni anno. Le rate di un
anno si copiano sul successivo e poi si correggono. L'app
**consiglia** la quota mensile, che poi decide e versa Gio (D5). Il consiglio non è
"somma delle voci / 12" ma parte dal **saldo reale** del salvadanaio, quindi tiene conto dei prelievi
non previsti:

- per ogni mese futuro *k* (da 1 a 12): `C_k` = somma delle scadenze fino al mese *k*;
- quota necessaria per arrivarci = `(C_k − saldo attuale) / k`;
- quota consigliata = la più alta tra queste (zero se il saldo basta già).

Versando la quota consigliata ogni mese nessuna scadenza dei prossimi 12 mesi resta scoperta. Se un
mese prelevi per un'emergenza, il saldo scende e il consiglio del mese dopo sale da solo. Da definire:
il versamento di fine mese (stipendio ~il 30) copre le scadenze dei primi giorni del mese dopo?

### Principio: le persone non hanno un significato fisso

Vincolo di Gio (9/11): nulla nel codice deve dire "Michele = bollette". Oggi è così, domani può
cambiare chi paga cosa, e uno stesso amico riceve sia la quota della luce sia quella della pizza.
Quindi:

- **La persona è solo un dato del movimento** (la controparte), mai una regola nel codice.
- **Il significato sta nel singolo movimento**: categoria scelta (Bollette, Uscite…) e, quando serve,
  il collegamento a una spesa che rimborsa.
- **Le regole sono dati modificabili, non codice**, come già oggi (`category_rules`). Una regola
  basata solo sul nome di una persona è ambigua per natura, quindi **suggerisce e non decide**.
  Il testo libero del bonifico, quando c'è ("Condominio settembre", "Tari agosto"), è più
  affidabile e può decidere.
- **Due casi generici**, validi per chiunque:
  1. *Qualcuno anticipa e io pago la mia quota* (oggi: bollette pagate da Michele) → il mio
     pagamento è una spesa normale con la sua categoria. Non serve altro.
  2. *Anticipo io e gli altri mi rimborsano* (oggi: condominio, cene) → il rimborso in entrata si
     collega alla spesa originale, che nelle statistiche conta al netto.

Se domani le bollette le paghi tu e Michele ti rimborsa, si passa dal caso 1 al caso 2 senza toccare
il codice: cambia solo come classifichi i movimenti nuovi.

## 5. Fasi

| Fase | Contenuto | Dipende da | Stato |
| --- | --- | --- | --- |
| 0 | Decisioni e verifiche V1–V3 | — | chiusa |
| 1 | Trasferimenti: tipo `T` (migrazione 011), esclusi dalle statistiche; Giroconto eliminato | 0 | pubblicata 9–10/11 |
| 2 | Salvadanai: wallet `pot` (012), saldi di apertura, movimenti assegnati, pagina Movements | 1, V1, V2 | pubblicata 10/11 |
| 3 | Piano Annuali: voci, quota, tetto, proiezione, pagamenti (013) | 2 | pubblicata 10/11, 7 voci inserite |
| 4 | Verifica in parallelo con l'Excel per uno o due mesi | 2, 3 | in corso: Gio passa l'Excel a fine novembre per il report |
| 5 | Rimborsi e spese condivise: rimborsi per categoria (014), regole sul testo del bonifico | 1 | pubblicata 11/11 |
| 6 | Backup ed export: backup notturno cifrato (repo privato), ripristino provato, export JSON + CSV in Settings | — | pubblicata 13/11 (dopo i due processi `/court`) |

Il 13/11 anche il recupero password è stato rimesso in piedi (migrazione 002 mai applicata, casella di
sistema `gc.dev.app@gmail.com`, pagine e mail con lo stile dell'app): dettagli in `TODO_SALVADANAI.md`.

Ritocchi dell'interfaccia chiesti da Gio il 10/11 (menu mobile, Your Bank, dashboard, Total Balance): voci U1–U7
in `TODO_SALVADANAI.md`, da fare prima della fase 4 o in parallelo.

Revolut è **rinviato** per scelta di Gio (10/11): non si collega e non ha un wallet; i passaggi verso
Revolut si registrano come spese con "Not a transfer". Dettagli in `TODO_SALVADANAI.md`, passo 4.

La chiusura mensile (assegnare l'avanzo finché resta zero) viene dopo: usa i salvadanai e i
trasferimenti di queste fasi.

## 6. Come verifichiamo ogni fase

- Test `node --test` per ogni invariante nuovo (server); `tsc` e `next build` (client).
- Migrazioni con `.down.sql`, provate prima su una copia e non sul database live.
- **Riconciliazione**: dopo la fase 2, il saldo di ogni salvadanaio nell'app deve coincidere con
  quello dell'app Intesa alla stessa data. Se non coincide, si cerca il motivo; non si aggiusta
  il numero.
