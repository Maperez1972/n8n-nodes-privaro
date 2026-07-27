import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Privaro node for n8n.
 *
 * Every endpoint, field name, and auth mechanism below was verified
 * directly against the real Privaro proxy (privaro-proxy, FastAPI/Python)
 * on 2026-07-24 -- not assumed from a generic REST API convention. See the
 * README's "Verified against" section for exactly which source files were
 * checked for each operation.
 */
export class Privaro implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Privaro',
		name: 'privaro',
		icon: 'file:privaro.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Detect, tokenize, and safely relay PII-containing text through Privaro before it reaches any LLM',
		defaults: { name: 'Privaro' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'privaroApi', required: true }],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: { 'Content-Type': 'application/json' },
		},
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'protect',
				options: [
					{
						name: 'Detect',
						value: 'detect',
						description: 'Scan text and return the PII entities found -- nothing is masked or stored',
						action: 'Detect PII in text',
					},
					{
						name: 'Protect',
						value: 'protect',
						description: 'Replace detected PII with reversible tokens (e.g. [NM-0001]) so the text is safe to send to an LLM',
						action: 'Protect (tokenize) text',
					},
					{
						name: 'Chat Completion (Relay)',
						value: 'relay',
						description: 'Tokenize a chat conversation, forward it to the configured LLM provider, and return the response',
						action: 'Run a protected chat completion',
					},
					{
						name: 'Detokenize',
						value: 'detokenize',
						description: 'Reverse every Privaro token found in a piece of text back to its real value',
						action: 'Detokenize text',
					},
				],
			},

			// ── pipeline_id (all operations) ────────────────────────────────────
			{
				displayName: 'Pipeline ID',
				name: 'pipelineId',
				type: 'string',
				default: '',
				required: true,
				description: 'The Privaro pipeline to use. Find it in Privaro \u2192 Pipelines.',
			},

			// ── Detect ───────────────────────────────────────────────────────────
			{
				displayName: 'Text',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['detect', 'protect'] } },
				description: 'The text to scan',
			},

			// ── Protect ──────────────────────────────────────────────────────────
			{
				displayName: 'Reversible',
				name: 'reversible',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['protect'] } },
				description:
					'Whether tokens can be reversed later via Detokenize. When true (the default), Conversation ID becomes required -- Privaro cannot safely disambiguate a token like [NM-0001] later without it, since that literal string is reused as a per-request counter across unrelated calls over time.',
			},
			{
				displayName: 'Conversation ID',
				name: 'conversationId',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['protect'], reversible: [true] } },
				required: true,
				description:
					'A UUID identifying this conversation/session (generate one per logical interaction, e.g. with a Crypto/UUID node upstream). Required when Reversible is true. Must be a real UUID -- a plain string is rejected by the API.',
			},
			{
				displayName: 'Conversation ID',
				name: 'conversationIdOptional',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['protect'], reversible: [false] } },
				description: 'Optional when Reversible is false, since nothing gets persisted to reverse later.',
			},

			// ── Relay (Chat Completion) ──────────────────────────────────────────
			{
				displayName: 'Messages',
				name: 'messages',
				type: 'json',
				default: '[\n  { "role": "system", "content": "You are a support agent." },\n  { "role": "user", "content": "" }\n]',
				displayOptions: { show: { operation: ['relay'] } },
				required: true,
				description: 'Array of { role, content } messages, same shape as the OpenAI chat format',
			},
			{
				displayName: 'Provider Override',
				name: 'provider',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['relay'] } },
				description: 'Optional. Overrides the pipeline\'s configured LLM provider for this call only.',
			},
			{
				displayName: 'Model Override',
				name: 'model',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['relay'] } },
				description: 'Optional. Overrides the pipeline\'s configured model for this call only.',
			},
			{
				displayName: 'Conversation ID',
				name: 'relayConversationId',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['relay'] } },
				description:
					'Optional. If omitted, tokens generated for this call are never persisted to tokens_vault -- the response is still detokenized in this same call (via Detokenize Response, below), but you won\u2019t be able to reverse anything from it later (e.g. via a separate Detokenize call). Provide a UUID if you need that.',
			},
			{
				displayName: 'Detokenize Response',
				name: 'detokeniseResponse',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['relay'] } },
				description: 'Whether to reveal real values back in the assistant\'s reply (recommended for most chat use cases) rather than leaving tokens like [NM-0001] in the visible response',
			},

			// ── Detokenize ───────────────────────────────────────────────────────
			{
				displayName: 'Text',
				name: 'detokenizeText',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['detokenize'] } },
				description: 'Text containing one or more Privaro tokens (e.g. [NM-0001]) to reverse',
			},
			{
				displayName: 'Conversation ID',
				name: 'detokenizeConversationId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['detokenize'] } },
				description:
					'Required -- must be the exact same UUID used in the Protect (or Chat Completion) call that generated these tokens. Without it there is no reliable way to know which of possibly many historical rows sharing the same token string is the right one.',
			},

			// ── Advanced (Detect + Protect) ──────────────────────────────────────
			{
				displayName: 'Include Detections in Output',
				name: 'includeDetections',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['detect', 'protect'] } },
				description: 'Whether to include the full per-entity detections array in the output, not just the aggregate stats',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const pipelineId = this.getNodeParameter('pipelineId', i) as string;
				let endpoint = '';
				let body: IDataObject = {};

				if (operation === 'detect') {
					const includeDetections = this.getNodeParameter('includeDetections', i) as boolean;
					endpoint = '/v1/proxy/detect';
					body = {
						pipeline_id: pipelineId,
						prompt: this.getNodeParameter('prompt', i) as string,
						options: { include_detections: includeDetections },
					};
				} else if (operation === 'protect') {
					const reversible = this.getNodeParameter('reversible', i) as boolean;
					const includeDetections = this.getNodeParameter('includeDetections', i) as boolean;
					const conversationId = reversible
						? (this.getNodeParameter('conversationId', i) as string)
						: (this.getNodeParameter('conversationIdOptional', i) as string);
					endpoint = '/v1/proxy/protect';
					body = {
						pipeline_id: pipelineId,
						prompt: this.getNodeParameter('prompt', i) as string,
						options: { mode: 'tokenise', include_detections: includeDetections, reversible },
						...(conversationId ? { conversation_id: conversationId } : {}),
					};
				} else if (operation === 'relay') {
					const messagesRaw = this.getNodeParameter('messages', i) as string;
					let messages: unknown;
					try {
						messages = typeof messagesRaw === 'string' ? JSON.parse(messagesRaw) : messagesRaw;
					} catch {
						throw new NodeApiError(this.getNode(), { message: 'Messages must be valid JSON' } as JsonObject);
					}
					const provider = this.getNodeParameter('provider', i) as string;
					const model = this.getNodeParameter('model', i) as string;
					const conversationId = this.getNodeParameter('relayConversationId', i) as string;
					const detokeniseResponse = this.getNodeParameter('detokeniseResponse', i) as boolean;
					endpoint = '/v1/relay/complete';
					body = {
						pipeline_id: pipelineId,
						messages: messages as IDataObject[],
						options: { detokenise_response: detokeniseResponse },
						...(provider ? { provider } : {}),
						...(model ? { model } : {}),
						...(conversationId ? { conversation_id: conversationId } : {}),
					};
				} else if (operation === 'detokenize') {
					endpoint = '/v1/proxy/detokenize';
					body = {
						pipeline_id: pipelineId,
						text: this.getNodeParameter('detokenizeText', i) as string,
						conversation_id: this.getNodeParameter('detokenizeConversationId', i) as string,
					};
				}

				const response = await this.helpers.httpRequestWithAuthentication.call(this, 'privaroApi', {
					method: 'POST',
					url: endpoint,
					body,
					json: true,
				});

				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
