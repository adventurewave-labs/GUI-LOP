import { DomainEvent } from '../domain-event.js';
import { ValidationError } from '../errors.js';

const baseProps = () => ({
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'TestHappened',
  eventVersion: 1,
  occurredAt: '2026-05-10T00:00:00.000Z',
  aggregateId: '22222222-2222-4222-8222-222222222222',
  aggregateType: 'TestAggregate',
  correlationId: '33333333-3333-4333-8333-333333333333',
  actor: { id: 'system', type: 'system' },
  payload: { foo: 'bar' },
});

describe('DomainEvent', () => {
  test('constructs with all required fields', () => {
    const e = new DomainEvent(baseProps());
    expect(e.eventType).toBe('TestHappened');
    expect(e.causationId).toBeNull();
    expect(Object.isFrozen(e)).toBe(true);
  });

  test('accepts optional causationId', () => {
    const props = { ...baseProps(), causationId: '44444444-4444-4444-8444-444444444444' };
    const e = new DomainEvent(props);
    expect(e.causationId).toBe(props.causationId);
  });

  test('toJSON yields a serialisable envelope', () => {
    const e = new DomainEvent(baseProps());
    const j = e.toJSON();
    expect(j).toMatchObject({
      eventType: 'TestHappened',
      eventVersion: 1,
      payload: { foo: 'bar' },
    });
    expect(JSON.stringify(j)).toContain('TestHappened');
  });

  test('throws when required field missing', () => {
    const props = baseProps();
    delete props.eventId;
    expect(() => new DomainEvent(props)).toThrow(ValidationError);
  });

  test('throws on bad eventVersion', () => {
    expect(() => new DomainEvent({ ...baseProps(), eventVersion: 0 })).toThrow(ValidationError);
    expect(() => new DomainEvent({ ...baseProps(), eventVersion: 'x' })).toThrow(ValidationError);
  });

  test('throws on missing props object', () => {
    expect(() => new DomainEvent(null)).toThrow(ValidationError);
  });
});
