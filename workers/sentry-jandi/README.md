# Sentry to JANDI Worker

Cloudflare Worker that receives Sentry Issue Alert webhooks and forwards concise runtime-error notifications to a JANDI Incoming Webhook.

## Required Secrets

- `JANDI_WEBHOOK_URL`: JANDI Incoming Webhook URL.
- `SENTRY_WEBHOOK_TOKEN`: Shared secret checked by this Worker before forwarding alerts.

Set production secrets:

```bash
pnpm dlx wrangler@4 secret put JANDI_WEBHOOK_URL --config workers/sentry-jandi/wrangler.jsonc
pnpm dlx wrangler@4 secret put SENTRY_WEBHOOK_TOKEN --config workers/sentry-jandi/wrangler.jsonc
```

For local development, copy `workers/sentry-jandi/.dev.vars.example` to
`workers/sentry-jandi/.dev.vars` and replace the values:

```env
JANDI_WEBHOOK_URL="https://wh.jandi.com/connect-api/webhook/..."
SENTRY_WEBHOOK_TOKEN="replace-with-random-token"
```

`workers/sentry-jandi/.dev.vars` is ignored by git.

## Local Dev

```bash
pnpm worker:sentry-jandi:dev
```

Test a local request:

```bash
curl -X POST "http://localhost:8787/sentry" \
  -H "Authorization: Bearer replace-with-random-token" \
  -H "Content-Type: application/json" \
  --data '{"data":{"level":"error","metadata":{"type":"ReferenceError","value":"heck is not defined"},"project":"survey-table-project"}}'
```

## Deploy

```bash
pnpm worker:sentry-jandi:deploy
```

## Sentry Alert Rule

In Sentry, create an Issue Alert Rule and add a webhook action pointing to:

```text
https://<worker-subdomain>.workers.dev/sentry
```

Prefer sending `Authorization: Bearer <SENTRY_WEBHOOK_TOKEN>` if the Sentry webhook action supports custom headers. If headers are not available, use:

```text
https://<worker-subdomain>.workers.dev/sentry?token=<SENTRY_WEBHOOK_TOKEN>
```
