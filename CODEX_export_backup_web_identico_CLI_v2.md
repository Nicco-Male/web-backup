# Export “Backup” Web **identico** al CLI (`--export-config`) — v2 (ordine + {} + emoji)

## Stato attuale (problemi rimasti)
Dai due file che mi hai dato:

- CLI: `export-cli.yalm` (è **UTF‑16LE** perché salvato da PowerShell con redirect; il contenuto YAML è quello giusto)
- Web: `meshtastic_config_backup_2026-02-14T15-19-56-821Z.yaml`

Restano 3 difetti che impediscono il match 1:1 col CLI:

1) **Ordine chiavi diverso** (top-level e sotto-sezioni).  
2) YAML **invalido**: compaiono blocchi `{}`
   ```yaml
   serial:
   {}
   ```
   che devono essere o `serial: {}` oppure (meglio) **omessi**.  
3) `owner` **non deve contenere emoji raw**, ma deve uscire come fa il CLI:
   ```yaml
   owner: "Nicco Pisa Berry \U0001F1EE\U0001F1F9"
   ```
   (cioè escape unicode in stile PyYAML `allow_unicode=False`).

---

## Criterio di accettazione (test)
1. Scarico dalla Web UI `/settings/backup` un file **configure yaml**.
2. Lo applico:
   ```bash
   meshtastic --host 192.168.10.8 --configure file.yaml
   ```
3. Rieseguo:
   ```bash
   meshtastic --host 192.168.10.8 --export-config
   ```
4. Il testo deve risultare **identico** (a parità di valori), inclusi:
   - ordine delle chiavi
   - assenza di `{}`
   - `owner` con `\U...` (non emoji raw)
   - `canned_messages` e `channel_url` **senza virgolette** se possibile (come CLI)

---

## SPEC: ordine esatto (estratto dal CLI reale)
### Top-level order
1. `canned_messages`
2. `channel_url`
3. `config`
4. `location`
5. `module_config`
6. `owner`
7. `owner_short`

### `config` order
1. `bluetooth`
2. `device`
3. `display`
4. `lora`
5. `network`
6. `position`
7. `power`
8. `security`

#### `config.bluetooth` order
- `enabled`
- `fixedPin`
- `mode`

#### `config.device` order
- `disableTripleClick`
- `nodeInfoBroadcastSecs`
- `role`
- `tzdef`

#### `config.display`
- `screenOnSecs`

#### `config.lora` order
- `bandwidth`
- `codingRate`
- `hopLimit`
- `ignoreMqtt`
- `modemPreset`
- `region`
- `spreadFactor`
- `sx126xRxBoostedGain`
- `txEnabled`
- `txPower`
- `usePreset`

#### `config.network` order
- `enabledProtocols`
- `ntpServer`

#### `config.position` order
- `broadcastSmartMinimumDistance`
- `broadcastSmartMinimumIntervalSecs`
- `fixedPosition`
- `gpsUpdateInterval`
- `positionBroadcastSecs`
- `positionBroadcastSmartEnabled`
- `positionFlags`

#### `config.power` order
- `lsSecs`
- `minWakeSecs`
- `sdsSecs`
- `waitBluetoothSecs`

#### `config.security` order
- `adminKey`
- `privateKey`
- `publicKey`
- `serialEnabled`

### `location` order
- `lat`
- `lon`

### `module_config` order (CLI reale)
1. `ambientLighting`
2. `cannedMessage`
3. `detectionSensor`
4. `mqtt`
5. `neighborInfo`
6. `storeForward`

#### `module_config.ambientLighting` order
- `blue`
- `current`
- `green`
- `red`

#### `module_config.cannedMessage`
- `enabled`

#### `module_config.detectionSensor` order
- `detectionTriggerType`
- `minimumBroadcastSecs`

#### `module_config.mqtt` order
- `address`
- `enabled`
- `encryptionEnabled`
- `jsonEnabled`
- `mapReportSettings`
- `mapReportingEnabled`
- `password`
- `root`
- `username`

##### `module_config.mqtt.mapReportSettings` order
- `positionPrecision`
- `publishIntervalSecs`

#### `module_config.neighborInfo`
- `updateInterval`

#### `module_config.storeForward` order
- `enabled`
- `heartbeat`
- `historyReturnMax`
- `historyReturnWindow`
- `isServer`
- `records`

---

## FIX 1 — Niente `{}` “a caso” (e niente moduli extra)
Il CLI **NON** esporta moduli vuoti e non mette placeholder.

Quindi:
- se una sezione è `{}` → **non stamparla proprio**
- se un array è `[]` e nel CLI non esiste → **non stamparlo**
- se un valore è `undefined/null` → **non stamparlo**

### Helper TS consigliati
```ts
function isPlainObject(v: any): v is Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v);
}
function isEmptyPlainObject(v: any): boolean {
  return isPlainObject(v) && Object.keys(v).length === 0;
}
function pruneEmpty(v: any): any {
  if (Array.isArray(v)) {
    const arr = v.map(pruneEmpty).filter(x => x !== undefined);
    return arr.length ? arr : undefined;
  }
  if (isPlainObject(v)) {
    const out: Record<string, any> = {};
    for (const [k,val] of Object.entries(v)) {
      const pv = pruneEmpty(val);
      if (pv === undefined) continue;
      if (isEmptyPlainObject(pv)) continue;
      out[k] = pv;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v === null || v === undefined ? undefined : v;
}
```

**Nota:** nel tuo export Web attuale compaiono chiavi extra in `module_config`:
`serial`, `externalNotification`, `rangeTest`, `telemetry`, `audio`, `paxcounter`, …  
→ vanno **omesse** (o almeno omesse se vuote) perché il CLI non le include.

---

## FIX 2 — Ordine deterministico identico al CLI
Qui non basta “non ordinare”: bisogna **costruire** un oggetto con chiavi inserite *nell’ordine CLI*.

### Pattern consigliato
```ts
function pickInOrder<T extends Record<string, any>>(src: T, keys: (keyof T)[]) {
  const out: any = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}
```

Poi costruisci **a mano** l’output finale seguendo la SPEC sopra, esempio (scheletro):
```ts
const out = {
  canned_messages: cannedMessagesString,     // 1
  channel_url: channelUrl,                   // 2
  config: {                                  // 3
    bluetooth: pickInOrder(bt, ["enabled","fixedPin","mode"]),
    device: pickInOrder(dev, ["disableTripleClick","nodeInfoBroadcastSecs","role","tzdef"]),
    display: pickInOrder(disp, ["screenOnSecs"]),
    lora: pickInOrder(lora, ["bandwidth","codingRate","hopLimit","ignoreMqtt","modemPreset","region","spreadFactor","sx126xRxBoostedGain","txEnabled","txPower","usePreset"]),
    network: pickInOrder(net, ["enabledProtocols","ntpServer"]),
    position: pickInOrder(pos, ["broadcastSmartMinimumDistance","broadcastSmartMinimumIntervalSecs","fixedPosition","gpsUpdateInterval","positionBroadcastSecs","positionBroadcastSmartEnabled","positionFlags"]),
    power: pickInOrder(pwr, ["lsSecs","minWakeSecs","sdsSecs","waitBluetoothSecs"]),
    security: pickInOrder(sec, ["adminKey","privateKey","publicKey","serialEnabled"]),
  },
  location: pickInOrder(loc, ["lat","lon"]), // 4
  module_config: {                           // 5
    ambientLighting: pickInOrder(amb, ["blue","current","green","red"]),
    cannedMessage: pickInOrder(can, ["enabled"]),
    detectionSensor: pickInOrder(det, ["detectionTriggerType","minimumBroadcastSecs"]),
    mqtt: {
      ...pickInOrder(mqtt, ["address","enabled","encryptionEnabled","jsonEnabled","mapReportSettings","mapReportingEnabled","password","root","username"]),
      mapReportSettings: pickInOrder(mqtt.mapReportSettings ?? {}, ["positionPrecision","publishIntervalSecs"]),
    },
    neighborInfo: pickInOrder(nei, ["updateInterval"]),
    storeForward: pickInOrder(sf, ["enabled","heartbeat","historyReturnMax","historyReturnWindow","isServer","records"]),
  },
  owner: ownerString,                        // 6
  owner_short: ownerShort,                   // 7
};

const pruned = pruneEmpty(out);
```

---

## FIX 3 — `owner` deve usare escape unicode `\UXXXXXXXX`
Il CLI (PyYAML default) produce escape unicode nel dump.  
In JS di solito escono emoji raw, quindi bisogna forzare l’escape **solo per `owner`** (almeno per ora).

### Funzione TS per generare `\UXXXXXXXX`
```ts
function cliUnicodeEscapes(s: string) {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x7E) out += ch; // ASCII
    else if (cp <= 0xFFFF) out += `\\u${cp.toString(16).toUpperCase().padStart(4,"0")}`;
    else out += `\\U${cp.toString(16).toUpperCase().padStart(8,"0")}`;
  }
  return out;
}
```

### Patch della riga `owner:` (semplice e brutale, ma identico al CLI)
Se la libreria YAML non produce `\U...` automaticamente:
1) fai stringify normale dell’oggetto
2) **sostituisci** la riga `owner:` con quella in stile CLI

```ts
const ownerEsc = cliUnicodeEscapes(ownerRaw);
// IMPORTANT: deve essere tra doppi apici e con backslash singolo nel file
yamlText = yamlText.replace(/^owner:.*$/m, `owner: "${ownerEsc}"`);
```

Esempio risultato:
```yaml
owner: "Nicco Pisa Berry \U0001F1EE\U0001F1F9"
```

---

## Nota su `canned_messages` e `channel_url` (virgolette)
Nel CLI reale:
- `canned_messages: Hi|Bye|Yes|No|Ok` (plain scalar)
- `channel_url: https://...` (plain scalar)

Se la tua lib le quota, e vuoi il match testuale, puoi patchare:
```ts
yamlText = yamlText.replace(/^canned_messages: "(.*)"$/m, "canned_messages: $1");
yamlText = yamlText.replace(/^channel_url: "(https:\/\/.*)"$/m, "channel_url: $1");
```

---

## TL;DR per la PR
- costruisci un oggetto “configure yaml” con **allowlist + ordine** come SPEC
- `pruneEmpty()` per eliminare moduli vuoti → spariscono i `{}` e le chiavi extra
- `owner` → forzare escape `\U...` come CLI (patch linea o serializer custom)
- niente wrapper / metadata: deve restare “Meshtastic configure yaml” puro

Fine.
