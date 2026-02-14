# Patch finale: sezione `config.security` **identica** al CLI

## Diff reale (CLI vs Web)
### CLI (`--export-config`)
```yaml
  security:
    adminKey:
    - base64:6i5Imo6PwzKOmd0O5x2he3Oo1yeFVkL0czq+TRtwJm0=
    - 'base64:'
    - 'base64:'
    privateKey: base64:IKhkOAphNZr4U948HkKx+J09hK7BHCAFvvQVICwBkEc=
    publicKey: base64:r7O4pSccIMGXCUlCJFJUfxlUtvnNF2+nyADtGj8i9C8=
    serialEnabled: true
```

### Web attuale
```yaml
  security:
    adminKey:
      - 6i5Imo6PwzKOmd0O5x2he3Oo1yeFVkL0czq+TRtwJm0=
      - ""
      - ""
    privateKey: "base64:IKhkOAphNZr4U948HkKx+J09hK7BHCAFvvQVICwBkEc="
    publicKey: "base64:r7O4pSccIMGXCUlCJFJUfxlUtvnNF2+nyADtGj8i9C8="
    serialEnabled: true
```

---

## Requisiti ESATTI (non negoziabili)
1) `adminKey` deve essere una lista di **3 elementi**:
- primo: `base64:<valore>` (senza virgolette)
- secondo/terzo: **esattamente** `'base64:'` (single-quoted)

2) Le righe `- ...` devono essere **allineate** con `adminKey:` (niente indent extra).
Quindi:
```yaml
    adminKey:
    - base64:...
```
e NON:
```yaml
    adminKey:
      - base64:...
```

3) `privateKey` / `publicKey` devono essere **plain scalar** (non tra virgolette):
```yaml
    privateKey: base64:....
```

---

## Implementazione consigliata (robusta, 1:1 col CLI)
### A) Genera i valori corretti (dati)
- `adminKey` (3 entries):
  - se hai 1 chiave: `[b64(k0), "base64:", "base64:"]`
  - se ne hai 0: `["base64:", "base64:", "base64:"]`
- `privateKey`, `publicKey`: sempre `base64:<...>` (anche vuoto, se esiste nel CLI)

### B) Non fidarti del serializer: patcha il BLOCCO `security` dopo il dump
Questo evita guerre infinite con opzioni YAML diverse.

#### 1) Costruisci il blocco `security` come stringa
```ts
function securityBlockCLI(sec: {
  adminKey0?: string; // già SENZA prefisso base64:
  privateKey?: string; // già SENZA prefisso base64:
  publicKey?: string;  // già SENZA prefisso base64:
  serialEnabled: boolean;
}) {
  const k0 = sec.adminKey0 ? `base64:${sec.adminKey0}` : "base64:";
  const priv = sec.privateKey ? `base64:${sec.privateKey}` : "base64:";
  const pub  = sec.publicKey  ? `base64:${sec.publicKey}`  : "base64:";

  // NOTA: le 3 righe list devono stare alla STESSA indent di `adminKey:`
  return [
    "  security:",
    "    adminKey:",
    `    - ${k0}`,
    "    - 'base64:'",
    "    - 'base64:'",
    `    privateKey: ${priv}`,
    `    publicKey: ${pub}`,
    `    serialEnabled: ${sec.serialEnabled ? "true" : "false"}`,
    "" // newline finale per comodità
  ].join("\n");
}
```

#### 2) Sostituisci il blocco `security` nel YAML completo
```ts
yamlText = yamlText.replace(
  /^  security:\n[\s\S]*?(?=^location:)/m,
  securityBlockCLI(securityData)
);
```
- Matcha tutto da `  security:` fino a prima di `location:` (top-level)
- Inserisce esattamente il testo in stile CLI

---

## Nota: perché `'base64:'` è quotato nel CLI?
Perché `base64:` termina con `:` e PyYAML tende a quotarlo per sicurezza.
Per “identico al CLI”, dobbiamo replicarlo *uguale*.

---

## Checklist finale
- [ ] `adminKey` include prefisso `base64:` anche nel primo valore
- [ ] valori vuoti NON sono `""` ma `'base64:'`
- [ ] niente virgolette su `privateKey/publicKey`
- [ ] indent delle linee `- ...` uguale al CLI (senza 2 spazi extra)
- [ ] ordine: adminKey → privateKey → publicKey → serialEnabled

Fine.
