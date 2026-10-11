export const BUILDINGS = [
  { id: 'home', name: 'Your cottage', cost: 0, color: '#e99776', icon: '🏡', x: 13, y: 32, description: 'A little home for a curious mind. Every city starts somewhere.' },
  { id: 'garden', name: 'Pocket park', cost: 20, color: '#83ad75', icon: '🌳', x: 37, y: 32, description: 'A soft patch of green for your citizens to take a breather.' },
  { id: 'library', name: 'Little library', cost: 45, color: '#9b91ca', icon: '📚', x: 63, y: 32, description: 'A home for all the ideas you are collecting.' },
  { id: 'cafe', name: 'Cozy café', cost: 35, color: '#e8af66', icon: '☕', x: 25, y: 75, description: 'Warm drinks, window seats, and excellent company.' },
  { id: 'observatory', name: 'Star lookout', cost: 70, color: '#7dabc0', icon: '🔭', x: 51, y: 75, description: 'For the questions that lead somewhere unexpected.' },
  { id: 'hall', name: 'Town hall', cost: 90, color: '#d89fae', icon: '🏛️', x: 78, y: 75, description: 'Your growing neighbourhood now has a place to come together.' },
]

export const QUESTS = [
  { id: 'deck', title: 'Open a learning district', detail: 'Upload a lecture PDF', coins: 15 },
  { id: 'note', title: 'Collect an idea', detail: 'Write 20 words of notes on this slide', coins: 20 },
  { id: 'flag', title: 'Ask a good question', detail: 'Send a flag about this slide', coins: 15 },
  { id: 'catchup', title: 'Find your way back', detail: 'Use Catch me up when you need it', coins: 10 },
]

export const INITIAL_CITY = { coins: 25, xp: 0, built: ['home'], rewards: {}, quiet: false, night: false, notice: null }

export function rewardKey(kind, deckKey, slide) {
  return JSON.stringify([kind, deckKey, kind === 'deck' ? null : slide])
}

// Duplicate rewards and purchases are rejected here, including rapid clicks.
export function cityReducer(state, action) {
  if (action.type === 'reward') {
    const quest = QUESTS.find((entry) => entry.id === action.kind)
    if (!quest || !action.deckKey) return state
    const key = rewardKey(action.kind, action.deckKey, action.slide)
    if (state.rewards[key]) return state
    return {
      ...state, coins: state.coins + quest.coins, xp: state.xp + quest.coins,
      rewards: { ...state.rewards, [key]: true },
      notice: { id: action.id, text: `${quest.title} · +${quest.coins} coins & XP` },
    }
  }
  if (action.type === 'build') {
    const building = BUILDINGS.find((entry) => entry.id === action.building)
    if (!building || state.built.includes(building.id) || state.coins < building.cost) return state
    return {
      ...state, coins: state.coins - building.cost, built: [...state.built, building.id],
      notice: { id: action.id, text: `${building.name} is open! A new little corner of your city.` },
    }
  }
  if (action.type === 'quiet') return { ...state, quiet: !state.quiet }
  if (action.type === 'night') return { ...state, night: !state.night }
  return state
}

export function restoreCity(raw) {
  try {
    const saved = JSON.parse(raw)
    if (!saved || !Number.isSafeInteger(saved.coins) || saved.coins < 0
      || !Number.isSafeInteger(saved.xp) || saved.xp < 0
      || !Array.isArray(saved.built) || !saved.rewards || typeof saved.rewards !== 'object') return INITIAL_CITY
    return { ...INITIAL_CITY, ...saved, built: [...new Set(['home', ...saved.built.filter((id) => BUILDINGS.some((b) => b.id === id))])], notice: null }
  } catch {
    return INITIAL_CITY
  }
}
