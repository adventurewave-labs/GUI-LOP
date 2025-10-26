/**
 * Security Monitoring and Intrusion Detection System
 * Provides comprehensive security event monitoring and threat detection
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SecurityMonitoring extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Threat detection settings
      threatDetection: {
        enabled: config.threatDetection?.enabled !== false,
        windowSize: config.threatDetection?.windowSize || 300, // 5 minutes
        sensitivity: config.threatDetection?.sensitivity || 0.7,
        ruleset: config.threatDetection?.ruleset || 'default',
        mlModels: config.threatDetection?.mlModels || ['isolation_forest', 'anomaly_detector']
      },

      // Security event types
      eventTypes: {
        authentication: {
          enabled: config.eventTypes?.authentication?.enabled !== false,
          failedLoginThreshold: config.eventTypes?.authentication?.failedLoginThreshold || 5,
          suspiciousLocationThreshold: config.eventTypes?.authentication?.suspiciousLocationThreshold || 3,
          bruteForceWindow: config.eventTypes?.authentication?.bruteForceWindow || 60000 // 1 minute
        },
        authorization: {
          enabled: config.eventTypes?.authorization?.enabled !== false,
          unauthorizedThreshold: config.eventTypes?.authorization?.unauthorizedThreshold || 3,
          privilegeEscalationDetection: config.eventTypes?.authorization?.privilegeEscalationDetection !== false
        },
        intrusion: {
          enabled: config.eventTypes?.intrusion?.enabled !== false,
          portScanThreshold: config.eventTypes?.intrusion?.portScanThreshold || 10,
          dosThreshold: config.eventTypes?.intrusion?.dosThreshold || 1000,
          unusualTrafficPatterns: config.eventTypes?.intrusion?.unusualTrafficPatterns !== false
        },
        data: {
          enabled: config.eventTypes?.data?.enabled !== false,
          dataExfiltrationThreshold: config.eventTypes?.data?.dataExfiltrationThreshold || 10485760, // 10MB
          sensitiveDataAccess: config.eventTypes?.data?.sensitiveDataAccess !== false,
          unusualDataPatterns: config.eventTypes?.data?.unusualDataPatterns !== false
        },
        malware: {
          enabled: config.eventTypes?.malware?.enabled !== false,
          signatureScanning: config.eventTypes?.malware?.signatureScanning !== false,
          behaviorAnalysis: config.eventTypes?.malware?.behaviorAnalysis !== false,
          heuristics: config.eventTypes?.malware?.heuristics !== false
        }
      },

      // IP reputation and geolocation
      ipReputation: {
        enabled: config.ipReputation?.enabled !== false,
        sources: config.ipReputation?.sources || ['spamhaus', 'abuseipdb', 'custom'],
        blockKnownMalicious: config.ipReputation?.blockKnownMalicious !== false,
        geoBlocking: config.ipReputation?.geoBlocking || {
          enabled: false,
          blockedCountries: []
        }
      },

      // Behavioral analysis
      behaviorAnalysis: {
        enabled: config.behaviorAnalysis?.enabled !== false,
        baselineWindow: config.behaviorAnalysis?.baselineWindow || 86400000, // 24 hours
        anomalyThreshold: config.behaviorAnalysis?.anomalyThreshold || 0.8,
        userBehaviorTracking: config.behaviorAnalysis?.userBehaviorTracking !== false,
        systemBehaviorTracking: config.behaviorAnalysis?.systemBehaviorTracking !== false
      },

      // Incident response
      incidentResponse: {
        enabled: config.incidentResponse?.enabled !== false,
        autoContainment: config.incidentResponse?.autoContainment || false,
        isolation: config.incidentResponse?.isolation || {
          enabled: false,
          actions: ['block_ip', 'disable_user', 'quarantine_system']
        },
        notification: {
          channels: config.incidentResponse?.notification?.channels || ['email', 'slack'],
          escalation: config.incidentResponse?.notification?.escalation || {
            enabled: true,
            levels: ['warning', 'critical', 'emergency']
          }
        }
      },

      // Compliance and auditing
      compliance: {
        enabled: config.compliance?.enabled !== false,
        frameworks: config.compliance?.frameworks || ['SOC2', 'GDPR', 'PCI-DSS'],
        auditLogRetention: config.compliance?.auditLogRetention || 365, // days
        requiredFields: config.compliance?.requiredFields || [
          'timestamp', 'user_id', 'action', 'resource', 'outcome', 'source_ip'
        ]
      },

      // Data storage
      storage: {
        dataDir: config.storage?.dataDir || './data/security',
        retentionDays: config.storage?.retentionDays || 365,
        encryption: config.storage?.encryption !== false,
        encryptionKey: config.storage?.encryptionKey || process.env.SECURITY_ENCRYPTION_KEY
      }
    };

    this.initialized = false;
    this.securityEvents = [];
    this.activeThreats = new Map();
    this.blockedIPs = new Set();
    this.userProfiles = new Map();
    this.systemBaseline = new Map();
    this.threatIntelligence = new Map();
    this.complianceReports = new Map();

    this.initialize();
  }

  async initialize() {
    try {
      // Create data directory
      await this.ensureDataDirectory();

      // Load threat intelligence
      await this.loadThreatIntelligence();

      // Initialize ML models
      await this.initializeMLModels();

      // Build system baseline
      await this.buildSystemBaseline();

      // Start monitoring processes
      this.startMonitoringProcesses();

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
      path.join(this.config.storage.dataDir, 'events'),
      path.join(this.config.storage.dataDir, 'threats'),
      path.join(this.config.storage.dataDir, 'baselines'),
      path.join(this.config.storage.dataDir, 'compliance'),
      path.join(this.config.storage.dataDir, 'intelligence')
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async loadThreatIntelligence() {
    try {
      // Load IP reputation data
      const ipReputationFile = path.join(this.config.storage.dataDir, 'intelligence', 'ip-reputation.json');
      if (await this.fileExists(ipReputationFile)) {
        const data = await fs.readFile(ipReputationFile, 'utf8');
        const ipData = JSON.parse(data);
        this.threatIntelligence.set('ip-reputation', new Map(Object.entries(ipData)));
      }

      // Load malware signatures
      const signaturesFile = path.join(this.config.storage.dataDir, 'intelligence', 'malware-signatures.json');
      if (await this.fileExists(signaturesFile)) {
        const data = await fs.readFile(signaturesFile, 'utf8');
        this.threatIntelligence.set('malware-signatures', JSON.parse(data));
      }

      // Load attack patterns
      const patternsFile = path.join(this.config.storage.dataDir, 'intelligence', 'attack-patterns.json');
      if (await this.fileExists(patternsFile)) {
        const data = await fs.readFile(patternsFile, 'utf8');
        this.threatIntelligence.set('attack-patterns', JSON.parse(data));
      }

      this.info('Threat intelligence loaded successfully');
    } catch (error) {
      this.warn('Failed to load threat intelligence', { error: error.message });
    }
  }

  async initializeMLModels() {
    // Initialize anomaly detection model
    this.anomalyDetector = {
      baseline: new Map(),
      threshold: this.config.behaviorAnalysis.anomalyThreshold,

      async train(data) {
        // Calculate baseline statistics
        const baseline = this.calculateBaseline(data);
        this.baseline = new Map(Object.entries(baseline));
      },

      async predict(dataPoint) {
        const anomalies = [];

        for (const [key, baseline] of this.baseline) {
          const value = dataPoint[key];
          if (value !== undefined) {
            const zScore = Math.abs((value - baseline.mean) / baseline.stdDev);
            if (zScore > 3) { // 3 sigma threshold
              anomalies.push({
                metric: key,
                value,
                baseline: baseline.mean,
                zScore,
                severity: zScore > 5 ? 'critical' : 'warning'
              });
            }
          }
        }

        return {
          isAnomaly: anomalies.length > 0,
          anomalies,
          score: Math.max(...anomalies.map(a => a.zScore)) / 10
        };
      },

      calculateBaseline(data) {
        const baseline = {};

        for (const key of Object.keys(data[0] || {})) {
          const values = data.map(d => d[key]).filter(v => typeof v === 'number');
          if (values.length > 0) {
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
            baseline[key] = { mean, stdDev: Math.sqrt(variance) };
          }
        }

        return baseline;
      }
    };
  }

  async buildSystemBaseline() {
    try {
      const baselineFile = path.join(this.config.storage.dataDir, 'baselines', 'system-baseline.json');

      if (await this.fileExists(baselineFile)) {
        const data = await fs.readFile(baselineFile, 'utf8');
        this.systemBaseline = new Map(Object.entries(JSON.parse(data)));
      } else {
        // Create initial baseline
        const initialBaseline = {
          requestRate: 0,
          errorRate: 0,
          authenticationRate: 0,
          dataTransferRate: 0,
          connectionCount: 0,
          cpuUsage: 0,
          memoryUsage: 0
        };

        this.systemBaseline = new Map(Object.entries(initialBaseline));
        await this.saveBaseline();
      }

      this.info('System baseline established');
    } catch (error) {
      this.warn('Failed to build system baseline', { error: error.message });
    }
  }

  startMonitoringProcesses() {
    // Start continuous threat analysis
    setInterval(() => {
      this.analyzeThreats();
    }, 60000); // Every minute

    // Update threat intelligence
    setInterval(() => {
      this.updateThreatIntelligence();
    }, 3600000); // Every hour

    // Generate compliance reports
    setInterval(() => {
      this.generateComplianceReports();
    }, 86400000); // Daily

    // Clean up old data
    setInterval(() => {
      this.cleanupOldData();
    }, 86400000); // Daily
  }

  // Main event processing method
  async processSecurityEvent(eventType, eventData) {
    if (!this.initialized) return;

    try {
      const event = this.createSecurityEvent(eventType, eventData);

      // Store event
      await this.storeSecurityEvent(event);

      // Analyze event for threats
      const threats = await this.analyzeEvent(event);

      // Process detected threats
      for (const threat of threats) {
        await this.handleThreat(threat);
      }

      // Update behavioral baselines
      await this.updateBaselines(event);

      // Check compliance
      await this.checkCompliance(event);

      this.emit('securityEvent', event);

    } catch (error) {
      this.emit('error', error);
    }
  }

  createSecurityEvent(eventType, eventData) {
    const event = {
      id: this.generateEventId(),
      type: eventType,
      timestamp: Date.now(),
      severity: this.calculateEventSeverity(eventType, eventData),
      data: {
        ...eventData,
        source_ip: eventData.source_ip || eventData.ip || 'unknown',
        user_id: eventData.user_id || eventData.userId || null,
        action: eventData.action || 'unknown',
        resource: eventData.resource || eventData.endpoint || 'unknown',
        outcome: eventData.outcome || eventData.status || 'unknown'
      },
      metadata: {
        processed: false,
        threats: [],
        compliance: null
      }
    };

    // Add threat intelligence context
    if (event.data.source_ip !== 'unknown') {
      event.metadata.ipReputation = this.getIPReputation(event.data.source_ip);
    }

    return event;
  }

  async analyzeEvent(event) {
    const threats = [];

    // Authentication threat analysis
    if (event.type === 'authentication') {
      threats.push(...await this.analyzeAuthenticationThreats(event));
    }

    // Authorization threat analysis
    if (event.type === 'authorization') {
      threats.push(...await this.analyzeAuthorizationThreats(event));
    }

    // Intrusion threat analysis
    if (event.type === 'intrusion') {
      threats.push(...await this.analyzeIntrusionThreats(event));
    }

    // Data access threat analysis
    if (event.type === 'data') {
      threats.push(...await this.analyzeDataThreats(event));
    }

    // Behavioral anomaly analysis
    if (this.config.behaviorAnalysis.enabled) {
      const behaviorThreats = await this.analyzeBehavioralAnomalies(event);
      threats.push(...behaviorThreats);
    }

    return threats;
  }

  async analyzeAuthenticationThreats(event) {
    const threats = [];

    // Brute force detection
    if (event.data.outcome === 'failure') {
      const recentFailures = await this.getRecentAuthFailures(
        event.data.source_ip,
        this.config.eventTypes.authentication.bruteForceWindow
      );

      if (recentFailures.length >= this.config.eventTypes.authentication.failedLoginThreshold) {
        threats.push({
          id: this.generateThreatId(),
          type: 'brute_force',
          severity: 'high',
          confidence: 0.9,
          source_ip: event.data.source_ip,
          details: {
            failureCount: recentFailures.length,
            window: this.config.eventTypes.authentication.bruteForceWindow,
            accounts: [...new Set(recentFailures.map(f => f.data.user_id).filter(Boolean))]
          }
        });
      }
    }

    // Suspicious location detection
    if (event.data.outcome === 'success' && event.data.user_id) {
      const userLocations = await this.getUserRecentLocations(event.data.user_id);
      const currentLocation = await this.getIPLocation(event.data.source_ip);

      if (this.isSuspiciousLocation(userLocations, currentLocation)) {
        threats.push({
          id: this.generateThreatId(),
          type: 'suspicious_location',
          severity: 'medium',
          confidence: 0.7,
          source_ip: event.data.source_ip,
          user_id: event.data.user_id,
          details: {
            currentLocation,
            previousLocations: userLocations,
            risk: this.calculateLocationRisk(userLocations, currentLocation)
          }
        });
      }
    }

    // Impossible travel detection
    if (event.data.outcome === 'success' && event.data.user_id) {
      const lastLogin = await this.getLastUserLogin(event.data.user_id);
      if (lastLogin && this.isImpossibleTravel(lastLogin, event)) {
        threats.push({
          id: this.generateThreatId(),
          type: 'impossible_travel',
          severity: 'high',
          confidence: 0.8,
          source_ip: event.data.source_ip,
          user_id: event.data.user_id,
          details: {
            lastLogin,
            currentLogin: event,
            travel: this.calculateTravelDetails(lastLogin, event)
          }
        });
      }
    }

    return threats;
  }

  async analyzeAuthorizationThreats(event) {
    const threats = [];

    // Unauthorized access attempts
    if (event.data.outcome === 'denied') {
      const recentDenials = await this.getRecentAuthDenials(
        event.data.user_id,
        300000 // 5 minutes
      );

      if (recentDenials.length >= this.config.eventTypes.authorization.unauthorizedThreshold) {
        threats.push({
          id: this.generateThreatId(),
          type: 'unauthorized_access',
          severity: 'medium',
          confidence: 0.8,
          user_id: event.data.user_id,
          details: {
            denialCount: recentDenials.length,
            resources: [...new Set(recentDenials.map(d => d.data.resource))]
          }
        });
      }
    }

    // Privilege escalation detection
    if (this.config.eventTypes.authorization.privilegeEscalationDetection) {
      const escalationDetected = await this.detectPrivilegeEscalation(event);
      if (escalationDetected) {
        threats.push({
          id: this.generateThreatId(),
          type: 'privilege_escalation',
          severity: 'critical',
          confidence: 0.9,
          user_id: event.data.user_id,
          details: escalationDetected
        });
      }
    }

    return threats;
  }

  async analyzeIntrusionThreats(event) {
    const threats = [];

    // Port scan detection
    if (event.data.action === 'port_scan') {
      const recentScans = await this.getRecentPortScans(event.data.source_ip, 60000);
      if (recentScans.length >= this.config.eventTypes.intrusion.portScanThreshold) {
        threats.push({
          id: this.generateThreatId(),
          type: 'port_scan',
          severity: 'high',
          confidence: 0.9,
          source_ip: event.data.source_ip,
          details: {
            scanCount: recentScans.length,
            ports: [...new Set(recentScans.flatMap(s => s.data.ports || []))]
          }
        });
      }
    }

    // DoS attack detection
    if (event.data.action === 'request_flood') {
      const recentRequests = await this.getRecentRequests(event.data.source_ip, 60000);
      if (recentRequests.length >= this.config.eventTypes.intrusion.dosThreshold) {
        threats.push({
          id: this.generateThreatId(),
          type: 'dos_attack',
          severity: 'critical',
          confidence: 0.9,
          source_ip: event.data.source_ip,
          details: {
            requestCount: recentRequests.length,
            window: 60000
          }
        });
      }
    }

    return threats;
  }

  async analyzeDataThreats(event) {
    const threats = [];

    // Data exfiltration detection
    if (event.data.action === 'data_export' || event.data.action === 'data_download') {
      const recentTransfers = await this.getRecentDataTransfers(
        event.data.user_id,
        3600000 // 1 hour
      );

      const totalTransferSize = recentTransfers.reduce((sum, t) => sum + (t.data.size || 0), 0);

      if (totalTransferSize > this.config.eventTypes.data.dataExfiltrationThreshold) {
        threats.push({
          id: this.generateThreatId(),
          type: 'data_exfiltration',
          severity: 'high',
          confidence: 0.8,
          user_id: event.data.user_id,
          details: {
            totalSize: totalTransferSize,
            threshold: this.config.eventTypes.data.dataExfiltrationThreshold,
            transfers: recentTransfers.length
          }
        });
      }
    }

    // Sensitive data access
    if (this.config.eventTypes.data.sensitiveDataAccess) {
      const isSensitive = await this.isSensitiveDataAccess(event);
      if (isSensitive) {
        const userHistory = await this.getUserSensitiveAccessHistory(event.data.user_id);

        if (this.isUnusualSensitiveAccess(event, userHistory)) {
          threats.push({
            id: this.generateThreatId(),
            type: 'sensitive_data_access',
            severity: 'medium',
            confidence: 0.7,
            user_id: event.data.user_id,
            details: {
              resource: event.data.resource,
              accessPattern: userHistory,
              risk: this.calculateSensitiveAccessRisk(event, userHistory)
            }
          });
        }
      }
    }

    return threats;
  }

  async analyzeBehavioralAnomalies(event) {
    const threats = [];

    // Create feature vector for anomaly detection
    const features = await this.extractBehavioralFeatures(event);

    const anomalyResult = await this.anomalyDetector.predict(features);

    if (anomalyResult.isAnomaly && anomalyResult.score > this.config.behaviorAnalysis.anomalyThreshold) {
      threats.push({
        id: this.generateThreatId(),
        type: 'behavioral_anomaly',
        severity: anomalyResult.anomalies.some(a => a.severity === 'critical') ? 'high' : 'medium',
        confidence: anomalyResult.score,
        user_id: event.data.user_id,
        source_ip: event.data.source_ip,
        details: {
          anomalies: anomalyResult.anomalies,
          score: anomalyResult.score,
          features
        }
      });
    }

    return threats;
  }

  async handleThreat(threat) {
    // Store threat
    this.activeThreats.set(threat.id, threat);

    // Check IP reputation and block if necessary
    if (threat.source_ip && this.shouldBlockIP(threat)) {
      await this.blockIP(threat.source_ip, threat.type);
    }

    // Trigger incident response
    if (this.config.incidentResponse.enabled) {
      await this.triggerIncidentResponse(threat);
    }

    // Send alerts
    await this.sendThreatAlert(threat);

    this.emit('threatDetected', threat);
  }

  async blockIP(ip, reason) {
    this.blockedIPs.add(ip);

    // Log IP blocking
    await this.processSecurityEvent('security_action', {
      action: 'ip_blocked',
      ip: ip,
      reason: reason,
      timestamp: Date.now()
    });

    this.warn(`IP blocked: ${ip}`, { reason });

    // Here you would integrate with firewall/network security systems
  }

  async triggerIncidentResponse(threat) {
    const incident = {
      id: this.generateIncidentId(),
      threatId: threat.id,
      severity: threat.severity,
      status: 'open',
      timestamp: Date.now(),
      actions: [],
      containment: false
    };

    // Auto-containment if enabled
    if (this.config.incidentResponse.autoContainment) {
      const containmentActions = await this.executeContainment(threat);
      incident.actions.push(...containmentActions);
      incident.containment = true;
    }

    this.emit('incidentCreated', incident);
  }

  async executeContainment(threat) {
    const actions = [];

    if (this.config.incidentResponse.isolation.enabled) {
      if (threat.source_ip && this.config.incidentResponse.isolation.actions.includes('block_ip')) {
        await this.blockIP(threat.source_ip, threat.type);
        actions.push({ type: 'block_ip', target: threat.source_ip });
      }

      if (threat.user_id && this.config.incidentResponse.isolation.actions.includes('disable_user')) {
        await this.disableUser(threat.user_id);
        actions.push({ type: 'disable_user', target: threat.user_id });
      }
    }

    return actions;
  }

  async sendThreatAlert(threat) {
    const alert = {
      id: this.generateAlertId(),
      threatId: threat.id,
      type: threat.type,
      severity: threat.severity,
      confidence: threat.confidence,
      message: this.generateThreatMessage(threat),
      timestamp: Date.now()
    };

    this.emit('threatAlert', alert);

    // Here you would integrate with notification systems
    this.warn(`Threat alert: ${threat.type}`, {
      severity: threat.severity,
      confidence: threat.confidence,
      source_ip: threat.source_ip,
      user_id: threat.user_id
    });
  }

  // Utility methods
  generateEventId() {
    return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  generateThreatId() {
    return `thr_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  generateIncidentId() {
    return `inc_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  generateAlertId() {
    return `alt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  calculateEventSeverity(eventType, eventData) {
    if (eventData.outcome === 'failure' || eventData.status === 'error') {
      return 'high';
    } else if (eventType === 'authentication') {
      return eventData.outcome === 'success' ? 'low' : 'medium';
    } else if (eventType === 'intrusion') {
      return 'critical';
    }
    return 'medium';
  }

  getIPReputation(ip) {
    const ipReputation = this.threatIntelligence.get('ip-reputation');
    return ipReputation ? ipReputation.get(ip) : null;
  }

  shouldBlockIP(threat) {
    // Block if threat severity is high or critical
    if (threat.severity === 'high' || threat.severity === 'critical') {
      return true;
    }

    // Block if IP has bad reputation
    const reputation = this.getIPReputation(threat.source_ip);
    if (reputation && reputation.score < 0.3) {
      return true;
    }

    return false;
  }

  async getIPLocation(ip) {
    // Simplified IP geolocation
    // In production, use a proper geolocation service
    return {
      country: 'Unknown',
      city: 'Unknown',
      latitude: 0,
      longitude: 0
    };
  }

  isSuspiciousLocation(userLocations, currentLocation) {
    if (!currentLocation || currentLocation.country === 'Unknown') {
      return false;
    }

    // Check if user has never accessed from this country
    const previousCountries = userLocations.map(loc => loc.country).filter(Boolean);
    return !previousCountries.includes(currentLocation.country);
  }

  calculateLocationRisk(userLocations, currentLocation) {
    // Simple risk calculation based on location novelty
    const previousCountries = userLocations.map(loc => loc.country).filter(Boolean);
    const isNewCountry = !previousCountries.includes(currentLocation.country);

    return {
      novelty: isNewCountry ? 1.0 : 0.0,
      distance: this.calculateMaxDistance(userLocations, currentLocation),
      risk: isNewCountry ? 0.8 : 0.2
    };
  }

  isImpossibleTravel(lastLogin, currentLogin) {
    if (!lastLogin || !currentLogin) return false;

    const timeDiff = currentLogin.timestamp - lastLogin.timestamp;
    const maxDistance = this.calculateMaxDistance([lastLogin.location], currentLogin.location);

    // Calculate if travel was impossible (> 800 km/h average speed)
    const maxSpeedKmh = 800;
    const possibleDistance = (timeDiff / 1000 / 3600) * maxSpeedKmh;

    return maxDistance > possibleDistance;
  }

  calculateMaxDistance(locations, target) {
    // Simplified distance calculation
    // In production, use proper haversine formula
    return 0;
  }

  async extractBehavioralFeatures(event) {
    // Extract behavioral features for ML analysis
    return {
      hour: new Date(event.timestamp).getHours(),
      dayOfWeek: new Date(event.timestamp).getDay(),
      actionType: this.hashAction(event.data.action),
      resourceType: this.hashResource(event.data.resource),
      userAgentHash: event.data.user_agent ? this.hashString(event.data.user_agent) : 0
    };
  }

  hashAction(action) {
    const hash = crypto.createHash('md5');
    hash.update(action);
    return parseInt(hash.digest('hex').substring(0, 8), 16);
  }

  hashResource(resource) {
    const hash = crypto.createHash('md5');
    hash.update(resource);
    return parseInt(hash.digest('hex').substring(0, 8), 16);
  }

  hashString(str) {
    const hash = crypto.createHash('md5');
    hash.update(str);
    return parseInt(hash.digest('hex').substring(0, 8), 16);
  }

  generateThreatMessage(threat) {
    const messages = {
      brute_force: `Brute force attack detected from ${threat.source_ip}`,
      suspicious_location: `Suspicious login location for user ${threat.user_id}`,
      impossible_travel: `Impossible travel detected for user ${threat.user_id}`,
      unauthorized_access: `Multiple unauthorized access attempts by user ${threat.user_id}`,
      privilege_escalation: `Privilege escalation attempt by user ${threat.user_id}`,
      port_scan: `Port scan detected from ${threat.source_ip}`,
      dos_attack: `DoS attack detected from ${threat.source_ip}`,
      data_exfiltration: `Potential data exfiltration by user ${threat.user_id}`,
      sensitive_data_access: `Unusual sensitive data access by user ${threat.user_id}`,
      behavioral_anomaly: `Behavioral anomaly detected for user ${threat.user_id}`
    };

    return messages[threat.type] || `Security threat detected: ${threat.type}`;
  }

  // Data persistence methods
  async storeSecurityEvent(event) {
    this.securityEvents.push(event);

    // Keep events within retention period
    const cutoffTime = Date.now() - (this.config.storage.retentionDays * 24 * 60 * 60 * 1000);
    this.securityEvents = this.securityEvents.filter(e => e.timestamp > cutoffTime);

    // Periodically save to disk
    if (this.securityEvents.length % 100 === 0) {
      await this.saveSecurityEvents();
    }
  }

  async saveSecurityEvents() {
    try {
      const eventsFile = path.join(this.config.storage.dataDir, 'events', 'security-events.json');
      const data = JSON.stringify(this.securityEvents, null, 2);

      if (this.config.storage.encryption) {
        const encryptedData = await this.encryptData(data);
        await fs.writeFile(eventsFile, encryptedData);
      } else {
        await fs.writeFile(eventsFile, data);
      }
    } catch (error) {
      this.warn('Failed to save security events', { error: error.message });
    }
  }

  async encryptData(data) {
    if (!this.config.storage.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(this.config.storage.encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(algorithm, key, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    });
  }

  async saveBaseline() {
    try {
      const baselineFile = path.join(this.config.storage.dataDir, 'baselines', 'system-baseline.json');
      const data = JSON.stringify(Object.fromEntries(this.systemBaseline), null, 2);
      await fs.writeFile(baselineFile, data);
    } catch (error) {
      this.warn('Failed to save baseline', { error: error.message });
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

  // Placeholder methods for data retrieval
  async getRecentAuthFailures(ip, window) { return []; }
  async getUserRecentLocations(userId) { return []; }
  async getLastUserLogin(userId) { return null; }
  async getRecentAuthDenials(userId, window) { return []; }
  async detectPrivilegeEscalation(event) { return null; }
  async getRecentPortScans(ip, window) { return []; }
  async getRecentRequests(ip, window) { return []; }
  async getRecentDataTransfers(userId, window) { return []; }
  async isSensitiveDataAccess(event) { return false; }
  async getUserSensitiveAccessHistory(userId) { return []; }
  async isUnusualSensitiveAccess(event, history) { return false; }
  async calculateSensitiveAccessRisk(event, history) { return 0.5; }
  async updateBaselines(event) { /* Implementation */ }
  async checkCompliance(event) { /* Implementation */ }
  async analyzeThreats() { /* Implementation */ }
  async updateThreatIntelligence() { /* Implementation */ }
  async generateComplianceReports() { /* Implementation */ }
  async cleanupOldData() { /* Implementation */ }
  async disableUser(userId) { /* Implementation */ }

  // Health check
  async healthCheck() {
    return {
      status: 'healthy',
      initialized: this.initialized,
      eventsProcessed: this.securityEvents.length,
      activeThreats: this.activeThreats.size,
      blockedIPs: this.blockedIPs.size,
      userProfiles: this.userProfiles.size,
      threatIntelligence: this.threatIntelligence.size
    };
  }

  // Logging methods
  info(message, metadata = {}) {
    console.log(`[SecurityMonitoring] ${message}`, metadata);
    this.emit('log', { level: 'info', message, metadata });
  }

  warn(message, metadata = {}) {
    console.warn(`[SecurityMonitoring] ${message}`, metadata);
    this.emit('log', { level: 'warn', message, metadata });
  }

  debug(message, metadata = {}) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[SecurityMonitoring] ${message}`, metadata);
      this.emit('log', { level: 'debug', message, metadata });
    }
  }

  // Graceful shutdown
  async shutdown() {
    this.info('Shutting down security monitoring system');

    // Save final state
    await this.saveSecurityEvents();
    await this.saveBaseline();

    this.initialized = false;
    this.emit('shutdown');
  }
}

export default SecurityMonitoring;