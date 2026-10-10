const sessions = new Map();

function getOrCreateSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            sessionId,
            flags: [],
            transcriptSegments: [],
        });
    }

    return sessions.get(sessionId);
}

/** Stores a whole prepared session, replacing any with the same id. Used by the seed loader. */
export function putSession(session) {
    sessions.set(session.sessionId, session);
}

export function addFlag(sessionId, flag) {
    const session = getOrCreateSession(sessionId);

    const savedFlag = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...flag,
    };

    session.flags.push(savedFlag);

    return savedFlag;
}

export function getDashboardData(sessionId) {
    const session = getOrCreateSession(sessionId);

    const flagsByType = session.flags.reduce((counts, flag) => {
        counts[flag.flagType] = (counts[flag.flagType] || 0) + 1;
        return counts;
    }, {});

    return {
        sessionId,
        totalFlags: session.flags.length,
        flagsByType,
        flags: session.flags,
    };
}


