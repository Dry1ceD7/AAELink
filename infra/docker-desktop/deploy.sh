#!/usr/bin/env bash
#
# deploy.sh — Deploy AAELink infrastructure on Docker Desktop Kubernetes
#
# Prerequisites:
#   1. Docker Desktop with Kubernetes enabled
#   2. kubectl configured to use docker-desktop context
#
# Usage:
#   ./infra/docker-desktop/deploy.sh          # full deploy
#   ./infra/docker-desktop/deploy.sh teardown  # remove everything
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure we're on docker-desktop context
CURRENT_CTX=$(kubectl config current-context 2>/dev/null || echo "none")
if [[ "$CURRENT_CTX" != "docker-desktop" ]]; then
  echo "⚠️  Current kubectl context is '$CURRENT_CTX', expected 'docker-desktop'."
  echo "   Run: kubectl config use-context docker-desktop"
  exit 1
fi

teardown() {
  echo "🗑  Tearing down AAELink infrastructure..."
  kubectl delete -f "$SCRIPT_DIR/stirling-pdf.yaml" --ignore-not-found 2>/dev/null || true
  kubectl delete -f "$SCRIPT_DIR/minio.yaml" --ignore-not-found 2>/dev/null || true
  kubectl delete -f "$SCRIPT_DIR/mattermost.yaml" --ignore-not-found 2>/dev/null || true
  kubectl delete -f "$SCRIPT_DIR/redis.yaml" --ignore-not-found 2>/dev/null || true
  kubectl delete -f "$SCRIPT_DIR/postgres.yaml" --ignore-not-found 2>/dev/null || true
  kubectl delete -f "$SCRIPT_DIR/secrets.yaml" --ignore-not-found 2>/dev/null || true
  kubectl delete -f "$SCRIPT_DIR/namespaces.yaml" --ignore-not-found 2>/dev/null || true
  echo "✅ Teardown complete."
}

deploy() {
  echo "🚀 Deploying AAELink infrastructure on Docker Desktop Kubernetes..."

  # Pre-pull amd64-only images (needed for Apple Silicon)
  echo "📦 Pre-pulling amd64-only images..."
  docker pull --platform linux/amd64 mattermost/mattermost-team-edition:latest 2>/dev/null || true

  # 1. Namespaces
  echo "📁 Creating namespaces..."
  kubectl apply -f "$SCRIPT_DIR/namespaces.yaml"

  # 2. Secrets (use dev secrets if available, otherwise example)
  if [[ -f "$SCRIPT_DIR/secrets.yaml" ]]; then
    echo "🔐 Applying secrets..."
    kubectl apply -f "$SCRIPT_DIR/secrets.yaml"
  else
    echo "⚠️  No secrets.yaml found. Copy secrets.example.yaml to secrets.yaml and fill in values."
    echo "   cp $SCRIPT_DIR/secrets.example.yaml $SCRIPT_DIR/secrets.yaml"
    exit 1
  fi

  # 3. Database layer
  echo "🗄  Deploying PostgreSQL..."
  kubectl apply -f "$SCRIPT_DIR/postgres.yaml"
  echo "🗄  Deploying Redis..."
  kubectl apply -f "$SCRIPT_DIR/redis.yaml"

  # Wait for Postgres
  echo "⏳ Waiting for PostgreSQL to be ready..."
  kubectl wait --for=condition=ready pod -l app=postgres -n mattermost --timeout=120s

  # 4. Application layer
  echo "💬 Deploying Mattermost..."
  kubectl apply -f "$SCRIPT_DIR/mattermost.yaml"
  echo "📦 Deploying MinIO..."
  kubectl apply -f "$SCRIPT_DIR/minio.yaml"
  echo "📄 Deploying Stirling PDF..."
  kubectl apply -f "$SCRIPT_DIR/stirling-pdf.yaml"

  echo ""
  echo "✅ Deployment complete! Services available at:"
  echo "   Mattermost:       http://localhost:30065"
  echo "   MinIO API:        http://localhost:30900"
  echo "   MinIO Console:    http://localhost:30901"
  echo "   Stirling PDF:     http://localhost:30885"
  echo ""
  echo "⏳ Pods may take 1-2 minutes to become ready. Check with:"
  echo "   kubectl get pods -n mattermost"
  echo "   kubectl get pods -n aaelink"
}

case "${1:-deploy}" in
  teardown|down|destroy)
    teardown
    ;;
  deploy|up|*)
    deploy
    ;;
esac
