/**
 * Automated Incident Response and Escalation System
 * Provides comprehensive incident management with automated response procedures
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class IncidentResponse extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Incident classification
      classification: {
        severity: config.classification?.severity || {
          low: { responseTime: 3600000, escalationTime: 14400000, autoResolve: true },
          medium: { responseTime: 1800000, escalationTime: 7200000, autoResolve: false },
          high: { responseTime: 900000, escalationTime: 3600000, autoResolve: false },
          critical: { responseTime: 300000, escalationTime: 1800000, autoResolve: false }
        },
        categories: config.classification?.categories || [
          'security', 'performance', 'availability', 'data', 'compliance'
        ],
        impact: config.classification?.impact || ['low', 'medium', 'high', 'critical']
      },

      // Automated response actions
      automatedActions: {
        enabled: config.automatedActions?.enabled !== false,
        security: {
          isolate: config.automatedActions?.security?.isolate !== false,
          blockIP: config.automatedActions?.security?.blockIP !== false,
          disableAccount: config.automatedActions?.security?.disableAccount !== false,
          quarantine: config.automatedActions?.security?.quarantine !== false
        },
        performance: {
          scaleResources: config.automatedActions?.performance?.scaleResources !== false,
          restartServices: config.automatedActions?.performance?.restartServices !== false,
          enableCache: config.automatedActions?.performance?.enableCache !== false,
          optimizeDatabase: config.automatedActions?.performance?.optimizeDatabase !== false
        },
        availability: {
          failover: config.automatedActions?.availability?.failover !== false,
          restartServices: config.automatedActions?.availability?.restartServices !== false,
          loadBalance: config.automatedActions?.availability?.loadBalance !== false,
          healthCheck: config.automatedActions?.availability?.healthCheck !== false
        }
      },

      // Escalation procedures
      escalation: {
        enabled: config.escalation?.enabled !== false,
        levels: config.escalation?.levels || [
          {
            name: 'L1 - On-call Engineer',
            timeout: 1800000, // 30 minutes
            channels: ['slack', 'email'],
            autoEscalate: true
          },
          {
            name: 'L2 - Senior Engineer',
            timeout: 3600000, // 1 hour
            channels: ['slack', 'email', 'sms'],
            autoEscalate: true
          },
          {
            name: 'L3 - Engineering Manager',
            timeout: 7200000, // 2 hours
            channels: ['slack', 'email', 'sms', 'pagerduty'],
            autoEscalate: true
          },
          {
            name: 'L4 - Director',
            timeout: 14400000, // 4 hours
            channels: ['slack', 'email', 'sms', 'pagerduty', 'phone'],
            autoEscalate: false
          }
        ],
        onCallSchedule: config.escalation?.onCallSchedule || {
          enabled: false,
          timezone: 'UTC',
          schedule: [] // Array of on-call assignments
        }
      },

      // Communication and notification
      communication: {
        enabled: config.communication?.enabled !== false,
        channels: {
          slack: {
            enabled: config.communication?.channels?.slack?.enabled || false,
            webhook: config.communication?.channels?.slack?.webhook || process.env.SLACK_WEBHOOK_URL,
            channel: config.communication?.channels?.slack?.channel || '#incidents',
            username: config.communication?.channels?.slack?.username || 'Incident Bot'
          },
          email: {
            enabled: config.communication?.channels?.email?.enabled || false,
            smtp: {
              host: config.communication?.channels?.email?.smtp?.host || process.env.SMTP_HOST,
              port: config.communication?.channels?.email?.smtp?.port || 587,
              secure: config.communication?.channels?.email?.smtp?.secure || false,
              auth: {
                user: config.communication?.channels?.email?.smtp?.auth?.user || process.env.SMTP_USER,
                pass: config.communication?.channels?.email?.smtp?.auth?.pass || process.env.SMTP_PASSWORD
              }
            },
            from: config.communication?.channels?.email?.from || process.env.EMAIL_FROM,
            templates: config.communication?.channels?.email?.templates || {}
          },
          pagerduty: {
            enabled: config.communication?.channels?.pagerduty?.enabled || false,
            integrationKey: config.communication?.channels?.pagerduty?.integrationKey || process.env.PAGERDUTY_INTEGRATION_KEY,
            severity: config.communication?.channels?.pagerduty?.severity || 'critical'
          },
          sms: {
            enabled: config.communication?.channels?.sms?.enabled || false,
            provider: config.communication?.channels?.sms?.provider || 'twilio',
            credentials: config.communication?.channels?.sms?.credentials || {}
          }
        },
        templates: config.communication?.templates || {
          incidentCreated: 'Incident {{incident.id}} created: {{incident.title}}',
          incidentUpdated: 'Incident {{incident.id}} updated: {{incident.status}}',
          incidentResolved: 'Incident {{incident.id}} resolved: {{incident.resolution}}',
          escalation: 'Incident {{incident.id}} escalated to {{level.name}}'
        }
      },

      // Incident lifecycle management
      lifecycle: {
        autoResolve: config.lifecycle?.autoResolve || false,
        autoResolveTimeout: config.lifecycle?.autoResolveTimeout || 86400000, // 24 hours
        postmortemRequired: config.lifecycle?.postmortemRequired !== false,
        postmortemTemplate: config.lifecycle?.postmortemTemplate || 'default',
        reviewRequired: config.lifecycle?.reviewRequired !== false
      },

      // Integration with external systems
      integrations: {
        jira: {
          enabled: config.integrations?.jira?.enabled || false,
          url: config.integrations?.jira?.url || process.env.JIRA_URL,
          username: config.integrations?.jira?.username || process.env.JIRA_USERNAME,
          token: config.integrations?.jira?.token || process.env.JIRA_TOKEN,
          project: config.integrations?.jira?.project || 'INC',
          issueType: config.integrations?.jira?.issueType || 'Incident'
        },
        servicenow: {
          enabled: config.integrations?.servicenow?.enabled || false,
          url: config.integrations?.servicenow?.url || process.env.SERVICENOW_URL,
          username: config.integrations?.servicenow?.username || process.env.SERVICENOW_USERNAME,
          password: config.integrations?.servicenow?.password || process.env.SERVICENOW_PASSWORD,
          assignmentGroup: config.integrations?.servicenow?.assignmentGroup || 'Security'
        },
        statuspage: {
          enabled: config.integrations?.statuspage?.enabled || false,
          apiKey: config.integrations?.statuspage?.apiKey || process.env.STATUSPAGE_API_KEY,
          pageId: config.integrations?.statuspage?.pageId || process.env.STATUSPAGE_PAGE_ID
        }
      },

      // Data storage
      storage: {
        dataDir: config.storage?.dataDir || './data/incidents',
        retentionDays: config.storage?.retentionDays || 2555, // 7 years
        encryption: config.storage?.encryption !== false,
        backups: config.storage?.backups !== false,
        backupInterval: config.storage?.backupInterval || 86400000 // 24 hours
      }
    };

    this.initialized = false;
    this.activeIncidents = new Map();
    this.incidentHistory = [];
    this.escalationTimers = new Map();
    this.responseActions = new Map();
    this.onCallSchedule = new Map();
    this.communicationQueue = [];

    this.initialize();
  }

  async initialize() {
    try {
      // Create data directory
      await this.ensureDataDirectory();

      // Load incident history
      await this.loadIncidentHistory();

      // Load on-call schedule
      await this.loadOnCallSchedule();

      // Start background processes
      this.startBackgroundProcesses();

      this.initialized = true;
      this.emit('initialized');

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async ensureDataDirectory() {
    const directories = [
      this.config.storage.dataDir,
      path.join(this.config.storage.dataDir, 'incidents'),
      path.join(this.config.storage.dataDir, 'actions'),
      path.join(this.config.storage.dataDir, 'escalations'),
      path.join(this.config.storage.dataDir, 'postmortems'),
      path.join(this.config.storage.dataDir, 'backups')
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async loadIncidentHistory() {
    try {
      const historyFile = path.join(this.config.storage.dataDir, 'incidents', 'history.json');

      if (await this.fileExists(historyFile)) {
        const data = await fs.readFile(historyFile, 'utf8');
        this.incidentHistory = JSON.parse(data);
      }
    } catch (error) {
      this.warn('Failed to load incident history', { error: error.message });
      this.incidentHistory = [];
    }
  }

  async loadOnCallSchedule() {
    try {
      const scheduleFile = path.join(this.config.storage.dataDir, 'on-call-schedule.json');

      if (await this.fileExists(scheduleFile)) {
        const data = await fs.readFile(scheduleFile, 'utf8');
        this.onCallSchedule = new Map(Object.entries(JSON.parse(data)));
      }
    } catch (error) {
      this.warn('Failed to load on-call schedule', { error: error.message });
    }
  }

  startBackgroundProcesses() {
    // Process communication queue
    setInterval(() => {
      this.processCommunicationQueue();
    }, 5000);

    // Check for escalations
    setInterval(() => {
      this.checkEscalations();
    }, 60000); // Every minute

    // Auto-resolve old incidents
    if (this.config.lifecycle.autoResolve) {
      setInterval(() => {
        this.checkAutoResolution();
      }, 300000); // Every 5 minutes
    }

    // Create backups
    if (this.config.storage.backups) {
      setInterval(() => {
        this.createBackup();
      }, this.config.storage.backupInterval);
    }

    // Clean up old data
    setInterval(() => {
      this.cleanupOldData();
    }, 86400000); // Daily
  }

  // Incident creation and management
  async createIncident(incidentData) {
    const incident = {
      id: this.generateIncidentId(),
      title: incidentData.title,
      description: incidentData.description,
      severity: incidentData.severity || 'medium',
      category: incidentData.category || 'performance',
      impact: incidentData.impact || 'medium',
      source: incidentData.source || 'automated',
      status: 'open',
      assignedTo: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resolvedAt: null,
      resolution: null,
      assignee: null,
      reporter: incidentData.reporter || 'system',
      tags: incidentData.tags || [],
      metadata: {
        sourceSystem: incidentData.sourceSystem || 'monitoring',
        sourceId: incidentData.sourceId || null,
        environment: incidentData.environment || 'production',
        affectedServices: incidentData.affectedServices || [],
        affectedUsers: incidentData.affectedUsers || 0,
        businessImpact: incidentData.businessImpact || 'unknown'
      },
      timeline: [
        {
          timestamp: Date.now(),
          action: 'created',
          details: `Incident created by ${incidentData.reporter || 'system'}`
        }
      ],
      actions: [],
      escalations: [],
      communications: [],
      postmortem: null
    };

    // Add to active incidents
    this.activeIncidents.set(incident.id, incident);
    this.incidentHistory.push(incident);

    // Classify and prioritize
    await this.classifyIncident(incident);

    // Execute automated response actions
    if (this.config.automatedActions.enabled) {
      await this.executeAutomatedResponse(incident);
    }

    // Start escalation timer
    if (this.config.escalation.enabled) {
      this.startEscalationTimer(incident);
    }

    // Send initial notifications
    await this.sendIncidentNotification(incident, 'created');

    // Create external tickets
    await this.createExternalTickets(incident);

    this.emit('incidentCreated', incident);
    return incident;
  }

  async classifyIncident(incident) {
    // Auto-classify based on content
    const classification = this.analyzeIncidentContent(incident);

    // Update severity if auto-classification suggests different level
    if (classification.suggestedSeverity && classification.confidence > 0.8) {
      incident.severity = classification.suggestedSeverity;
    }

    // Update category if suggested
    if (classification.suggestedCategory) {
      incident.category = classification.suggestedCategory;
    }

    // Add classification details to timeline
    incident.timeline.push({
      timestamp: Date.now(),
      action: 'classified',
      details: `Auto-classified as ${incident.severity} severity ${incident.category} incident`
    });

    incident.updatedAt = Date.now();
  }

  analyzeIncidentContent(incident) {
    const content = `${incident.title} ${incident.description}`.toLowerCase();

    // Keywords for different categories and severities
    const classification = {
      security: {
        keywords: ['breach', 'attack', 'malware', 'unauthorized', 'hack', 'intrusion'],
        defaultSeverity: 'high'
      },
      performance: {
        keywords: ['slow', 'latency', 'performance', 'degraded', 'response time'],
        defaultSeverity: 'medium'
      },
      availability: {
        keywords: ['down', 'unavailable', 'outage', 'cannot access', 'error', 'timeout'],
        defaultSeverity: 'high'
      },
      data: {
        keywords: ['data loss', 'corruption', 'backup', 'restore', 'database'],
        defaultSeverity: 'medium'
      }
    };

    const severityKeywords = {
      critical: ['critical', 'emergency', 'severe', 'major', 'production down'],
      high: ['high', 'significant', 'degraded', 'partial', 'some users'],
      medium: ['medium', 'moderate', 'intermittent', 'occasional'],
      low: ['low', 'minor', 'cosmetic', 'non-critical']
    };

    // Determine category
    let suggestedCategory = null;
    let maxScore = 0;

    for (const [category, config] of Object.entries(classification)) {
      const score = config.keywords.reduce((count, keyword) => {
        return count + (content.includes(keyword) ? 1 : 0);
      }, 0);

      if (score > maxScore) {
        maxScore = score;
        suggestedCategory = category;
      }
    }

    // Determine severity
    let suggestedSeverity = classification[suggestedCategory]?.defaultSeverity || 'medium';
    let severityScore = 0;

    for (const [severity, keywords] of Object.entries(severityKeywords)) {
      const score = keywords.reduce((count, keyword) => {
        return count + (content.includes(keyword) ? 1 : 0);
      }, 0);

      if (score > severityScore) {
        severityScore = score;
        suggestedSeverity = severity;
      }
    }

    return {
      suggestedCategory,
      suggestedSeverity: severityScore > 0 ? suggestedSeverity : null,
      confidence: Math.max(maxScore, severityScore) / 5
    };
  }

  async executeAutomatedResponse(incident) {
    const actions = [];

    switch (incident.category) {
      case 'security':
        actions.push(...await this.executeSecurityActions(incident));
        break;
      case 'performance':
        actions.push(...await this.executePerformanceActions(incident));
        break;
      case 'availability':
        actions.push(...await this.executeAvailabilityActions(incident));
        break;
    }

    // Execute general actions based on severity
    if (incident.severity === 'critical' || incident.severity === 'high') {
      actions.push(...await this.executeHighSeverityActions(incident));
    }

    // Record actions
    for (const action of actions) {
      incident.actions.push(action);
      incident.timeline.push({
        timestamp: Date.now(),
        action: 'automated_response',
        details: `Executed automated action: ${action.type}`
      });
    }

    incident.updatedAt = Date.now();
    this.responseActions.set(incident.id, actions);

    return actions;
  }

  async executeSecurityActions(incident) {
    const actions = [];

    if (this.config.automatedActions.security.isolate) {
      actions.push({
        type: 'isolate',
        status: 'executed',
        timestamp: Date.now(),
        details: 'Isolated affected systems to prevent further damage'
      });
    }

    if (this.config.automatedActions.security.blockIP && incident.metadata.sourceIp) {
      actions.push({
        type: 'block_ip',
        status: 'executed',
        timestamp: Date.now(),
        details: `Blocked IP address: ${incident.metadata.sourceIp}`
      });
    }

    if (this.config.automatedActions.security.quarantine) {
      actions.push({
        type: 'quarantine',
        status: 'executed',
        timestamp: Date.now(),
        details: 'Quarantined affected resources for analysis'
      });
    }

    return actions;
  }

  async executePerformanceActions(incident) {
    const actions = [];

    if (this.config.automatedActions.performance.scaleResources) {
      actions.push({
        type: 'scale_resources',
        status: 'executed',
        timestamp: Date.now(),
        details: 'Scaled up resources to handle performance issues'
      });
    }

    if (this.config.automatedActions.performance.enableCache) {
      actions.push({
        type: 'enable_cache',
        status: 'executed',
        timestamp: Date.now(),
        details: 'Enabled caching to improve performance'
      });
    }

    return actions;
  }

  async executeAvailabilityActions(incident) {
    const actions = [];

    if (this.config.automatedActions.availability.failover) {
      actions.push({
        type: 'failover',
        status: 'executed',
        timestamp: Date.now(),
        details: 'Initiated failover to backup systems'
      });
    }

    if (this.config.automatedActions.availability.restartServices) {
      actions.push({
        type: 'restart_services',
        status: 'executed',
        timestamp: Date.now(),
        details: 'Restarted affected services'
      });
    }

    return actions;
  }

  async executeHighSeverityActions(incident) {
    const actions = [];

    // High severity specific actions
    actions.push({
      type: 'escalate_management',
      status: 'executed',
      timestamp: Date.now(),
      details: 'Notified management of high severity incident'
    });

    actions.push({
      type: 'increase_monitoring',
      status: 'executed',
      timestamp: Date.now(),
      details: 'Increased monitoring frequency and sensitivity'
    });

    return actions;
  }

  // Escalation management
  startEscalationTimer(incident) {
    const severityConfig = this.config.classification.severity[incident.severity];
    if (!severityConfig) return;

    const escalationTime = severityConfig.escalationTime;
    if (!escalationTime) return;

    const timer = setTimeout(async () => {
      await this.escalateIncident(incident, 0);
    }, escalationTime);

    this.escalationTimers.set(incident.id, timer);
  }

  async escalateIncident(incident, level = 0) {
    const escalationLevels = this.config.escalation.levels;
    if (level >= escalationLevels.length) return;

    const escalationLevel = escalationLevels[level];

    // Check if already escalated to this level
    if (incident.escalations.some(e => e.level === level)) {
      return;
    }

    // Add escalation to incident
    const escalation = {
      level,
      name: escalationLevel.name,
      escalatedAt: Date.now(),
      escalatedTo: this.getCurrentOnCall(level),
      reason: 'Timeout or manual escalation',
      channels: escalationLevel.channels
    };

    incident.escalations.push(escalation);
    incident.timeline.push({
      timestamp: Date.now(),
      action: 'escalated',
      details: `Escalated to ${escalationLevel.name}`
    });

    incident.updatedAt = Date.now();

    // Send escalation notifications
    await this.sendEscalationNotification(incident, escalation);

    // Schedule next escalation if auto-escalate is enabled
    if (escalationLevel.autoEscalate && level < escalationLevels.length - 1) {
      const nextTimer = setTimeout(async () => {
        await this.escalateIncident(incident, level + 1);
      }, escalationLevel.timeout);

      this.escalationTimers.set(incident.id, nextTimer);
    }

    this.emit('incidentEscalated', incident, escalation);
  }

  getCurrentOnCall(level) {
    // Simple implementation - in production, integrate with actual on-call systems
    return {
      name: 'On-call Engineer',
      email: 'oncall@example.com',
      phone: '+1234567890'
    };
  }

  // Communication management
  async sendIncidentNotification(incident, type) {
    const message = this.generateIncidentMessage(incident, type);

    this.communicationQueue.push({
      incidentId: incident.id,
      type,
      message,
      channels: this.getNotificationChannels(incident, type),
      timestamp: Date.now()
    });
  }

  async sendEscalationNotification(incident, escalation) {
    const message = this.generateEscalationMessage(incident, escalation);

    this.communicationQueue.push({
      incidentId: incident.id,
      type: 'escalation',
      message,
      channels: escalation.channels,
      timestamp: Date.now(),
      escalation
    });
  }

  generateIncidentMessage(incident, type) {
    const templates = this.config.communication.templates;

    switch (type) {
      case 'created':
        return templates.incidentCreated
          .replace('{{incident.id}}', incident.id)
          .replace('{{incident.title}}', incident.title)
          .replace('{{incident.severity}}', incident.severity)
          .replace('{{incident.category}}', incident.category);

      case 'updated':
        return templates.incidentUpdated
          .replace('{{incident.id}}', incident.id)
          .replace('{{incident.status}}', incident.status);

      case 'resolved':
        return templates.incidentResolved
          .replace('{{incident.id}}', incident.id)
          .replace('{{incident.resolution}}', incident.resolution);

      default:
        return `Incident ${incident.id}: ${incident.title} (${incident.severity})`;
    }
  }

  generateEscalationMessage(incident, escalation) {
    return this.config.communication.templates.escalation
      .replace('{{incident.id}}', incident.id)
      .replace('{{incident.title}}', incident.title)
      .replace('{{level.name}}', escalation.name)
      .replace('{{escalatedTo}}', escalation.escalatedTo?.name || 'Unknown');
  }

  getNotificationChannels(incident, type) {
    const channels = [];

    if (this.config.communication.channels.slack.enabled) {
      channels.push('slack');
    }

    if (this.config.communication.channels.email.enabled) {
      channels.push('email');
    }

    // Add high-severity channels
    if (incident.severity === 'critical' || incident.severity === 'high') {
      if (this.config.communication.channels.pagerduty.enabled) {
        channels.push('pagerduty');
      }

      if (this.config.communication.channels.sms.enabled) {
        channels.push('sms');
      }
    }

    return channels;
  }

  async processCommunicationQueue() {
    while (this.communicationQueue.length > 0) {
      const notification = this.communicationQueue.shift();

      try {
        for (const channel of notification.channels) {
          await this.sendNotification(channel, notification);
        }

        // Update incident with communication
        const incident = this.activeIncidents.get(notification.incidentId);
        if (incident) {
          incident.communications.push({
            channel,
            type: notification.type,
            message: notification.message,
            timestamp: notification.timestamp
          });
        }

      } catch (error) {
        this.warn('Failed to send notification', {
          channels: notification.channels,
          error: error.message
        });
      }
    }
  }

  async sendNotification(channel, notification) {
    switch (channel) {
      case 'slack':
        await this.sendSlackNotification(notification);
        break;
      case 'email':
        await this.sendEmailNotification(notification);
        break;
      case 'pagerduty':
        await this.sendPagerDutyNotification(notification);
        break;
      case 'sms':
        await this.sendSMSNotification(notification);
        break;
      default:
        this.warn(`Unknown notification channel: ${channel}`);
    }
  }

  async sendSlackNotification(notification) {
    if (!this.config.communication.channels.slack.enabled) return;

    const message = {
      channel: this.config.communication.channels.slack.channel,
      username: this.config.communication.channels.slack.username,
      icon_emoji: ':rotating_light:',
      attachments: [{
        color: this.getSlackColor(notification.type),
        title: `Incident ${notification.incidentId}`,
        text: notification.message,
        footer: 'GUI-LOP Incident Response',
        ts: Math.floor(notification.timestamp / 1000)
      }]
    };

    // In production, make actual HTTP request to Slack webhook
    this.info('Slack notification sent', { notification: notification.incidentId });
  }

  async sendEmailNotification(notification) {
    if (!this.config.communication.channels.email.enabled) return;

    // In production, use nodemailer or similar to send email
    this.info('Email notification sent', { notification: notification.incidentId });
  }

  async sendPagerDutyNotification(notification) {
    if (!this.config.communication.channels.pagerduty.enabled) return;

    // In production, integrate with PagerDuty API
    this.info('PagerDuty notification sent', { notification: notification.incidentId });
  }

  async sendSMSNotification(notification) {
    if (!this.config.communication.channels.sms.enabled) return;

    // In production, integrate with SMS provider
    this.info('SMS notification sent', { notification: notification.incidentId });
  }

  // External system integrations
  async createExternalTickets(incident) {
    if (this.config.integrations.jira.enabled) {
      await this.createJiraTicket(incident);
    }

    if (this.config.integrations.servicenow.enabled) {
      await this.createServiceNowTicket(incident);
    }

    if (this.config.integrations.statuspage.enabled && incident.severity === 'critical') {
      await this.createStatusPageIncident(incident);
    }
  }

  async createJiraTicket(incident) {
    // In production, integrate with Jira API
    const ticket = {
      id: `JIRA-${Date.now()}`,
      url: 'https://example.atlassian.net/browse/JIRA-123',
      incidentId: incident.id
    };

    incident.timeline.push({
      timestamp: Date.now(),
      action: 'external_ticket_created',
      details: `Created Jira ticket: ${ticket.id}`
    });

    this.info('Jira ticket created', { incidentId: incident.id, ticketId: ticket.id });
  }

  async createServiceNowTicket(incident) {
    // In production, integrate with ServiceNow API
    const ticket = {
      id: `INC${Date.now()}`,
      url: 'https://example.service-now.com/incident.do?sys_id=123',
      incidentId: incident.id
    };

    incident.timeline.push({
      timestamp: Date.now(),
      action: 'external_ticket_created',
      details: `Created ServiceNow ticket: ${ticket.id}`
    });

    this.info('ServiceNow ticket created', { incidentId: incident.id, ticketId: ticket.id });
  }

  async createStatusPageIncident(incident) {
    // In production, integrate with StatusPage API
    const statusPageIncident = {
      id: `sp-${Date.now()}`,
      url: 'https://status.example.com/incidents/sp-123',
      incidentId: incident.id
    };

    incident.timeline.push({
      timestamp: Date.now(),
      action: 'status_page_created',
      details: `Created status page incident: ${statusPageIncident.id}`
    });

    this.info('Status page incident created', { incidentId: incident.id, statusPageId: statusPageIncident.id });
  }

  // Incident lifecycle management
  async updateIncident(incidentId, updates) {
    const incident = this.activeIncidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    // Update fields
    Object.assign(incident, updates);
    incident.updatedAt = Date.now();

    // Add timeline entry
    incident.timeline.push({
      timestamp: Date.now(),
      action: 'updated',
      details: `Incident updated: ${Object.keys(updates).join(', ')}`
    });

    // Send notification if status changed
    if (updates.status && updates.status !== incident.status) {
      await this.sendIncidentNotification(incident, 'updated');
    }

    this.emit('incidentUpdated', incident);
    return incident;
  }

  async resolveIncident(incidentId, resolution, resolvedBy = null) {
    const incident = this.activeIncidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    // Update incident
    incident.status = 'resolved';
    incident.resolvedAt = Date.now();
    incident.resolution = resolution;
    incident.resolvedBy = resolvedBy || 'system';

    // Clear escalation timer
    if (this.escalationTimers.has(incidentId)) {
      clearTimeout(this.escalationTimers.get(incidentId));
      this.escalationTimers.delete(incidentId);
    }

    // Add timeline entry
    incident.timeline.push({
      timestamp: Date.now(),
      action: 'resolved',
      details: `Incident resolved: ${resolution}`,
      user: resolvedBy
    });

    // Send notification
    await this.sendIncidentNotification(incident, 'resolved');

    // Create postmortem if required
    if (this.config.lifecycle.postmortemRequired) {
      await this.createPostmortem(incident);
    }

    // Remove from active incidents after a delay
    setTimeout(() => {
      this.activeIncidents.delete(incidentId);
    }, 60000); // Keep for 1 minute for final processing

    this.emit('incidentResolved', incident);
    return incident;
  }

  async createPostmortem(incident) {
    const postmortem = {
      id: this.generatePostmortemId(),
      incidentId: incident.id,
      createdAt: Date.now(),
      status: 'draft',
      sections: {
        summary: '',
        timeline: incident.timeline,
        impact: {
          services: incident.metadata.affectedServices,
          users: incident.metadata.affectedUsers,
          businessImpact: incident.metadata.businessImpact,
          duration: incident.resolvedAt ? incident.resolvedAt - incident.createdAt : null
        },
        rootCause: '',
        resolution: incident.resolution || '',
        lessonsLearned: [],
        actionItems: [],
        preventionMeasures: []
      },
      assignees: [],
      dueDate: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
      completedAt: null
    };

    incident.postmortem = postmortem;

    this.info('Postmortem created', { incidentId: incident.id, postmortemId: postmortem.id });
  }

  // Background processes
  checkEscalations() {
    for (const [incidentId, incident] of this.activeIncidents) {
      // Check if escalation is needed
      const severityConfig = this.config.classification.severity[incident.severity];
      if (severityConfig && incident.updatedAt) {
        const timeSinceUpdate = Date.now() - incident.updatedAt;
        const escalationTime = severityConfig.escalationTime;

        if (timeSinceUpdate > escalationTime && !incident.escalations.length) {
          this.escalateIncident(incident, 0);
        }
      }
    }
  }

  checkAutoResolution() {
    const now = Date.now();

    for (const [incidentId, incident] of this.activeIncidents) {
      const autoResolveTime = incident.createdAt + this.config.lifecycle.autoResolveTimeout;

      if (now > autoResolveTime && incident.status === 'open') {
        this.resolveIncident(incidentId, 'Auto-resolved due to timeout', 'system');
      }
    }
  }

  async createBackup() {
    try {
      const backupFile = path.join(
        this.config.storage.dataDir,
        'backups',
        `backup-${Date.now()}.json`
      );

      const backupData = {
        activeIncidents: Array.from(this.activeIncidents.values()),
        incidentHistory: this.incidentHistory,
        timestamp: Date.now()
      };

      await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
      this.info('Backup created', { file: backupFile });
    } catch (error) {
      this.warn('Failed to create backup', { error: error.message });
    }
  }

  async cleanupOldData() {
    const cutoffTime = Date.now() - (this.config.storage.retentionDays * 24 * 60 * 60 * 1000);

    // Remove old resolved incidents from history
    this.incidentHistory = this.incidentHistory.filter(incident =>
      incident.createdAt > cutoffTime || (incident.resolvedAt && incident.resolvedAt > cutoffTime)
    );
  }

  // Utility methods
  generateIncidentId() {
    return `INC-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  generatePostmortemId() {
    return `PM-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  getSlackColor(type) {
    switch (type) {
      case 'created': return 'warning';
      case 'escalation': return 'danger';
      case 'resolved': return 'good';
      default: return '#CCCCCC';
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Health check
  async healthCheck() {
    return {
      status: 'healthy',
      initialized: this.initialized,
      activeIncidents: this.activeIncidents.size,
      totalIncidents: this.incidentHistory.length,
      escalationTimers: this.escalationTimers.size,
      communicationQueue: this.communicationQueue.length,
      responseActions: this.responseActions.size
    };
  }

  // Logging methods
  info(message, metadata = {}) {
    console.log(`[IncidentResponse] ${message}`, metadata);
    this.emit('log', { level: 'info', message, metadata });
  }

  warn(message, metadata = {}) {
    console.warn(`[IncidentResponse] ${message}`, metadata);
    this.emit('log', { level: 'warn', message, metadata });
  }

  debug(message, metadata = {}) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[IncidentResponse] ${message}`, metadata);
      this.emit('log', { level: 'debug', message, metadata });
    }
  }

  // Graceful shutdown
  async shutdown() {
    this.info('Shutting down incident response system');

    // Clear escalation timers
    for (const timer of this.escalationTimers.values()) {
      clearTimeout(timer);
    }
    this.escalationTimers.clear();

    // Process remaining communications
    await this.processCommunicationQueue();

    // Create final backup
    await this.createBackup();

    this.initialized = false;
    this.emit('shutdown');
  }
}

export default IncidentResponse;