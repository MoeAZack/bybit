#!/usr/bin/env bash
# Deploy moeby to Cloud Run.
#
# Secrets live in Secret Manager, not in --set-env-vars: anyone with project viewer can run
# `gcloud run services describe` and read env vars back in plaintext.
#
# Usage:  PROJECT_ID=your-project ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-moeby}"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com

# --- Secrets -----------------------------------------------------------------
# Create once; rerunning add-version rotates the value.
ensure_secret() {
  local name="$1"
  gcloud secrets describe "$name" >/dev/null 2>&1 || \
    gcloud secrets create "$name" --replication-policy=automatic >/dev/null
}

# Generates a value only when the secret has no versions yet, so reruns never rotate
# a token out from under a running EA.
ensure_generated_secret() {
  local name="$1"
  ensure_secret "$name"
  if ! gcloud secrets versions list "$name" --limit=1 --format='value(name)' | grep -q .; then
    # tr must strip \r too: openssl emits CRLF on Git Bash, and a trailing carriage
    # return silently becomes part of the token.
    openssl rand -base64 32 | tr -d '\r\n' | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "generated a random value for $name"
  fi
}

# The server fails closed without these, so they must hold a value before it will serve.
ensure_generated_secret API_AUTH_TOKEN
ensure_generated_secret MT5_BRIDGE_TOKEN

# Yours to supply — this one can't be invented:
#   printf '%s' 'THE_KEY' | gcloud secrets versions add GEMINI_API_KEY --data-file=-
ensure_secret GEMINI_API_KEY
if ! gcloud secrets versions list GEMINI_API_KEY --limit=1 --format='value(name)' | grep -q .; then
  printf 'placeholder' | gcloud secrets versions add GEMINI_API_KEY --data-file=- >/dev/null
  echo "GEMINI_API_KEY set to a placeholder — AI routes stay disabled until you add the real key"
fi

# Runtime identity: a dedicated SA, not the default compute SA (which is project Editor).
SA="${SERVICE}-run@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SERVICE}-run" --display-name="${SERVICE} Cloud Run runtime"
fi
# A freshly created service account is not immediately visible to IAM elsewhere, so
# bindings can 400 with "does not exist" for a few seconds. Retry rather than fail.
bind_secret() {
  local s="$1"
  for attempt in 1 2 3 4 5 6 7 8; do
    if gcloud secrets add-iam-policy-binding "$s" \
         --member="serviceAccount:${SA}" \
         --role=roles/secretmanager.secretAccessor >/dev/null 2>&1; then
      return 0
    fi
    echo "  waiting for IAM to see ${SA} (attempt ${attempt})"
    sleep 5
  done
  echo "ERROR: could not bind ${SA} to secret ${s}" >&2
  return 1
}
for s in API_AUTH_TOKEN MT5_BRIDGE_TOKEN GEMINI_API_KEY; do
  bind_secret "$s"
done

# --- Cloud Build permissions -------------------------------------------------
# `run deploy --source` builds via Cloud Build as the default compute SA. New projects no
# longer get the automatic role grants, so that SA cannot read the source bucket it was
# just handed. Grant the builder role explicitly.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for role in roles/cloudbuild.builds.builder roles/logging.logWriter roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA}" --role="$role" \
    --condition=None >/dev/null 2>&1 || echo "  warn: could not grant $role to $BUILD_SA"
done

# The runtime SA is deployed by you, so your account must be allowed to act as it.
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="user:$(gcloud config get-value account 2>/dev/null)" \
  --role=roles/iam.serviceAccountUser >/dev/null 2>&1 || true

# --- Deploy ------------------------------------------------------------------
# --max-instances=1 is load-bearing, not tuning: db.json is per-instance file state, so a
# second instance means two divergent copies of your positions.
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=1 \
  --cpu=1 --memory=1Gi \
  --no-cpu-throttling \
  --timeout=300 \
  --set-env-vars=NODE_ENV=production,DISABLE_API_AUTH="${DISABLE_API_AUTH:-false}" \
  --set-secrets=API_AUTH_TOKEN=API_AUTH_TOKEN:latest,MT5_BRIDGE_TOKEN=MT5_BRIDGE_TOKEN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
# --update-env-vars merges; --set-env-vars would replace the list and drop the flags above.
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars=APP_URL="$URL" >/dev/null

echo
echo "Deployed: $URL"

# --- Post-deploy verification ------------------------------------------------
# A revision can go green while the container never serves. Prove it actually answers.
BRIDGE_TOKEN="$(gcloud secrets versions access latest --secret=MT5_BRIDGE_TOKEN)"
API_TOKEN="$(gcloud secrets versions access latest --secret=API_AUTH_TOKEN)"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo
if [ "${DISABLE_API_AUTH:-false}" = "true" ]; then
  echo "  MODE: DISABLE_API_AUTH=true — /api/* is intentionally open (demo only)."
  echo "  unauthenticated /api/settings:  $(code "$URL/api/settings")   (expect 200 — open by choice)"
else
  echo "  MODE: API auth enforced."
  echo "  forged same-origin header:      $(code -H 'sec-fetch-site: same-origin' "$URL/api/settings")   (expect 401)"
  echo "  unauthenticated /api/settings:  $(code "$URL/api/settings")   (expect 401)"
  echo "  api with token:                 $(code -H "x-api-token: $API_TOKEN" "$URL/api/settings")   (expect 200)"
fi
echo "  dashboard reachable:            $(code "$URL/")   (expect 200)"
echo "  bridge without token:           $(code "$URL/bridge/commands")   (expect 401)"
echo "  bridge with token:              $(code -H "x-bridge-token: $BRIDGE_TOKEN" "$URL/bridge/commands")   (expect 200)"
echo
echo "Next: put $URL in the EA's InpBridgeUrl, add it to MT5's WebRequest allowlist"
echo "(Tools > Options > Expert Advisors > Allow WebRequest for listed URL), and read the"
echo "bridge token with:  gcloud secrets versions access latest --secret=MT5_BRIDGE_TOKEN"
