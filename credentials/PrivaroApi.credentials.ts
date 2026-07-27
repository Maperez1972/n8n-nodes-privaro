import type {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PrivaroApi implements ICredentialType {
	name = 'privaroApi';
	displayName = 'Privaro API';
	documentationUrl = 'https://github.com/Maperez1972/n8n-nodes-privaro#credentials';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your organization\'s Privaro API key, format prvr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx. Generate one in Privaro \u2192 Admin \u2192 API Keys.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.privaro.ai',
			description: 'Override for self-hosted or VPC deployments of the Privaro proxy.',
		},
	];

	// Privaro authenticates via the X-Privaro-Key header -- NOT a Bearer
	// token. Verified directly against the real proxy (app/services/auth.py,
	// verify_api_key_or_dev) throughout 2026-07-24's session, including
	// dozens of real requests made against production. Using n8n's generic
	// authenticate mechanism (rather than setting the header manually inside
	// the node) satisfies the community-node lint rule
	// no-http-request-with-manual-auth.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-Privaro-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// Deliberately no `test` property here. Verified against the real proxy:
	// there is no endpoint that validates just the API key without also
	// requiring a real, existing pipeline_id (every proxy endpoint needs
	// one). A fake pipeline_id would correctly 404 even with a perfectly
	// valid key -- n8n's credential test UI expects 2xx for success, so a
	// synthetic test here would show "failed" for a working credential,
	// which is worse than no test at all. See the README's Troubleshooting
	// section for how to verify a key manually.
}
