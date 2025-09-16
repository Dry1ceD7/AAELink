#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Configuration
PG_HOST="postgres"
PG_PORT="5432"
PG_USER="aaelink"
PG_DB="aaelink_db"
BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${PG_DB}_backup_${TIMESTAMP}.sql.gz"
FILE_PATH="${BACKUP_DIR}/${FILENAME}"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "Starting database backup..."

# Perform the backup
pg_dump -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" -F c -b -v | gzip > "${FILE_PATH}"

echo "Database backup successful: ${FILE_PATH}"

# Optional: Clean up old backups (e.g., older than 30 days)
if [ ! -z "${BACKUP_RETENTION_DAYS}" ]; then
  echo "Cleaning up backups older than ${BACKUP_RETENTION_DAYS} days..."
  find "${BACKUP_DIR}" -type f -name "*.sql.gz" -mtime "+${BACKUP_RETENTION_DAYS}" -exec rm {} \;
  echo "Cleanup complete."
fi

# Optional: Upload to S3
if [ ! -z "${AWS_S3_BUCKET}" ]; then
  echo "Uploading backup to S3 bucket: ${AWS_S3_BUCKET}"
  aws s3 cp "${FILE_PATH}" "s3://${AWS_S3_BUCKET}/db_backups/${FILENAME}"
  echo "Upload complete."
fi

echo "Backup process finished."
