# BACKUP Web identico al CLI: aggiungere `canned_messages` + hardening formato YAML

Contesto: l’export della pagina **/settings/backup** deve produrre un YAML *equivalente* a `meshtastic --export-config` (stesso contenuto e stessa forma: ordine, placeholder, escaping unicode).

---

## 1) Bug attuale: `canned_messages` mancante (o vuoto)

Nel YAML del CLI esiste sempre la chiave top‑level:

```yaml
canned_messages: Hi|Bye|Yes|No|Ok
```

Nel Web export invece risulta vuota:

```yaml
canned_messages:
```

Quella stringa non arriva “da config/module_config”: va richiesta esplicitamente via **AdminMessage**.

### Fonte di verità (protobuf)
In `meshtastic/admin.proto` esistono i campi:

- `get_canned_message_module_messages_request` (bool)
- `get_canned_message_module_messages_response` (string)

```proto
// Get the Canned Message Module messages in the response to this message.
bool get_canned_message_module_messages_request = 10;
// ...response
string get_canned_message_module_messages_response = 11;
```

(vedi admin.proto su buf.build)

---

## 2) Come fa il CLI (comportamento da copiare)

Il CLI python chiama una “get” dedicata che:
1) invia un AdminMessage con `get_canned_message_module_messages_request = true`
2) attende la risposta
3) usa la stringa risultante per riempire `canned_messages`

Riferimento: metodo `get_canned_message()` del client python.

---

## 3) Patch richiesta nel Web export

### 3.1 Aggiungi una fase “FETCH” prima di serializzare il YAML
Nel flusso di **export** (prima di costruire l’oggetto che poi dumpi in YAML):

1) **manda** AdminMessage request
2) **attendi** AdminMessage response
3) salva in una variabile `cannedMessages` (string) con fallback `""` se assente/timeout
4) scrivi `canned_messages: <cannedMessages>` come **prima** chiave dopo il comment header (ordine CLI)

Pseudo‑flow (nomi campi in camelCase o snake_case dipendono dal codegen che usate):

```ts
// 1) Request
const req = AdminMessage.create({
  getCannedMessageModuleMessagesRequest: true,
});

// 2) Send & wait response (wantResponse=true / ACK path)
const resp = await sendAdminAndWait(req, {
  // deve essere un AdminMessage che ha valorizzato il campo response
  field: "getCannedMessageModuleMessagesResponse",
  timeoutMs: 3000,
});

// 3) Value
const cannedMessages = resp?.getCannedMessageModuleMessagesResponse ?? "";

// 4) YAML object (ordine!)
const out = {
  canned_messages: cannedMessages,
  channel_url: channelUrl,
  config: ...,
  module_config: ...,
  owner: ...,
};
```

**Nota:** se il tuo layer “sendAdminAndWait” filtra i messaggi per `payload_variant` (oneof), qui devi matchare il variant giusto.

### 3.2 Regole di serializzazione per essere “identici al CLI”
- `canned_messages` deve essere:
  - presente **sempre**
  - una **stringa** (anche vuota), *non* `null` e *non* YAML multiline
- Preferisci scalar “plain” (senza virgolette) quando la stringa è safe.
  - Se contiene caratteri che rendono ambiguo il plain YAML, allora quota, ma in modo coerente con il CLI.

---

## 4) Roba che rompe l’uguaglianza: checklist rapida

### 4.1 Non emettere `{}` a caso
Il CLI tende a **omissione** di sezioni vuote. Quindi:
- prima del dump: `pruneEmptyObjects()` su tutto l’albero
- eccezioni: placeholder che il CLI *vuole* (tipo `security.adminKey` con 3 entry)

### 4.2 Emoji/Unicode: NON “decodificare”
Il CLI (con PyYAML default che avete visto) tende a **escapare** non‑ASCII tipo:

```yaml
owner: "Nicco Pisa Berry \U0001F1EE\U0001F1F9"
```

Quindi nel Web export:
- non trasformare `\U0001F...` in emoji reali
- se in input hai emoji reali, **convertile** a escape `\UXXXXXXXX` per matchare il CLI

Suggerimento: `escapeUnicodeLikePyYAML(s)` applicata a **tutte** le stringhe utente (owner, long_name, short_name, ecc.).

### 4.3 `config.security` (promemoria)
- `adminKey` è lista da 3 elementi, in formato:
  - `- base64:<VALORE>`
  - `- 'base64:'`
  - `- 'base64:'`
- `privateKey/publicKey` devono essere `base64:<...>` **senza** virgolette.
(vedi doc v3 “security identica”)

---

## 5) Test di accettazione (hard requirement)

1) Esegui:
   - CLI: `meshtastic --host <ip> --export-config`
   - Web: download da `/settings/backup`
2) Confronta i due file **normalizzando solo**:
   - line ending `\r\n` vs `\n` (se necessario)
   - encoding (UTF‑16 da PowerShell redirect vs UTF‑8)  
3) Dopo normalizzazione, il diff deve essere **vuoto**:
   - stessa presenza/valore di `canned_messages`
   - stesso ordine chiavi
   - stessa struttura `security.adminKey`
   - stesso escaping unicode (niente emoji “reali” dove il CLI usa `\U...`)

