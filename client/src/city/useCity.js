import { useEffect, useReducer } from 'react'
import { cityReducer, INITIAL_CITY, restoreCity } from './cityState'

export function useCity(storageKey = 'lockin.city.v1') {
  const [city, dispatch] = useReducer(cityReducer, undefined, () => {
    try { return restoreCity(localStorage.getItem(storageKey)) }
    catch { return INITIAL_CITY }
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...city, notice: null })) }
    catch { /* The city stays playable in memory if browser storage is full. */ }
  }, [city, storageKey])
  return {
    ...city,
    reward: (kind, deckKey, slide) => dispatch({ type: 'reward', kind, deckKey, slide, id: crypto.randomUUID() }),
    build: (building) => dispatch({ type: 'build', building, id: crypto.randomUUID() }),
    toggleQuiet: () => dispatch({ type: 'quiet' }),
    toggleNight: () => dispatch({ type: 'night' }),
  }
}
