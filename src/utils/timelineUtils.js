/**
 * Helper utilities for managing match goal events, chronological order, and running scores.
 */

/**
 * Computes running scores and metadata for a sorted list of goal events.
 * 
 * @param {Array} events - Goal events sorted chronologically by created_at
 * @param {string} opponentName - Opponent team name
 * @param {Array} squad - Squad players array
 * @returns {Array} List of enriched timeline items
 */
export function computeTimelineWithScores(events = [], opponentName = 'Opposition', squad = []) {
  let teamScore = 0;
  let oppScore = 0;

  return events.map((event, index) => {
    const isOpponent = event.scorer_id === 'OPPONENT';
    const isUnassigned = event.scorer_id === 'UNASSIGNED' || !event.scorer_id;

    if (isOpponent) {
      oppScore += 1;
    } else {
      teamScore += 1;
    }

    const scorerPlayer = !isOpponent && !isUnassigned ? squad.find((p) => p.id === event.scorer_id) : null;
    const assisterPlayer = event.assister_id ? squad.find((p) => p.id === event.assister_id) : null;

    return {
      ...event,
      orderNumber: index + 1,
      isOpponent,
      isUnassigned,
      scorerName: isOpponent ? `${opponentName} Goal` : isUnassigned ? 'Unassigned Team Goal' : (scorerPlayer ? scorerPlayer.name : 'Unknown Player'),
      assisterName: assisterPlayer ? assisterPlayer.name : null,
      teamScoreAfter: teamScore,
      oppScoreAfter: oppScore,
      scoreFormatted: `${teamScore} - ${oppScore}`
    };
  });
}

/**
 * Returns a new array with an event moved from one index to another,
 * with created_at timestamps re-spaced so chronological order is preserved in DB.
 * 
 * @param {Array} events - Array of events
 * @param {number} fromIndex - Original index
 * @param {number} toIndex - Target index
 * @param {string|Date} baseDate - Base match date
 * @returns {Array} Reordered events with new created_at timestamps
 */
export function reorderTimelineEvents(events, fromIndex, toIndex, baseDate = new Date()) {
  const result = [...events];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);

  // Preserve existing timestamp window or fall back to match date at 12:00:00 UTC
  let startTimestamp;
  const validTimes = events
    .map((e) => (e.created_at ? new Date(e.created_at).getTime() : 0))
    .filter((t) => !isNaN(t) && t > 0);

  if (validTimes.length > 0) {
    startTimestamp = Math.min(...validTimes);
  } else if (baseDate) {
    const d = new Date(baseDate);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(12, 0, 0, 0);
      startTimestamp = d.getTime();
    } else {
      startTimestamp = Date.now();
    }
  } else {
    startTimestamp = Date.now();
  }

  return result.map((item, idx) => ({
    ...item,
    created_at: new Date(startTimestamp + idx * 10000).toISOString()
  }));
}

/**
 * For retroactive ordering on previous matches:
 * Examines existing goal events against match stats and creates any missing events.
 * Newly missing events are appended AFTER any existing events so they are not dumped at midnight.
 * 
 * @param {Object} match - The match object with team_goals, opponent_goals, stats
 * @param {Array} playersInMatch - Players array with their goals
 * @param {Array} existingEvents - Existing goal_events for this match
 * @returns {Array} List of new event objects to insert
 */
export function generateMissingTimelineEvents(match, playersInMatch = [], existingEvents = []) {
  const newEventsToInsert = [];

  // Find reference timestamp for newly added missing events:
  // If there are already events with timestamps, append new events AFTER them!
  let baseTime;
  if (existingEvents && existingEvents.length > 0) {
    const validTimes = existingEvents
      .map((e) => (e.created_at ? new Date(e.created_at).getTime() : 0))
      .filter((t) => !isNaN(t) && t > 0);

    if (validTimes.length > 0) {
      baseTime = Math.max(...validTimes) + 10000;
    }
  }

  if (!baseTime) {
    if (match.date) {
      const d = new Date(match.date);
      if (!isNaN(d.getTime())) {
        d.setUTCHours(12, 0, 0, 0);
        baseTime = d.getTime();
      } else {
        baseTime = Date.now();
      }
    } else {
      baseTime = Date.now();
    }
  }

  let timeOffsetCounter = 0;

  // 1. Account for player goals
  playersInMatch.forEach((player) => {
    const existingPlayerCount = existingEvents.filter((e) => e.scorer_id === player.id).length;
    const missingCount = Math.max(0, (player.goals || 0) - existingPlayerCount);

    for (let i = 0; i < missingCount; i++) {
      newEventsToInsert.push({
        match_id: match.id,
        scorer_id: player.id,
        assister_id: null,
        created_at: new Date(baseTime + timeOffsetCounter * 10000).toISOString()
      });
      timeOffsetCounter++;
    }
  });

  // 2. Account for unassigned team goals (if team_goals > already accounted team events)
  const existingTeamCount = existingEvents.filter((e) => e.scorer_id !== 'OPPONENT').length;
  const queuedTeamCount = newEventsToInsert.filter((e) => e.scorer_id !== 'OPPONENT').length;
  const missingTeamGoals = Math.max(0, (match.team_goals || 0) - (existingTeamCount + queuedTeamCount));

  for (let i = 0; i < missingTeamGoals; i++) {
    newEventsToInsert.push({
      match_id: match.id,
      scorer_id: 'UNASSIGNED',
      assister_id: null,
      created_at: new Date(baseTime + timeOffsetCounter * 10000).toISOString()
    });
    timeOffsetCounter++;
  }

  // 3. Account for opponent goals
  const existingOpponentCount = existingEvents.filter((e) => e.scorer_id === 'OPPONENT').length;
  const missingOpponentCount = Math.max(0, (match.opponent_goals || 0) - existingOpponentCount);

  for (let i = 0; i < missingOpponentCount; i++) {
    newEventsToInsert.push({
      match_id: match.id,
      scorer_id: 'OPPONENT',
      assister_id: null,
      created_at: new Date(baseTime + timeOffsetCounter * 10000).toISOString()
    });
    timeOffsetCounter++;
  }

  return newEventsToInsert;
}
