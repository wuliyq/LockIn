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

export function addTranscriptSegment(sessionId, segment) {
    if (!segment.text?.trim()) {
        throw new Error("Transcript segment text is required.");
    }

    const session = getOrCreateSession(sessionId);
    const savedSegment = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...segment,
        text: segment.text.trim(),
    };

    session.transcriptSegments.push(savedSegment);
    return savedSegment;
}

export function getRecentTranscript(sessionId, slideNumber, maxSegments = 4) {
    const session = getOrCreateSession(sessionId);

    return session.transcriptSegments
        .filter((segment) => segment.slideNumber === slideNumber)
        .slice(-maxSegments)
        .map((segment) => segment.text)
        .join(" ");
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


export function getFlags(sessionId) {
    return getOrCreateSession(sessionId).flags;
}

/** Replace a session's flags (used to load the sample lecture). */
export function replaceFlags(sessionId, flags) {
    const session = getOrCreateSession(sessionId);
    session.flags = flags.map((flag) => ({ id: crypto.randomUUID(), ...flag }));
    return session.flags;
}
