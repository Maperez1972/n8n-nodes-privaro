# n8n-nodes-privaro

Community node for [n8n](https://n8n.io) that connects to [Privaro](https://privaro.ai) — the AI privacy governance layer for regulated enterprises (legal, fintech, healthcare, AI agents).

Use it to **detect PII**, **tokenize prompts** before they reach any LLM, run **protected chat completions**, and **reverse tokens back to their real values** — all from inside your n8n workflows.

- 📦 npm: `n8n-nodes-privaro`
- 🌐 Website: <https://privaro.ai>
- 🐛 Issues: <https://github.com/Maperez1972/n8n-nodes-privaro/issues>

---

## Table of contents

1. [Install](#install)
2. [Credentials](#credentials)
3. [Operations](#operations)
   - [Detect](#1-detect)
   - [Protect](#2-protect)
   - [Chat Completion (Relay)](#3-chat-completion-relay)
   - [Detokenize](#4-detokenize)
4. [Understanding tokens and Conversation ID](#understanding-tokens-and-conversation-id)
5. [Full example workflow](#full-example-workflow)
6. [Troubleshooting](#troubleshooting)
7. [Verified against](#verified-against)
8. [Security notes](#security-notes)
9. [Support](#support)

---

## Install

### From the n8n UI (Cloud & self-hosted)

**Settings → Community Nodes → Install** → package name `n8n-nodes-privaro` → confirm.

> Requires n8n `>= 1.0` and the environment variable `N8N_COMMUNITY_PACKAGES_ENABLED=true` on self-hosted instances.

### From npm (self-hosted)

```bash
cd ~/.n8n
npm install n8n-nodes-privaro
# restart n8n
```

### From source (contributors)

```bash
git clone https://github.com/Maperez1972/n8n-nodes-privaro
cd n8n-nodes-privaro
npm install
npm run build
npm link
cd ~/.n8n && npm link n8n-nodes-privaro
```

---

## Credentials

Create a credential of type **Privaro API**.

| Field | Required | Description |
|---|---|---|
| `API Key` | ✅ | Generated in **Privaro → Admin → API Keys**. Format `prvr_` followed by 40 hex characters. Sent as the `X-Privaro-Key` header — **not** a Bearer token, this is Privaro's actual auth scheme. |
| `Base URL` | ❌ | Defaults to `https://api.privaro.ai`. Override for self-hosted or VPC deployments. |

There is no dedicated "test credential" button on this node. Privaro's proxy has no endpoint that validates just an API key without also requiring a real `pipeline_id` — every real endpoint needs one, so a synthetic test would either need a placeholder pipeline (giving a confusing 404 for a *valid* key) or wouldn't prove anything real. The credential is validated the first time you actually run a node with it.

---

## Operations

All four operations authenticate with your Privaro API key (`X-Privaro-Key`) — this is an **organization-level** key, not tied to a specific human user, so there's no operation here that requires a password or a human login session (Privaro's dashboard does have a password-gated "reveal a single token" flow for admins, but that's a separate, human-only mechanism not reachable with an API key — see [Detokenize](#4-detokenize) for the API-key equivalent).

### 1. Detect

Scan text and return the entities Privaro found. **Nothing is masked, tokenized, or stored** — pure inspection.

**Endpoint:** `POST /v1/proxy/detect`

#### Inputs

| Field | Required | Notes |
|---|---|---|
| Pipeline ID | ✅ | Find it in Privaro → Pipelines. |
| Text | ✅ | The content to scan. |
| Include Detections in Output | ❌ | Default `true`. |

#### Example output

```json
{
  "request_id": "req_a1b2c3d4e5f6",
  "detections": [
    { "type": "full_name", "severity": "low", "action": "detected", "token": null, "start": 11, "end": 21, "confidence": 0.8, "detector": "regex", "regulation_ref": "GDPR Art.88" },
    { "type": "email", "severity": "high", "action": "detected", "token": null, "start": 25, "end": 40, "confidence": 0.99, "detector": "regex", "regulation_ref": null }
  ],
  "stats": {
    "total_detected": 2,
    "total_masked": 0,
    "leaked": 0,
    "coverage_pct": 0.0,
    "processing_ms": 340,
    "by_type": { "full_name": 1, "email": 1 }
  }
}
```

Entity types include (not exhaustive): `full_name`, `email`, `phone`, `dni`, `iban`, `credit_card`, `health_record`, `ip_address`, `date_of_birth`, `money` (commercial amounts, e.g. `45.200 €`), and any custom types your org has configured (Privaro → Policies).

---

### 2. Protect

Replace detected entities with **reversible tokens** (`[NM-0001]`, `[EM-0001]`, `[MN-0001]`, …) so the sanitized text can safely be sent to any external LLM. Original values are encrypted (AES-256-GCM) inside Privaro's token vault.

**Endpoint:** `POST /v1/proxy/protect`

#### Inputs

| Field | Required | Notes |
|---|---|---|
| Pipeline ID | ✅ | |
| Text | ✅ | |
| Reversible | ❌ | Default `true`. See [Conversation ID](#understanding-tokens-and-conversation-id) below — this changes whether Conversation ID is required. |
| Conversation ID | **Conditional** | **Required if Reversible is true** (the default). Must be a real UUID. Optional if Reversible is false. |
| Include Detections in Output | ❌ | Default `true`. |

#### Example output

```json
{
  "request_id": "req_cb8c2aacaf56",
  "protected_prompt": "El cliente [NM-0001] tiene un saldo de [MN-0001]",
  "detections": [
    { "type": "full_name", "severity": "low", "action": "tokenised", "token": "[NM-0001]", "start": 11, "end": 27, "confidence": 0.8, "detector": "regex", "regulation_ref": "GDPR Art.88" },
    { "type": "money", "severity": "medium", "action": "tokenised", "token": "[MN-0001]", "start": 46, "end": 54, "confidence": 0.85, "detector": "regex", "regulation_ref": null }
  ],
  "stats": { "total_detected": 2, "total_masked": 2, "leaked": 0, "coverage_pct": 100.0, "processing_ms": 267, "risk_score": 0.425 },
  "audit_log_id": "17607755-e482-493a-b816-4ff9be61f770",
  "gdpr_compliant": true,
  "degraded_mode": false,
  "degraded_reason": null
}
```

If a policy blocks a specific entity rather than tokenizing it, that span becomes `[BLOCKED:TYPE]` in `protected_prompt` (e.g. `[BLOCKED:HEALTH_RECORD]`) instead of a reversible token.

---

### 3. Chat Completion (Relay)

One-shot: Privaro tokenizes your messages, forwards them to the pipeline's configured LLM provider, optionally reveals real values back in the response, and logs everything.

**Endpoint:** `POST /v1/relay/complete`

#### Inputs

| Field | Required | Notes |
|---|---|---|
| Pipeline ID | ✅ | |
| Messages | ✅ | JSON array, `{ role, content }` — same shape as OpenAI's chat format. |
| Provider Override | ❌ | Overrides the pipeline's configured provider for this call only. |
| Model Override | ❌ | Overrides the pipeline's configured model for this call only. |
| Conversation ID | ❌ | If omitted, tokens generated for this call are **never persisted** — the response is still detokenized in this same call (per Detokenize Response below), but you can't reverse anything from it later via a separate call. |
| Detokenize Response | ❌ | Default `true` — reveals real values in the assistant's reply rather than leaving tokens visible. |

#### Example output

```json
{
  "request_id": "req_9f8a7b6c5d4e",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "protected_messages": [ { "role": "system", "content": "..." }, { "role": "user", "content": "El cliente [NM-0001] reporta un cobro duplicado" } ],
  "pii_detected": 1,
  "pii_masked": 1,
  "risk_score": 0.3,
  "gdpr_compliant": true,
  "response": "Confirmo que el cargo duplicado de Juan Pérez ha sido revertido.",
  "audit_log_id": "e17908ab-c5e7-4533-b767-affbb21ac628",
  "tokens_replaced": 1,
  "usage": { "prompt_tokens": 128, "completion_tokens": 42, "total_tokens": 170 },
  "processing_ms": 890
}
```

---

### 4. Detokenize

Find every Privaro-format token (`[XX-0001]`) in a piece of text and reverse all of them back to their real values in one call — no password, no human login. This is the machine-to-machine equivalent of Privaro's dashboard "reveal a token" flow, designed for agentic workflows: e.g. your LLM decides (via function calling) to write a real record somewhere, and you need the real values back automatically before that write happens.

**Endpoint:** `POST /v1/proxy/detokenize`

#### Inputs

| Field | Required | Notes |
|---|---|---|
| Pipeline ID | ✅ | |
| Text | ✅ | Text containing 0 or more tokens. |
| Conversation ID | ✅ **Always required** | Must be the exact same UUID used in the Protect (or Chat Completion) call that generated these tokens — see below for why. |

#### Example output

```json
{
  "request_id": "req_999c63f1faf9",
  "detokenized_text": "El cliente Juan García Ruiz tiene un saldo de 12.500 €",
  "tokens_reversed": 2,
  "tokens_not_found": []
}
```

`tokens_not_found` lists any well-formed token present in the text that couldn't be resolved for your organization (e.g. the LLM hallucinated a token, or it belongs to a different conversation).

---

## Understanding tokens and Conversation ID

This is not boilerplate — it reflects a real bug found and fixed on 2026-07-24: **a token's literal string (e.g. `[NM-0001]`) is not unique within your organization over time.** It's just a per-request counter that restarts at `0001` on every single Protect/Chat Completion call. A busy organization can easily accumulate dozens of unrelated rows sharing the exact same token string.

That means Detokenize genuinely cannot know which real value `[NM-0001]` refers to unless you tell it which conversation it came from — which is why **Conversation ID is mandatory on Detokenize**, and mandatory on Protect whenever Reversible is true (the default). Generate one UUID per logical interaction (a **Crypto** node or a `{{ $workflow.id }}-{{ $execution.id }}`-derived UUID both work) and reuse it across the Protect/Chat Completion call and any later Detokenize call for that same interaction.

If your workflow is triggered by something other than an interactive chat (e.g. a scheduled or webhook-triggered automation with no natural "conversation"), generate a UUID per workflow run rather than reusing a single fixed value — reusing one fixed ID across unrelated runs recreates exactly the ambiguity this field exists to prevent.

---

## Full example workflow

**Support ticket triage — tokenize → GPT-4o-mini → respond**

```text
Webhook (New Ticket)
    → Privaro (Protect)
    → Privaro (Chat Completion — Relay)
    → Respond to Webhook
```

The ready-to-import JSON lives in [`examples/support-triage.json`](./examples/support-triage.json).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401` on any call | Wrong or revoked API key | Regenerate the key in Privaro → Admin → API Keys. Double-check it's sent as `X-Privaro-Key`, not `Authorization: Bearer` — this node's credential does that automatically, but if you're calling the API directly elsewhere, that's the usual mistake. |
| `404 pipeline_not_found` | `pipelineId` doesn't exist, or doesn't belong to your org | Copy a real pipeline ID from Privaro → Pipelines. |
| `422` — `conversation_id` validation error | Conversation ID isn't a valid UUID, or is missing where required (Reversible=true on Protect, or any Detokenize call) | Generate a real UUID — a plain string like `"session-1"` is rejected. |
| `tokens_reversed: 0` with everything listed in `tokens_not_found` | Conversation ID doesn't match the one used when the tokens were created | Use the exact same Conversation ID across the Protect/Chat Completion call and the later Detokenize call. |
| A specific entity shows as `[BLOCKED:TYPE]` instead of a token | A policy rule for that entity type resolves to "block", not "tokenise" | Check Privaro → Policies for that pipeline; this is expected behavior for high-risk entities your org has chosen to block outright. |
| Community node not visible after install | `N8N_COMMUNITY_PACKAGES_ENABLED` not set | Set it to `true` and restart n8n. |
| `ECONNREFUSED` from self-hosted n8n | Wrong `Base URL` | Use `https://…`, verify DNS from the n8n container. |

---

## Verified against

Every endpoint, field name, and example response in this README was checked directly against the real proxy source (not assumed from a generic REST convention):

- `/v1/proxy/detect`, `/v1/proxy/protect` — `app/routers/proxy.py`, `app/models/schemas.py` (`ProtectRequest`/`ProtectResponse`/`DetectRequest`/`DetectResponse`)
- `/v1/relay/complete` — `app/routers/relay.py` (`RelayRequest`/`RelayResponse`/`RelayMessage`/`RelayOptions`)
- `/v1/proxy/detokenize` — `app/routers/proxy.py`, `app/models/schemas.py` (`DetokenizeRequest`/`DetokenizeResponse`)
- Auth mechanism (`X-Privaro-Key`) — `app/services/auth.py` (`verify_api_key_or_dev`)

If Privaro's API changes, this README can drift — please open an issue if something here stops matching reality.

---

## Security notes

- API keys are transmitted as `X-Privaro-Key` over TLS only.
- Provider keys (OpenAI, Anthropic, …) are configured and stored encrypted at rest **inside Privaro** (Admin → Providers/Pipelines) — never paste them into n8n directly, and this node has no field for them.
- `conversation_id` values are just UUIDs used for token-scoping; they carry no PII themselves.

---

## Support

- Website: <https://privaro.ai>
- Status: <https://status.privaro.ai>
- Email: `contact@privaro.ai`

MIT © iCommunity Labs
