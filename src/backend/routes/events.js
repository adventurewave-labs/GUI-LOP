/**
 * AG-UI Protocol Events API Routes
 * Handles agent-UI communication events
 */

import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { AGUIProtocolService } from '../services/agui-protocol.js';
import { DatabaseService } from '../services/database.js';

const router = express.Router();

// Initialize services (in production, these would be injected)
const dbService = new DatabaseService();
const aguiService = new AGUIProtocolService(dbService);

// Middleware to validate requests
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  next();
};

/**
 * POST /api/events
 * Send an AG-UI protocol event
 */
router.post('/', [
  body('type')
    .isIn(['tool_input_request', 'ui_update', 'approval_request', 'data_display', 'workflow_status'])
    .withMessage('Invalid event type'),
  body('session_id').isUUID().withMessage('Valid session ID required'),
  body('workflow_id').optional().isUUID().withMessage('Valid workflow ID required'),
  body('data').isObject().withMessage('Event data must be an object'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid priority'),
], validateRequest, async (req, res) => {
  try {
    const { type, session_id, workflow_id, data, priority = 'medium' } = req.body;

    // Create event
    const event = {
      id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      session_id,
      workflow_id,
      data,
      priority,
      timestamp: new Date().toISOString(),
      source: 'agent',
    };

    // Send event via AG-UI service
    await aguiService.sendEvent(session_id, event);

    // Store event in database
    await dbService.createEvent(event);

    res.status(201).json({
      success: true,
      event_id: event.id,
      timestamp: event.timestamp,
      message: 'Event sent successfully',
    });

  } catch (error) {
    console.error('Error sending event:', error);
    res.status(500).json({
      error: 'Failed to send event',
      details: error.message,
    });
  }
});

/**
 * GET /api/events
 * Get events for a session or workflow
 */
router.get('/', [
  query('session_id').isUUID().withMessage('Valid session ID required'),
  query('workflow_id').optional().isUUID().withMessage('Valid workflow ID required'),
  query('type').optional().isIn(['tool_input_request', 'ui_update', 'approval_request', 'data_display', 'workflow_status']).withMessage('Invalid event type'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
], validateRequest, async (req, res) => {
  try {
    const { session_id, workflow_id, type, limit = 100, offset = 0 } = req.query;

    const events = await dbService.getEvents({
      session_id,
      workflow_id,
      type,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      success: true,
      events,
      count: events.length,
      session_id,
      workflow_id,
      type,
    });

  } catch (error) {
    console.error('Error getting events:', error);
    res.status(500).json({
      error: 'Failed to retrieve events',
      details: error.message,
    });
  }
});

/**
 * GET /api/events/:event_id
 * Get a specific event by ID
 */
router.get('/:event_id', [
  param('event_id').isLength({ min: 1 }).withMessage('Event ID required'),
], validateRequest, async (req, res) => {
  try {
    const { event_id } = req.params;

    const event = await dbService.getEvent(event_id);

    if (!event) {
      return res.status(404).json({
        error: 'Event not found',
        event_id,
      });
    }

    res.json({
      success: true,
      event,
    });

  } catch (error) {
    console.error('Error getting event:', error);
    res.status(500).json({
      error: 'Failed to retrieve event',
      details: error.message,
    });
  }
});

/**
 * POST /api/events/:event_id/response
 * Respond to an event (for human interaction)
 */
router.post('/:event_id/response', [
  param('event_id').isLength({ min: 1 }).withMessage('Event ID required'),
  body('response').isObject().withMessage('Response must be an object'),
  body('user_id').optional().isUUID().withMessage('Valid user ID required'),
], validateRequest, async (req, res) => {
  try {
    const { event_id } = req.params;
    const { response, user_id } = req.body;

    // Get original event
    const originalEvent = await dbService.getEvent(event_id);
    if (!originalEvent) {
      return res.status(404).json({
        error: 'Event not found',
        event_id,
      });
    }

    // Create response event
    const responseEvent = {
      id: `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'event_response',
      session_id: originalEvent.session_id,
      workflow_id: originalEvent.workflow_id,
      original_event_id: event_id,
      data: response,
      user_id,
      timestamp: new Date().toISOString(),
      source: 'human',
    };

    // Store response
    await dbService.createEvent(responseEvent);

    // Process the response based on original event type
    await aguiService.processEventResponse(originalEvent, responseEvent);

    res.status(201).json({
      success: true,
      response_id: responseEvent.id,
      timestamp: responseEvent.timestamp,
      message: 'Response processed successfully',
    });

  } catch (error) {
    console.error('Error processing event response:', error);
    res.status(500).json({
      error: 'Failed to process response',
      details: error.message,
    });
  }
});

/**
 * POST /api/events/batch
 * Send multiple events in batch
 */
router.post('/batch', [
  body('events').isArray({ min: 1, max: 100 }).withMessage('Events array required (1-100 items)'),
  body('events.*.type').isIn(['tool_input_request', 'ui_update', 'approval_request', 'data_display', 'workflow_status']).withMessage('Invalid event type in events array'),
  body('events.*.session_id').isUUID().withMessage('Valid session ID required in events array'),
  body('events.*.data').isObject().withMessage('Event data must be an object in events array'),
], validateRequest, async (req, res) => {
  try {
    const { events } = req.body;

    const results = [];
    const errors = [];

    for (let i = 0; i < events.length; i++) {
      try {
        const eventData = events[i];
        const event = {
          id: `event_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`,
          ...eventData,
          timestamp: new Date().toISOString(),
          source: 'agent',
        };

        await aguiService.sendEvent(event.session_id, event);
        await dbService.createEvent(event);

        results.push({
          index: i,
          event_id: event.id,
          success: true,
        });

      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          success: false,
        });
      }
    }

    res.status(201).json({
      success: true,
      results,
      errors,
      total_events: events.length,
      successful_events: results.length,
      failed_events: errors.length,
    });

  } catch (error) {
    console.error('Error sending batch events:', error);
    res.status(500).json({
      error: 'Failed to send batch events',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/events/:event_id
 * Delete an event (admin only)
 */
router.delete('/:event_id', [
  param('event_id').isLength({ min: 1 }).withMessage('Event ID required'),
], validateRequest, async (req, res) => {
  try {
    const { event_id } = req.params;

    // Check if event exists
    const event = await dbService.getEvent(event_id);
    if (!event) {
      return res.status(404).json({
        error: 'Event not found',
        event_id,
      });
    }

    // Delete event
    await dbService.deleteEvent(event_id);

    res.json({
      success: true,
      message: 'Event deleted successfully',
      event_id,
    });

  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({
      error: 'Failed to delete event',
      details: error.message,
    });
  }
});

/**
 * GET /api/events/streams/:session_id
 * Get Server-Sent Events stream for a session
 */
router.get('/streams/:session_id', [
  param('session_id').isUUID().withMessage('Valid session ID required'),
], validateRequest, async (req, res) => {
  try {
    const { session_id } = req.params;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({
      type: 'connection',
      session_id,
      timestamp: new Date().toISOString(),
      message: 'Connected to event stream',
    })}\n\n`);

    // Set up event stream subscription
    const subscription = aguiService.subscribeToEvents(session_id, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Handle client disconnect
    req.on('close', () => {
      subscription.unsubscribe();
      console.log(`Client disconnected from stream: ${session_id}`);
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });

  } catch (error) {
    console.error('Error setting up event stream:', error);
    res.status(500).json({
      error: 'Failed to set up event stream',
      details: error.message,
    });
  }
});

/**
 * GET /api/events/sessions/:session_id/summary
 * Get event summary for a session
 */
router.get('/sessions/:session_id/summary', [
  param('session_id').isUUID().withMessage('Valid session ID required'),
], validateRequest, async (req, res) => {
  try {
    const { session_id } = req.params;

    const summary = await dbService.getEventSummary(session_id);

    res.json({
      success: true,
      session_id,
      summary,
    });

  } catch (error) {
    console.error('Error getting event summary:', error);
    res.status(500).json({
      error: 'Failed to get event summary',
      details: error.message,
    });
  }
});

export default router;