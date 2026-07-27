# n8n.io/workflows submission — Privaro Support Triage

Copy-paste this metadata into the "Publish workflow" form at <https://n8n.io/workflows/new/>.
File to upload: `examples/support-triage.json`.

---

## Title (max 70 chars)

Protect support tickets with Privaro before sending them to GPT-4o-mini

## Short description (max 160 chars, shown in listings)

Tokenize PII in incoming support tickets with Privaro, run a GPT-4o-mini triage via Privaro's protected relay, and reply. Zero raw PII leaves your stack.

## Categories

- AI
- Security
- Customer Support

## Tags

`privacy`, `pii`, `gdpr`, `tokenization`, `openai`, `gpt-4o`, `compliance`, `ai-governance`, `support-automation`, `webhook`

## Cover image

Privaro logo on a dark background (see the icon at `nodes/Privaro/privaro.svg`, or use the wordmark from privaro.ai).

## Long description (Markdown, shown on the workflow page)

### What this workflow does

Incoming support tickets almost always contain PII: names, emails, phone numbers, order IDs, sometimes even IBANs or amounts. Sending that raw content to an LLM breaks GDPR and exposes you to real audit risk.

This workflow puts **[Privaro](https://privaro.ai)** — an AI privacy governance layer — between your webhook and OpenAI. It:

1. Receives a support ticket via **Webhook**.
2. Generates a Conversation ID (a UUID) so the tokens created in this run can be safely reversed later if needed.
3. Sends the ticket body to **Privaro → Protect**, which detects PII and returns a tokenized version (e.g. `Juan Pérez` → `[NM-0001]`, `juan@acme.com` → `[EM-0001]`).
4. Forwards the sanitized prompt to **GPT-4o-mini** through **Privaro → Chat Completion (Relay)**, which reveals real values back in the model's reply.
5. Responds to the webhook with the final message, the computed risk score, and an audit log ID.

Every step is logged in Privaro's audit trail, so you can show a DPO or auditor exactly what data left your perimeter.

### What you need

- An **n8n** instance (Cloud or self-hosted) with the community node `n8n-nodes-privaro` installed. Install via **Settings → Community Nodes → `n8n-nodes-privaro`**.
- A **Privaro** account. Get one at <https://privaro.ai>. Create an API key in **Privaro → Admin → API Keys** and configure your OpenAI provider key **inside Privaro** (not in n8n) so it never touches this workflow directly.
- A **Privaro API** credential in n8n using the key above.
- A real **Pipeline ID** from your Privaro account (Privaro → Pipelines) — set it on both Privaro nodes after importing.

### How to import

1. Download the JSON.
2. In n8n: **Workflows → Import from File** → select the file.
3. Open both **Privaro** nodes: pick your `Privaro API` credential, and paste in a real Pipeline ID.
4. Activate the workflow. Copy the webhook URL and POST a ticket:

```bash
curl -X POST $WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{"message":"El cliente Juan Pérez (juan@acme.com) reporta un cobro duplicado de 240 EUR"}'
```

You'll get back a triaged reply with a real risk score and audit log ID, and you'll see the corresponding events in Privaro → Audit Logs.

### Customize it

- Swap `gpt-4o-mini` for any other provider/model your pipeline supports — set the Provider/Model Override fields on the Chat Completion node.
- Add a policy in Privaro → Policies to block (rather than tokenize) specific entity types outright for this pipeline.
- Add a **Slack** or **Zendesk** node after the response to route triaged tickets to the right team.
- If you later need to reverse tokens from this exact interaction (e.g. in a separate, later workflow), reuse the same `conversation_id` with the **Detokenize** operation.

### Links

- Node: <https://www.npmjs.com/package/n8n-nodes-privaro>
- Website: <https://privaro.ai>
- Status: <https://status.privaro.ai>
- Source: <https://github.com/Maperez1972/n8n-nodes-privaro>
