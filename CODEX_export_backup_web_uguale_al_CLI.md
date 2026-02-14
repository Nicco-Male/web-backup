# Export backup Web **uguale** a `meshtastic --export-config` (CLI)

## Obiettivo
Nella pagina **Settings → Backup** (`/settings/backup`) voglio un download che generi **lo stesso identico formato** del comando:

```bash
meshtastic --host 192.168.10.8 --export-config
```

Quel file è il “**Meshtastic configure yaml**” (quello che il CLI poi può reimportare con `--configure`).

---

## Evidenza del problema (dai 2 file allegati)
### 1) Il file CLI sembra “corrotto” ma è solo **encoding**
Il file `test.yalm` è stato creato con `>>` da **PowerShell** → quindi finisce in **UTF‑16LE con BOM** (non UTF‑8).  
Il contenuto testuale vero (decodificato) è un normale YAML.

> Nota: per ottenere un file UTF‑8 da PowerShell si può fare:
> ```powershell
> meshtastic --host 192.168.10.8 --export-config | Out-File -Encoding utf8 test.yaml
> ```

### 2) Il backup Web NON è il formato CLI
Il file web `meshtastic_config_backup_2026-02-14T10-10-27-686Z.yaml`:
- contiene un wrapper:
  - `generatedAt`, `format: meshtastic-web-config-backup-v1`, `config`, `moduleConfig`, `channels`
- include campi tecnici tipo `$typeName`
- esporta **molti più campi** rispetto a quelli che il CLI mette nel “configure yaml”
- (BUG grave) è **YAML invalido**: c’è una riga
  ```yaml
  ignoreIncoming:
  []
  ```
  che deve essere `ignoreIncoming: []` oppure una lista indentata.

### 3) Anche quando i valori “sembrano gli stessi”, la rappresentazione non coincide
Confrontando i campi sovrapposti:
- alcuni **enum** nel CLI sono stringhe, nel Web sono numeri:
  - `config.device.role`: `CLIENT_BASE` vs `12`
  - `config.bluetooth.mode`: `FIXED_PIN` vs `1`
  - `config.lora.modemPreset`: `MEDIUM_FAST` vs `4`
  - `config.lora.region`: `EU_868` vs `3`
  - `module_config.detectionSensor.detectionTriggerType`: `LOGIC_HIGH` vs `1`
- i campi **bytes/base64** nel CLI hanno prefisso `base64:`:
  - `publicKey`, `privateKey`, `adminKey[]` sono `base64:<...>` (anche `base64:` vuoto)

### 4) Il Web backup manca proprio di alcuni top-level che il CLI esporta
Nel “configure yaml” del CLI compaiono anche:
- `owner` e `owner_short`
- `location: { lat, lon }`
- `channel_url` (share URL dei canali)
- `canned_messages` (stringa tipo `Hi|Bye|Yes|No|Ok`)

Questi non sono nel backup web v1, quindi vanno recuperati da altre API/stato.

---

## Specifica del file da generare (OUTPUT REQUIRED)
La pagina web deve generare **questo formato** (schema):

```yaml
# start of Meshtastic configure yaml
canned_messages: <msg1|msg2|...>
channel_url: <https://meshtastic.org/e/#...>

config:
  bluetooth:
    enabled: true
    mode: FIXED_PIN           # enum name, non numero
    fixedPin: 123456
  device:
    role: CLIENT_BASE         # enum name, non numero
    nodeInfoBroadcastSecs: 14400
    disableTripleClick: false
    tzdef: "Europe/Rome"
  display:
    screenOnSecs: 600
  lora:
    usePreset: true
    modemPreset: MEDIUM_FAST  # enum name
    bandwidth: 250
    spreadFactor: 11
    codingRate: 8
    region: EU_868            # enum name
    hopLimit: 7
    txEnabled: true
    txPower: 30
    sx126xRxBoostedGain: true
    ignoreMqtt: true
  network:
    enabledProtocols: 1
    ntpServer: "0.pool.ntp.org"
  position:
    positionBroadcastSmartEnabled: true
    positionBroadcastSecs: 900
    broadcastSmartMinimumDistance: 100
    broadcastSmartMinimumIntervalSecs: 300
    gpsUpdateInterval: 30
    fixedPosition: false
    positionFlags: 0
  power:
    sdsSecs: 7200
    lsSecs: 300
    minWakeSecs: 10
    waitBluetoothSecs: 60
  security:
    serialEnabled: true
    publicKey: "base64:AAAA..."
    privateKey: "base64:BBBB..."
    adminKey:
      - "base64:CCCC..."
      - "base64:"
      - "base64:"

location:
  lat: 43.7138295
  lon: 10.4037916

module_config:
  ambientLighting:
    red: 0
    green: 0
    blue: 0
    current: 0
  cannedMessage:
    enabled: true
  detectionSensor:
    detectionTriggerType: LOGIC_HIGH   # enum name
    minimumBroadcastSecs: 60
  mqtt:
    enabled: true
    address: "mqtt.meshtastic.org"
    username: "..."
    password: "..."
    root: "msh/EU_868/IT/..."
    encryptionEnabled: true
    jsonEnabled: false
    mapReportingEnabled: true
    mapReportSettings:
      positionPrecision: 14
      publishIntervalSecs: 900
  neighborInfo:
    updateInterval: 900
  storeForward:
    enabled: true
    heartbeat: true
    historyReturnMax: 100
    historyReturnWindow: 100
    isServer: true
    records: 100

owner: "..."
owner_short: "..."
```

**Criterio di accettazione (pratico e brutale):**
1. Scarico il file dalla web UI.
2. Lo applico:
   ```bash
   meshtastic --host 192.168.10.8 --configure <file.yaml>
   ```
3. Poi rieseguo:
   ```bash
   meshtastic --host 192.168.10.8 --export-config
   ```
4. I due YAML risultanti devono essere **equivalenti** (stessi campi/valori; differenze ammesse solo su: timestamp/nome file/line endings).

---

## Come implementarlo nel codice Web (piano d’attacco)
### A) Non riutilizzare il “backup v1” così com’è
Quel formato è utile come “snapshot tecnico”, ma **non** è il configure-yaml del CLI.

Serve un nuovo export (o la sostituzione di quello attuale) che:
- costruisca un oggetto “configure yaml”
- converta enum e base64 come fa il CLI
- serializzi YAML valido (senza `$typeName`, senza wrapper)

### B) Recupero dati necessari
Dal lato Web, di solito hai già in memoria o puoi fetchare:

1) `LocalConfig` → già presente come `config`  
2) `LocalModuleConfig` → già presente come `moduleConfig`  
3) `channels[]` → già presente  
4) `owner` / `owner_short` → da `myNodeInfo.user.longName` / `shortName` (o equivalente nello store)  
5) `location.lat/lon` → da `myNodeInfo.position` (converti `latitudeI/longitudeI` a gradi se serve, tipico /1e7)  
6) `canned_messages` → se l’app già gestisce i canned messages, riusa la stessa API/metodo; altrimenti invia la richiesta admin per leggere la lista e poi join con `|`.

### C) Generazione `channel_url`
NON reinventare l’algoritmo a mano: nel progetto Web quasi sicuramente esiste già:
- una funzione che **genera** il Channel URL (usata per “Share”/“QR” dei canali)
- oppure la stessa funzione usata per importare da URL

**Task per Codex:** cercare nel repo stringhe tipo:
- `meshtastic.org/e/#`
- `channel_url`
- `ChannelUrl`
- `QR`
e riusare quel pezzo.

### D) Enum → stringhe
Il CLI stampa i nomi enum (es: `CLIENT_BASE`, `MEDIUM_FAST`).  
In TypeScript con protobuf puoi ricavare il nome dall’enum generato, esempio (nomi indicativi):

```ts
import { Config } from "@meshtastic/protobufs"; // o dove sono gli enum

const roleName = Config.DeviceConfig.Role[device.role];        // 12 -> "CLIENT_BASE"
const presetName = Config.LoRaConfig.ModemPreset[lora.modemPreset];
const regionName = Config.LoRaConfig.RegionCode[lora.region];
const btModeName = Config.BluetoothConfig.PairingMode[bt.mode];
```

### E) Bytes/base64 con prefisso `base64:`
Nel backup web i bytes spesso sono già stringhe base64 (senza prefisso).  
Nel configure-yaml del CLI devono essere:

- `publicKey: "base64:<valore>"`
- `privateKey: "base64:<valore>"`
- `adminKey: ["base64:<k0>", "base64:", "base64:"]`

Quindi:
```ts
const b64 = (s: string) => `base64:${s ?? ""}`;
```

### F) Selezione campi (non esportare “tutto”)
Per essere coerente col CLI:
- esporta **solo** i campi che il CLI esporta (vedi sezione “Specifica OUTPUT”)
- lascia fuori `$typeName`, `version`, e campi extra tipo `ignoreIncoming`, `configOkToMqtt`, ecc.  
(Se il CLI in futuro li aggiunge, aggiorneremo l’allowlist.)

### G) Serializzazione YAML
Usa una libreria YAML “seria” (es: `yaml` o `js-yaml`) e non stringhe concatenate.

Obiettivo:
- YAML valido
- indent 2 spazi
- niente wrapper
- ordine deterministico (costruisci l’oggetto con l’ordine finale desiderato)

---

## Bonus: fix immediato del bug YAML invalido (anche se tenete il backup v1)
Nel dump attuale, assicuratevi che `ignoreIncoming` venga serializzato correttamente:
- `ignoreIncoming: []` (inline)  
oppure
- `ignoreIncoming:
  - ...` (lista indentata)

Quella riga oggi rende il file **non parsabile**.

---

## Allegati (per Codex)
- `test.yalm` (CLI export; **UTF‑16LE** da PowerShell, decodificare come testo)
- `meshtastic_config_backup_2026-02-14T10-10-27-686Z.yaml` (export web v1, YAML invalido + formato diverso)

Fine.
