# CODEX — Fix Backup & Ripristino: **parità totale col CLI** (export + import)

## Problema attuale
1) **Export Web** (`/settings/backup`) sta generando un file “CLI-compatible”, ma:
- `canned_messages` esce **vuoto**
- alcuni dettagli (security, unicode, ordine, quoting) non sono 1:1 col CLI

2) **Restore Web** valida solo il formato “web backup v1” (camelCase: `moduleConfig`)  
→ se carichi un file in formato CLI (snake_case: `module_config`) ottieni:
- `Campo mancante: moduleConfig`

Obiettivo: **Export identico al CLI** + **Restore che accetta sia CLI che Web v1**.

---

## Fonti (per implementazione)
- `Node.get_canned_message()` invia `AdminMessage.get_canned_message_module_messages_request = True` e aspetta response. (python.meshtastic.org)  
- `AdminMessage` include `set_canned_message_module_messages` (string) per impostare i canned messages. (Buf schema registry / docs)

---

## ✅ REQ-1: Export Web deve essere **identico** a `meshtastic --export-config`
### 1) Recupero canned_messages (non viene dal normale config dump)
Implementare una fetch prima del dump YAML:

**Send**
- `AdminMessage.get_canned_message_module_messages_request = true`

**Read**
- `AdminMessage.get_canned_message_module_messages_response` (string)

> In python la logica è in `Node.get_canned_message()`: manda request admin, aspetta response e concatena.

**Fallback**
- Se timeout/failure: NON scrivere `canned_messages:` vuoto.
  - Meglio: omettere la riga (ma il CLI la mette).  
  - Per “identico al CLI”: riprovare una volta e se fallisce, metti stringa vuota **solo** se anche il CLI fallisce (non ideale).
  - Suggerito: timeout 3–5s + 1 retry.

### 2) Se l’export deve essere 1:1 testuale: patch dei “pignoli”
- ordine chiavi (top-level + sezioni) deterministico (vedi SPEC già concordata)
- `owner`: deve uscire con escape unicode `\UXXXXXXXX` (no emoji raw)
- sezione `config.security`: deve essere stampata come il CLI (vedi REQ-3 sotto)
- `channel_url` e `canned_messages` come plain scalar (no virgolette se possibile)

---

## ✅ REQ-2: Restore Web deve accettare **sia CLI** che **Web backup v1**
### A) Riconoscimento formato
```ts
function isCliConfigureYaml(doc: any) {
  return !!doc && typeof doc === "object"
    && typeof doc.channel_url === "string"
    && !!doc.config
    && !!doc.module_config;   // snake_case
}

function isWebBackupV1(doc: any) {
  return !!doc && typeof doc === "object"
    && typeof doc.format === "string"
    && doc.format.startsWith("meshtastic-web-config-backup-");
}
```

### B) Normalizzazione minima (per riusare la pipeline esistente)
Se vuoi riusare il validatore “web v1” (camelCase), fai mapping:

```ts
function normalizeCliToWeb(doc: any) {
  const out = { ...doc };

  // snake_case -> camelCase
  if (out.module_config && !out.moduleConfig) out.moduleConfig = out.module_config;
  if (out.owner_short && !out.ownerShort) out.ownerShort = out.owner_short;
  if (out.canned_messages !== undefined && out.cannedMessages === undefined)
    out.cannedMessages = out.canned_messages;
  if (out.channel_url && !out.channelUrl) out.channelUrl = out.channel_url;

  return out;
}
```

Poi:
```ts
const parsed = YAML.parse(text);
const doc = isCliConfigureYaml(parsed) ? normalizeCliToWeb(parsed) : parsed;
validate(doc); // tua validazione attuale
```

### C) Applicazione reale delle impostazioni (CLI-format restore)
Il CLI quando fa `--configure` non “inventa”: manda AdminMessages per:
- set_config (config)
- set_module_config (module_config)
- set_owner (owner/owner_short)
- set_channel (da channel_url) / o canali singoli
- set_canned_message_module_messages (canned_messages)

Quindi nella restore web:
1. Se doc ha `config` → invia `AdminMessage.set_config`
2. Se doc ha `module_config` → invia `AdminMessage.set_module_config`
3. Se doc ha `owner/owner_short` → invia `AdminMessage.set_owner`
4. Se doc ha `channel_url` → parse in `channels[]` usando la **stessa funzione già presente** (import da URL / share/QR)
5. Se doc ha `canned_messages` (string) → invia:
   - `AdminMessage.set_canned_message_module_messages = "<msg1|msg2|...>"`

> Importante: il tuo restore oggi sta fallendo prima (schema), quindi il mapping sopra sblocca tutto.

---

## ✅ REQ-3: `config.security` deve essere identico (formattazione inclusa)
### Stato: differenze rimaste
- `adminKey` oggi viene esportato come:
  - primo valore senza prefisso `base64:`
  - due vuoti come `""`
  - lista con indent extra (`-` sotto `  -`)
- `privateKey/publicKey` quotate

### Output richiesto (CLI 1:1)
```yaml
  security:
    adminKey:
    - base64:<KEY0>
    - 'base64:'
    - 'base64:'
    privateKey: base64:<PRIV>
    publicKey: base64:<PUB>
    serialEnabled: true
```

### Implementazione robusta
Non combattere il serializer: fai dump normale e poi **sostituisci il blocco `security`** con stringa esatta.

Pseudo:
```ts
yamlText = yamlText.replace(
  /^  security:\n[\s\S]*?(?=^location:)/m,
  securityBlockCLI(securityData)
);
```

---

## ✅ REQ-4: `canned_messages` non deve essere vuoto
Attualmente esce:
```yaml
canned_messages:
```
Deve uscire come CLI:
```yaml
canned_messages: Hi|Bye|Yes|No|Ok
```

### NOTE
- La doc ufficiale del modulo “Canned Message” dice chiaramente che `Messages` è una stringa con separatore `|` e max ~200 bytes. (Meshtastic docs)
- In protobuf esiste `set_canned_message_module_messages` per impostarla (AdminMessage).

---

## Test di accettazione (automatizzabili)
### Export parity
1. Web export → `web.yaml`
2. CLI export → `cli.yaml`
3. Normalizza line endings e confronta (diff testuale)
4. Must-match su:
- ordine
- security block
- owner unicode escaping
- canned_messages valorizzato

### Restore compatibility
- Carico in UI un YAML CLI: deve passare e applicare
- Carico in UI un YAML web backup v1: deve continuare a funzionare

---

## Piccola nota operativa (Windows)
Se l’utente salva l’export CLI con PowerShell usando `>>`, il file può finire in UTF‑16LE.
Non è un bug della web UI; è solo encoding. (Soluzione: Out-File -Encoding utf8)

Fine.
