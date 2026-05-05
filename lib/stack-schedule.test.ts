import test from 'node:test';
import assert from 'node:assert/strict';

import { HALF_HOUR_SLOTS, getScheduleOccupancy, getScheduleSlotSummary } from './stack-schedule';

test('builds 48 half-hour slots for a day', () => {
    assert.equal(HALF_HOUR_SLOTS.length, 48);
    assert.equal(HALF_HOUR_SLOTS[0].start, '00:00');
    assert.equal(HALF_HOUR_SLOTS[0].label, '00:00-00:30');
    assert.equal(HALF_HOUR_SLOTS[47].label, '23:30-00:00');
});

test('maps legacy schedule time into the containing half-hour slot', () => {
    const summary = getScheduleSlotSummary({ frequency: 'daily', time: '21:10' });

    assert.deepEqual(summary, {
        frequency: 'daily',
        frequencyLabel: 'Daily',
        slotIndex: 42,
        slotLabel: '21:00-21:30',
        dayOfWeek: undefined,
        dayLabel: undefined,
        key: 'daily:42',
    });
});

test('returns null summary for manual schedules', () => {
    assert.equal(getScheduleSlotSummary({ frequency: 'manual', time: '21:00' }), null);
});

test('computes daily occupancy from other daily schedules only', () => {
    const occupancy = getScheduleOccupancy(
        {
            alpha: { frequency: 'daily', time: '21:10' },
            bravo: { frequency: 'daily', time: '21:30' },
            charlie: { frequency: 'weekly', time: '21:00', dayOfWeek: 0 },
            delta: { frequency: 'manual' },
        },
        { frequency: 'daily', excludeStackName: 'delta' }
    );

    assert.deepEqual(occupancy[42], { count: 1, stackNames: ['alpha'] });
    assert.deepEqual(occupancy[43], { count: 1, stackNames: ['bravo'] });
    assert.equal(occupancy[0], undefined);
});

test('computes weekly occupancy only for the selected weekday', () => {
    const occupancy = getScheduleOccupancy(
        {
            alpha: { frequency: 'weekly', time: '21:10', dayOfWeek: 1 },
            bravo: { frequency: 'weekly', time: '21:30', dayOfWeek: 2 },
            charlie: { frequency: 'daily', time: '21:00' },
        },
        { frequency: 'weekly', dayOfWeek: 1, excludeStackName: 'charlie' }
    );

    assert.deepEqual(occupancy[42], { count: 1, stackNames: ['alpha'] });
    assert.equal(occupancy[43], undefined);
});
