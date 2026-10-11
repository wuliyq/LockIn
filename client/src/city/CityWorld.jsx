import { useState } from 'react'
import { BUILDINGS, QUESTS, rewardKey } from './cityState'
import './CityWorld.css'

export default function CityWorld({ li }) {
  const { city } = li
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState('garden')
  const [greeting, setGreeting] = useState(0)
  const building = BUILDINGS.find((entry) => entry.id === selected)
  const built = city.built.includes(selected)
  const level = Math.floor(city.xp / 100) + 1
  const greetings = ['A little idea can grow a whole city.', 'One sentence at a time. I’m right here.', 'Questions are how we find new paths.', 'Your next little discovery is waiting.']
  const complete = (quest) => Boolean(city.rewards[rewardKey(quest.id, li.deck?.filename ?? '', li.current)])

  return (
    <section className={`city-world ${city.night ? 'is-night' : ''} ${city.quiet ? 'is-quiet' : ''}`} aria-label="Your growing study city">
      <div className="city-world__bar">
        <div className="city-world__identity"><span aria-hidden="true">✦</span><strong>{li.citizen.district}</strong><span className="city-world__level">Lv. {level} · {city.built.length < 3 ? 'Little neighbourhood' : city.built.length < 6 ? 'Growing town' : 'Thriving city'}</span></div>
        <div className="city-world__tools">
          <span className="city-world__coins" aria-label={`${city.coins} city coins`}>🪙 {city.coins}</span>
          <button type="button" onClick={city.toggleNight} aria-label={city.night ? 'Switch city to daytime' : 'Switch city to nighttime'}>{city.night ? '☀ Day' : '☾ Night'}</button>
          <button type="button" onClick={city.toggleQuiet} aria-pressed={city.quiet}>{city.quiet ? '▶ Animate' : 'Ⅱ Quiet city'}</button>
          <button type="button" aria-expanded={!collapsed} aria-controls="city-world-content" onClick={() => setCollapsed(!collapsed)}>{collapsed ? 'Show city ↓' : 'Hide city ↑'}</button>
        </div>
      </div>
      {!collapsed && <div className="city-world__content" id="city-world-content">
        <div className="city-world__map" aria-label="Interactive neighbourhood map">
          <svg className="city-world__land" viewBox="0 0 1000 250" preserveAspectRatio="none" aria-hidden="true">
            <path className="city-world__river" d="M880 -20 Q790 70 890 140 T900 280" fill="none" strokeWidth="110" />
            <path d="M880 -20 Q790 70 890 140 T900 280" fill="none" stroke="#ffffff" strokeOpacity=".3" strokeWidth="2" strokeDasharray="20 30" />
            <path d="M0 128H1000 M230 128V270 M610 0V128" stroke="#d4c3a2" strokeWidth="24" fill="none" />
            <path d="M0 128H1000 M230 128V270 M610 0V128" stroke="#f8ecd1" strokeWidth="17" fill="none" />
            <path d="M839 114H938 M839 142H938" stroke="#b18c63" strokeWidth="6" />
          </svg>
          <span className="city-world__cloud city-world__cloud--one" aria-hidden="true">☁</span>
          <span className="city-world__cloud city-world__cloud--two" aria-hidden="true">☁</span>
          {[[4,72],[8,82],[45,12],[73,18],[94,29],[95,77],[66,88]].map(([x,y]) => <span key={x} className="city-world__tree" style={{left:`${x}%`,top:`${y}%`}} aria-hidden="true">🌳</span>)}
          {BUILDINGS.map((plot) => {
            const isBuilt = city.built.includes(plot.id)
            return <button key={plot.id} type="button" className={`city-world__plot ${isBuilt ? 'is-built' : 'is-empty'} ${selected === plot.id ? 'is-selected' : ''}`} style={{left:`${plot.x}%`,top:`${plot.y}%`, '--roof':plot.color}} onClick={() => setSelected(plot.id)} aria-pressed={selected === plot.id} aria-label={`${plot.name}, ${isBuilt ? 'built' : `${plot.cost} coins to build`}`}>
              {isBuilt ? <BuildingArt id={plot.id} /> : <span className="city-world__construction" aria-hidden="true">＋</span>}
              <span className="city-world__plot-name">{plot.name}{!isBuilt && <small>🪙 {plot.cost}</small>}</span>
            </button>
          })}
          <button type="button" className="city-world__walker is-walking" onClick={() => setGreeting((value) => value + 1)} aria-label={`Say hello to ${li.citizen.name}`}><span aria-hidden="true">{li.citizen.emoji}</span></button>
          <span className="city-world__boat" aria-hidden="true">⛵</span>
          <span className="city-world__visitor" aria-hidden="true">🐥</span>
          <span className="city-world__butterfly" aria-hidden="true">🦋</span>
          {city.built.includes('cafe') && <span className="city-world__neighbour" aria-hidden="true">🐰</span>}
          <span className="city-world__map-label">YOUR LITTLE CORNER OF THE WORLD</span>
        </div>
        <div className="city-world__quests">
          <div className="city-world__quest-title"><strong>Town noticeboard</strong><span>{QUESTS.filter(complete).length}/{QUESTS.length}</span></div>
          <p>Little steps, a livelier city.</p>
          {QUESTS.map((quest) => <div key={quest.id} className={`city-world__quest ${complete(quest) ? 'is-done' : ''}`} title={quest.detail}>
            <span aria-hidden="true">{complete(quest) ? '✓' : '○'}</span><div><b>{quest.title}</b><small>{quest.detail}</small></div><strong>{complete(quest) ? 'Done' : `+${quest.coins}`}</strong>
          </div>)}
          <div className="city-world__xp"><span>Next level</span><progress value={city.xp % 100} max="100" aria-label="Progress to next city level" /><span>{city.xp % 100}/100 XP</span></div>
        </div>
        <div className="city-world__detail">
          <span className="city-world__detail-icon" aria-hidden="true">{building.icon}</span>
          <div><strong>{building.name}</strong><p>{building.description}</p></div>
          {built ? <span className="city-world__built-label">✓ Part of your city</span> : <button type="button" className="city-world__build" disabled={city.coins < building.cost} onClick={() => city.build(building.id)}>{city.coins >= building.cost ? `Build · ${building.cost} coins` : `${building.cost - city.coins} more coins needed`}</button>}
        </div>
        <div className="city-world__greeting"><span aria-hidden="true">{li.citizen.emoji}</span><p key={greeting}>{greetings[greeting % greetings.length]}<small>Tap your wandering citizen to say hello.</small></p></div>
      </div>}
      <div className="city-world__reward" role="status" key={city.notice?.id ?? 'welcome'}>{city.notice ? `✦ ${city.notice.text}` : city.built.length > 1 || city.xp > 0 ? 'Your city is saved. Collect another idea to grow your neighbourhood.' : 'Welcome gift: 25 coins. Choose the pocket park and build your first place.'}<small>City saved in this browser · rewards once per slide; PDF reward once per file</small></div>
    </section>
  )
}

function BuildingArt({ id }) {
  if (id === 'garden') return <svg className="city-world__building" viewBox="0 0 100 90" aria-hidden="true"><ellipse cx="50" cy="76" rx="45" ry="11" fill="#78a963"/><path d="M25 75V34 M69 75V25" stroke="#996f50" strokeWidth="7"/><circle cx="25" cy="34" r="21" fill="#a4ce7e"/><circle cx="69" cy="27" r="24" fill="#7cb16f"/><path d="M36 73h23m-20-5h17" stroke="#f6d495" strokeWidth="5"/><circle cx="17" cy="77" r="3" fill="#ffd9a0"/><circle cx="80" cy="77" r="3" fill="#f5a3a6"/></svg>
  return <svg className="city-world__building" viewBox="0 0 100 90" aria-hidden="true">
    <ellipse cx="50" cy="80" rx="43" ry="8" fill="#416a53" opacity=".17"/>
    <rect x="18" y="31" width="64" height="48" rx="5" fill="#fff1d3" stroke="#d8c4a4"/>
    {id === 'observatory' ? <path d="M13 35a37 32 0 0 1 74 0Z" fill="var(--roof)"/> : <path d="M9 37L50 6l41 31Z" fill="var(--roof)" stroke="#000" strokeOpacity=".07" strokeWidth="3"/>}
    <rect x="41" y="57" width="18" height="22" rx="8" fill="#927561"/>
    <rect className="city-world__window" x="26" y="45" width="12" height="14" rx="3"/><rect className="city-world__window" x="63" y="45" width="12" height="14" rx="3"/>
    {id === 'cafe' && <path d="M19 40h62v9H19Z" fill="#f3ad8d"/>}
    {id === 'library' && <path d="M41 31h18v14l-9-3-9 3Z" fill="#fff1d3"/>}
    {id === 'hall' && <><path d="M50 7V-1h16v9Z" fill="#d57883"/><circle cx="50" cy="34" r="8" fill="#fff1d3"/><path d="M50 28v6h5" stroke="#725e52" fill="none"/></>}
    {id === 'home' && <path className="city-world__smoke" d="M72 19q-8-6 0-12t0-12" stroke="#fff" strokeWidth="5" opacity=".6" fill="none"/>}
  </svg>
}
