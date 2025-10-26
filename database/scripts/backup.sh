#!/bin/bash

# GUI-LOP Database Backup Script
# Automated backup and recovery procedures for PostgreSQL database
# Week 3, Phase 1 - Database Backup Implementation

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="${PROJECT_ROOT}/database/config/.env"

# Load environment variables
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
fi

# Default values
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-gui_lop}"
DB_USER="${DB_USER:-postgres}"
BACKUP_DIR="${BACKUP_PATH:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILENAME="gui_lop_backup_${TIMESTAMP}.sql"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"
COMPRESSED_BACKUP="${BACKUP_PATH}.gz"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if PostgreSQL tools are available
check_dependencies() {
    log "Checking dependencies..."

    if ! command -v pg_dump &> /dev/null; then
        error "pg_dump is not installed or not in PATH"
        error "Please install PostgreSQL client tools"
        exit 1
    fi

    if ! command -v psql &> /dev/null; then
        error "psql is not installed or not in PATH"
        error "Please install PostgreSQL client tools"
        exit 1
    fi

    if ! command -v gzip &> /dev/null; then
        warning "gzip is not available. Backups will not be compressed."
    fi

    success "All dependencies checked"
}

# Test database connection
test_connection() {
    log "Testing database connection..."

    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' 2>/dev/null; then
        success "Database connection successful"
    else
        error "Cannot connect to database"
        error "Host: $DB_HOST:$DB_PORT"
        error "Database: $DB_NAME"
        error "User: $DB_USER"
        exit 1
    fi
}

# Create backup directory
create_backup_dir() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
        chmod 750 "$BACKUP_DIR"
    fi

    # Ensure directory is writable
    if [[ ! -w "$BACKUP_DIR" ]]; then
        error "Backup directory is not writable: $BACKUP_DIR"
        exit 1
    fi
}

# Create database backup
create_backup() {
    log "Starting database backup..."
    log "Backup file: $BACKUP_FILENAME"

    local dump_opts=(
        "-h" "$DB_HOST"
        "-p" "$DB_PORT"
        "-U" "$DB_USER"
        "-d" "$DB_NAME"
        "--verbose"
        "--no-password"
        "--format=custom"
        "--compress=9"
        "--locks"
        "--exclude-table-data=schema_migrations"  # Exclude migration table
        "--exclude-table-data=audit_logs"         # Exclude audit logs (can be large)
    )

    # Add custom options if specified
    if [[ -n "${BACKUP_CUSTOM_OPTS:-}" ]]; then
        dump_opts+=($BACKUP_CUSTOM_OPTS)
    fi

    log "Executing pg_dump with options: ${dump_opts[*]}"

    # Start timing
    local start_time=$(date +%s)

    # Create the backup
    if PGPASSWORD="$DB_PASSWORD" pg_dump "${dump_opts[@]}" > "$BACKUP_PATH" 2> "${BACKUP_PATH}.log"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        local backup_size=$(du -h "$BACKUP_PATH" | cut -f1)

        success "Backup completed successfully"
        log "Duration: ${duration}s"
        log "Size: $backup_size"
        log "Log file: ${BACKUP_PATH}.log"

        # Compress backup if gzip is available
        if command -v gzip &> /dev/null; then
            log "Compressing backup..."
            gzip "$BACKUP_PATH"
            local compressed_size=$(du -h "$COMPRESSED_BACKUP" | cut -f1)
            log "Compressed size: $compressed_size"
            BACKUP_PATH="$COMPRESSED_BACKUP"
        fi

        # Create backup metadata
        create_backup_metadata "$BACKUP_PATH" "$duration"

    else
        error "Backup failed. Check log file: ${BACKUP_PATH}.log"
        rm -f "$BACKUP_PATH"  # Remove partial backup
        exit 1
    fi
}

# Create backup metadata file
create_backup_metadata() {
    local backup_file="$1"
    local duration="$2"
    local metadata_file="${backup_file}.meta"

    cat > "$metadata_file" << EOF
{
    "backup_filename": "$(basename "$backup_file")",
    "database_name": "$DB_NAME",
    "backup_date": "$(date -Iseconds)",
    "backup_duration_seconds": $duration,
    "backup_size_bytes": $(stat -f%z "$backup_file" 2>/dev/null || stat -c%s "$backup_file" 2>/dev/null || echo "unknown"),
    "postgres_version": "$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT version()" 2>/dev/null | head -n1 | xargs)",
    "schema_version": "$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT MAX(filename) FROM schema_migrations WHERE filename LIKE '%.sql'" 2>/dev/null | xargs || echo "unknown")",
    "backup_type": "full",
    "compression": "$(if [[ "$backup_file" == *.gz ]]; then echo "gzip"; else echo "none"; fi)",
    "hostname": "$(hostname)",
    "user": "$(whoami)"
}
EOF

    log "Backup metadata created: $metadata_file"
}

# Clean up old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."

    local deleted_count=0

    # Find and delete old backup files
    while IFS= read -r -d '' file; do
        log "Deleting old backup: $(basename "$file")"
        rm -f "$file" "${file}.meta" "${file}.log"
        ((deleted_count++))
    done < <(find "$BACKUP_DIR" -name "gui_lop_backup_*.sql*" -type f -mtime +$RETENTION_DAYS -print0 2>/dev/null)

    if [[ $deleted_count -gt 0 ]]; then
        success "Deleted $deleted_count old backup files"
    else
        log "No old backups to delete"
    fi
}

# Verify backup integrity
verify_backup() {
    local backup_file="$1"

    log "Verifying backup integrity: $(basename "$backup_file")"

    # Test if backup can be restored (dry run)
    if [[ "$backup_file" == *.gz ]]; then
        # For compressed backups
        if gunzip -t "$backup_file" 2>/dev/null; then
            success "Backup integrity verified (compressed)"
        else
            error "Backup integrity check failed (compressed)"
            return 1
        fi
    else
        # For uncompressed backups
        if PGPASSWORD="$DB_PASSWORD" pg_restore --list "$backup_file" > /dev/null 2>&1; then
            success "Backup integrity verified"
        else
            error "Backup integrity check failed"
            return 1
        fi
    fi
}

# List available backups
list_backups() {
    log "Available backups in $BACKUP_DIR:"

    if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
        warning "No backups found"
        return
    fi

    printf "%-30s %-15s %-15s %-20s\n" "BACKUP FILE" "SIZE" "DATE" "STATUS"
    printf "%-30s %-15s %-15s %-20s\n" "-------------------------------" "---------------" "---------------" "--------------------"

    find "$BACKUP_DIR" -name "gui_lop_backup_*.sql*" -type f | sort -r | while read -r file; do
        if [[ "$file" == *.meta ]]; then
            continue  # Skip metadata files
        fi

        local filename=$(basename "$file")
        local size=$(du -h "$file" | cut -f1)
        local date=$(stat -f%Sm -t%Y-%m-%d "$file" 2>/dev/null || stat -c%y "$file" 2>/dev/null | cut -d' ' -f1)
        local status="OK"

        # Check if backup is recent (within last 24 hours)
        local file_age=$(( ($(date +%s) - $(stat -f%m -t% s "$file" 2>/dev/null || stat -c%Y "$file" 2>/dev/null)) / 86400 ))
        if [[ $file_age -lt 1 ]]; then
            status="RECENT"
        elif [[ $file_age -gt $RETENTION_DAYS ]]; then
            status="OLD"
        fi

        printf "%-30s %-15s %-15s %-20s\n" "$filename" "$size" "$date" "$status"
    done
}

# Restore from backup
restore_backup() {
    local backup_file="$1"

    if [[ -z "$backup_file" ]]; then
        error "Backup file is required for restore"
        error "Usage: $0 restore <backup_file>"
        exit 1
    fi

    if [[ ! -f "$backup_file" ]]; then
        error "Backup file not found: $backup_file"
        exit 1
    fi

    log "WARNING: This will replace the current database!"
    log "Backup file: $backup_file"
    log "Database: $DB_NAME"
    log "Host: $DB_HOST:$DB_PORT"

    read -p "Are you sure you want to continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log "Restore cancelled"
        exit 0
    fi

    log "Starting database restore..."

    local restore_opts=(
        "-h" "$DB_HOST"
        "-p" "$DB_PORT"
        "-U" "$DB_USER"
        "-d" "$DB_NAME"
        "--verbose"
        "--clean"
        "--if-exists"
        "--no-owner"
        "--no-privileges"
    )

    # Handle compressed backups
    if [[ "$backup_file" == *.gz ]]; then
        log "Restoring from compressed backup..."
        if gunzip -c "$backup_file" | PGPASSWORD="$DB_PASSWORD" pg_restore "${restore_opts[@]}" 2> "${backup_file}.restore.log"; then
            success "Database restore completed successfully"
            log "Restore log: ${backup_file}.restore.log"
        else
            error "Database restore failed. Check log file: ${backup_file}.restore.log"
            exit 1
        fi
    else
        log "Restoring from uncompressed backup..."
        if PGPASSWORD="$DB_PASSWORD" pg_restore "${restore_opts[@]}" "$backup_file" 2> "${backup_file}.restore.log"; then
            success "Database restore completed successfully"
            log "Restore log: ${backup_file}.restore.log"
        else
            error "Database restore failed. Check log file: ${backup_file}.restore.log"
            exit 1
        fi
    fi
}

# Show usage information
show_usage() {
    cat << EOF
GUI-LOP Database Backup Script

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    backup           Create a new database backup
    restore FILE     Restore database from backup file
    list             List available backups
    verify FILE      Verify backup integrity
    cleanup          Remove old backups

Options:
    --config FILE    Use custom configuration file
    --dry-run        Show what would be done without executing
    --verbose        Enable verbose output

Examples:
    $0 backup                                    # Create backup
    $0 restore /backups/gui_lop_backup_20240101.sql.gz  # Restore backup
    $0 list                                      # List backups
    $0 cleanup                                   # Clean old backups

Configuration:
    Set database connection parameters in database/config/.env
    - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
    - BACKUP_PATH, BACKUP_RETENTION_DAYS

EOF
}

# Main execution
main() {
    local command="${1:-backup}"

    # Parse additional arguments
    shift

    case "$command" in
        "backup")
            check_dependencies
            test_connection
            create_backup_dir
            create_backup
            verify_backup "$BACKUP_PATH"
            cleanup_old_backups
            success "Backup process completed successfully"
            ;;

        "restore")
            check_dependencies
            test_connection
            restore_backup "$@"
            ;;

        "list")
            list_backups
            ;;

        "verify")
            if [[ -z "${1:-}" ]]; then
                error "Backup file is required for verification"
                exit 1
            fi
            check_dependencies
            verify_backup "$1"
            ;;

        "cleanup")
            create_backup_dir
            cleanup_old_backups
            ;;

        "help"|"-h"|"--help")
            show_usage
            ;;

        *)
            error "Unknown command: $command"
            echo
            show_usage
            exit 1
            ;;
    esac
}

# Script execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi