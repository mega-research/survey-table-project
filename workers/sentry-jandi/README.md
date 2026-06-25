# Sentry to JANDI Worker

Cloudflare Worker that receives Sentry Issue Alert webhooks and forwards concise runtime-error notifications to a JANDI Incoming Webhook.

## Required Secrets

- `JANDI_WEBHOOK_URL`: JANDI Incoming Webhook URL.
- `SENTRY_CLIENT_SECRET`: Client Secret from the Sentry Internal Integration credentials.

Set production secrets:

```bash
pnpm dlx wrangler@4 secret put JANDI_WEBHOOK_URL --config workers/sentry-jandi/wrangler.jsonc
pnpm dlx wrangler@4 secret put SENTRY_CLIENT_SECRET --config workers/sentry-jandi/wrangler.jsonc
```

For local development, copy `workers/sentry-jandi/.dev.vars.example` to
`workers/sentry-jandi/.dev.vars` and replace the values:

```env
JANDI_WEBHOOK_URL="https://wh.jandi.com/connect-api/webhook/..."
SENTRY_CLIENT_SECRET="replace-with-sentry-internal-integration-client-secret"
```

`workers/sentry-jandi/.dev.vars` is ignored by git.

## Local Dev

```bash
pnpm worker:sentry-jandi:dev
```

Test a local request:

```bash
BODY='{"data":{"level":"error","metadata":{"type":"ReferenceError","value":"heck is not defined"},"project":"survey-table-project"}}'
SENTRY_CLIENT_SECRET="replace-with-sentry-internal-integration-client-secret"
SIGNATURE=$(BODY="$BODY" SENTRY_CLIENT_SECRET="$SENTRY_CLIENT_SECRET" node -e 'const crypto = require("node:crypto"); process.stdout.write(crypto.createHmac("sha256", process.env.SENTRY_CLIENT_SECRET).update(process.env.BODY, "utf8").digest("hex"));')

curl -X POST "http://localhost:8787/sentry" \
  -H "Sentry-Hook-Signature: $SIGNATURE" \
  -H "Content-Type: application/json" \
  --data "$BODY"
```

## Deploy

```bash
pnpm worker:sentry-jandi:deploy
```

## Sentry Alert Rule

In Sentry, create an Internal Integration, enable it as an Alert Rule Action, and set the Webhook URL to:

```text
https://<worker-subdomain>.workers.dev/sentry
```

After saving the integration, copy its Client Secret into the Worker `SENTRY_CLIENT_SECRET` secret. Then create an Issue Alert Rule and choose the internal integration as the notification action.

The Worker verifies Sentry's `Sentry-Hook-Signature` header before parsing or forwarding the alert.
