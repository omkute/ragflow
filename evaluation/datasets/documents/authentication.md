# Authentication

Indexa supports API key authentication. To authenticate, set the `Authorization: Bearer <API_KEY>` header.

## Resetting API tokens

To reset your API token, go to Settings → Security → API Tokens. Click **Reset token**. The old token is revoked immediately and a new token is displayed once. Store it securely.

API tokens are scoped per workspace and expire after 90 days unless refreshed.

## Troubleshooting

If authentication fails with 401, verify the token is not expired and the header is correctly formatted.
