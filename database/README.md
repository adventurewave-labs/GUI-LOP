# GUI-LOP Database Implementation

This directory contains the complete PostgreSQL database implementation for the GUI-LOP platform, replacing the in-memory Map storage with persistent database storage.

## Overview

The database implementation provides:

- **Complete PostgreSQL Schema**: Users, roles, permissions, workflows, events, and sessions
- **Migration System**: Version-controlled database schema changes
- **Connection Pooling**: Efficient database connection management
- **Error Handling**: Comprehensive error handling and logging
- **Transaction Management**: Advanced transaction support with isolation levels
- **Backup & Recovery**: Automated backup and recovery procedures
- **Data Seeding**: Default data for development and testing

## Directory Structure

```
database/
├── config/
│   ├── database.js          # Database connection and pooling
│   └── .env.example         # Environment configuration template
├── schemas/
│   └── 01_main_schema.sql   # Complete database schema
├── migrations/
│   ├── 001_initial_migration.sql  # Initial migration
│   └── migrate.js                # Migration runner
├── seeds/
│   ├── 01_default_data.sql  # Default seed data
│   └── seed.js               # Seeding runner
├── scripts/
│   ├── backup.sh             # Backup script (bash)
│   └── restore.js            # Restore script (Node.js)
├── utils/
│   ├── error-handler.js      # Error handling utilities
│   └── transaction-manager.js # Transaction management
└── README.md                 # This file
```

## Quick Start

### 1. Install Dependencies

```bash
npm install pg dotenv
```

### 2. Configure Database

Copy the environment template and configure your database settings:

```bash
cp database/config/.env.example .env
```

Edit `.env` with your PostgreSQL configuration:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gui_lop
DB_USER=postgres
DB_PASSWORD=your_password
```

### 3. Set Up Database

Run migrations and seed data:

```bash
npm run db:migrate
npm run db:seed
```

Or do it all at once:

```bash
npm run db:setup
```

### 4. Start Server

Use the database-integrated server:

```bash
node src/backend/database-server.js
```

Or update the main script in `package.json`:

```json
{
  "main": "src/backend/database-server.js"
}
```

## Available Scripts

The following npm scripts are available for database management:

### Migration Scripts

- `npm run db:migrate` - Run all pending migrations
- `npm run db:migrate:status` - Show migration status

### Seeding Scripts

- `npm run db:seed` - Seed database with default data
- `npm run db:seed:force` - Force reseed even if data exists
- `npm run db:reset` - Reset all data and reseed

### Backup Scripts

- `npm run db:backup` - Create database backup
- `npm run db:restore` - Restore from backup
- `npm run db:list` - List available backups
- `npm run db:verify` - Verify backup integrity

### Utility Scripts

- `npm run db:health` - Check database health status
- `npm run db:setup` - Run migrations and seed data
- `npm run db:setup:dev` - Force setup for development

## Database Schema

### Core Tables

#### Users
- User accounts with authentication and authorization
- Role-based access control
- Session management

#### Workflows
- Workflow definitions and instances
- Status tracking and metadata
- Template relationships

#### Workflow Steps
- Individual workflow steps
- Input/output data
- Status and timing information

#### Events
- Comprehensive audit trail
- System and user events
- Performance metrics

#### Workflow Templates
- Reusable workflow templates
- Configuration and step definitions
- Version control support

### Supporting Tables

- **Roles & Permissions**: Role-based access control
- **Sessions**: User session management
- **Human Responses**: Human-in-the-loop interactions
- **Audit Logs**: Complete change tracking
- **System Configuration**: Runtime configuration
- **API Keys**: API authentication
- **Workflow Metrics**: Performance analytics

### Database Views

- **active_workflows**: Currently active workflows
- **workflow_analytics**: Workflow performance analytics
- **user_activity**: User activity summaries

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | localhost | Database host |
| `DB_PORT` | 5432 | Database port |
| `DB_NAME` | gui_lop | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASSWORD` | - | Database password |
| `DB_SSL` | false | Enable SSL |
| `DB_POOL_MAX` | 20 | Maximum connections |
| `DB_POOL_MIN` | 2 | Minimum connections |

### Connection Pooling

The database uses connection pooling for optimal performance:

- **Maximum Connections**: 20 (configurable)
- **Minimum Connections**: 2 (configurable)
- **Idle Timeout**: 30 seconds
- **Connection Timeout**: 2 seconds
- **Retry Logic**: Automatic retry with exponential backoff

## Error Handling

### Error Types

- **ConnectionError**: Database connection issues
- **QueryError**: SQL query failures
- **TransactionError**: Transaction conflicts
- **ConstraintViolationError**: Data constraint violations
- **MigrationError**: Migration failures

### Error Features

- Automatic error classification
- Detailed error logging
- Retry logic for transient errors
- Sanitized query logging (removes sensitive data)
- Graceful degradation

## Transaction Management

### Isolation Levels

- `READ_UNCOMMITTED`
- `READ_COMMITTED` (default)
- `REPEATABLE_READ`
- `SERIALIZABLE`

### Transaction Features

- Automatic commit/rollback
- Savepoint support
- Nested transaction handling
- Deadlock detection and retry
- Transaction logging

## Backup & Recovery

### Backup Features

- Automated scheduled backups
- Custom backup options
- Compression support
- Metadata tracking
- Integrity verification

### Recovery Features

- Point-in-time recovery
- Test restore capability
- Backup verification
- Rollback support
- Disaster recovery procedures

## Performance Optimization

### Indexing Strategy

- Primary key indexes on all tables
- Foreign key indexes for joins
- Composite indexes for common queries
- Partial indexes for filtered data
- JSONB indexes for document data

### Query Optimization

- Prepared statements
- Connection pooling
- Query result caching
- Slow query logging
- Performance monitoring

## Security

### Data Protection

- Password hashing with bcrypt
- Encrypted sensitive data
- SQL injection prevention
- Input validation
- Audit logging

### Access Control

- Role-based permissions
- API key authentication
- Session management
- Rate limiting
- IP restrictions

## Monitoring & Analytics

### Health Monitoring

- Database connection health
- Connection pool status
- Query performance metrics
- Error rate tracking
- Resource utilization

### Analytics

- Workflow execution metrics
- User activity tracking
- System performance data
- Error pattern analysis
- Growth metrics

## Development Workflow

### Making Schema Changes

1. Create new migration file:
   ```bash
   node database/migrations/migrate.js create add_new_feature
   ```

2. Edit the generated SQL file with your changes

3. Run the migration:
   ```bash
   npm run db:migrate
   ```

### Testing Changes

1. Test with development data:
   ```bash
   npm run db:reset
   ```

2. Verify changes:
   ```bash
   npm run db:health
   ```

3. Test backup/restore:
   ```bash
   npm run db:backup
   npm run db:restore --test
   ```

## Troubleshooting

### Common Issues

**Connection Failed**:
- Check PostgreSQL is running
- Verify connection parameters
- Check network connectivity
- Review firewall settings

**Migration Failed**:
- Check migration SQL syntax
- Verify database permissions
- Review constraint dependencies
- Check for data conflicts

**Performance Issues**:
- Check slow query logs
- Review indexing strategy
- Monitor connection pool usage
- Analyze query execution plans

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=debug
LOG_SQL=true
```

## Production Deployment

### Pre-deployment Checklist

- [ ] Change all default passwords
- [ ] Enable SSL connections
- [ ] Configure backup schedule
- [ ] Set up monitoring
- [ ] Review security settings
- [ ] Test backup/restore procedures
- [ ] Configure error alerting
- [ ] Set up log rotation

### Performance Tuning

- Optimize connection pool size
- Configure appropriate memory settings
- Set up read replicas for scaling
- Configure connection timeouts
- Enable query caching

## Migration from In-Memory Maps

The database implementation provides a seamless migration from the current in-memory Map storage:

### Data Migration

1. Current in-memory workflows → `workflows` table
2. Current client connections → `user_sessions` table
3. Current events → `events` table
4. Enhanced with persistence, relationships, and analytics

### API Compatibility

- All existing API endpoints maintained
- Enhanced with database features
- Additional endpoints for new capabilities
- Backward compatibility preserved

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review error logs
3. Test with development environment
4. Check database health status
5. Review configuration settings

## Contributing

When contributing to the database schema:

1. Always create migrations for schema changes
2. Update the documentation
3. Add tests for new features
4. Test backup/restore procedures
5. Update seed data if needed
6. Follow naming conventions
7. Add appropriate indexes
8. Document security implications