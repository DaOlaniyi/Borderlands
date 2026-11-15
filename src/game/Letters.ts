import type { Game } from './Game'

/**
 * Letters between the AI kingdoms: short messages in an old-fashioned voice (declarations, taunts, pleas for help, compliments...) that the
 * player sees scroll by on the left of the screen. They are pure flavour: nothing in the simulation reads them, and they draw no random numbers
 * (the choice of wording comes from a hash of the time and the two kingdoms), so a saved game stays identical.
 */
export type LetterKind = 'declare' | 'taunt' | 'insult' | 'peace' | 'alliance' | 'compliment' | 'plea' | 'threat' | 'boast' | 'betrayal' | 'thanks'
export type Letter = { id: number; t: number; from: number; to: number; kind: LetterKind; text: string }

type Tone = 'imperialist' | 'neutral' | 'pacifist'
/** {to} = the kingdom addressed, {from} = the writer, {foe} = a third party, {place} = a town or colony. */
const BANK: Record<LetterKind, Partial<Record<Tone | 'any', string[]>>> = {
  declare: {
    imperialist: [
      'Thy borders are but a hem upon my banner, {to}. We march at dawn.',
      'Bend the knee or burn, {to}. The choice is thine, and the hour is short.',
      'Let the heralds cry it: {from} is at war with thee, {to}, and the crown shall be mine.',
      'I shall have thy fields, {to}, and thy people shall learn a new name for their king.',
    ],
    neutral: [
      'Thy insolence at our border is answered, {to}. Steel shall now speak.',
      'We tried courtesy, {to}. Thou hast earned the sword instead.',
      'Our patience is spent, {to}. Look to thy walls.',
    ],
    pacifist: [
      'It grieves us, {to}, but thou hast left us no choice. We shall defend what is ours.',
      'We wished for peace, {to}. Thou hast brought us war; so be it.',
    ],
  },
  taunt: {
    any: [
      '{place} is ours now, {to}. Send word if thou wouldst like it back; we shall consider it.',
      'Thy walls fell like wheat before the scythe, {to}.',
      'We thank thee, {to}, for keeping {place} so warm for us.',
      'A fine town, {place}. It looks better under our banner, {to}.',
    ],
    imperialist: [
      'Another stone of thy crown is mine, {to}. Count the rest while thou canst.',
      '{place} was but the first, {to}. Pray the second is kinder.',
    ],
  },
  insult: {
    any: [
      'Thy soldiers fight like geese, {to}: loud, and soon roasted.',
      'I have seen better generalship in a hen coop, {to}.',
      'The crows grow fat upon thy levies, {to}.',
      'Thou art a boil upon the border, {to}, and we shall lance thee.',
      'Thy banner is a rag, {to}, and thy captains are worse.',
      'They say thy king is a toad in a crown, {to}. I say the toad is the wiser.',
    ],
  },
  peace: {
    any: [
      'Enough blood has watered these fields, {to}. We would parley.',
      'Let the horns sound for truce, {to}. Our granaries are as empty as thy pride.',
      'A ceasefire, {to}. Think not it is weakness; the lambs must be fed.',
      'The widows of both our realms ask for peace, {to}. We shall not refuse them.',
    ],
  },
  alliance: {
    any: [
      'Our swords are thine, {to}. Let none who rise against thee find rest.',
      'Hand and hearth, {to}: where thou standest, we stand.',
      'May our banners fly side by side, {to}, till the last sea runs dry.',
      'We pledge thee our spears, {to}, and ask only thine in return.',
    ],
  },
  compliment: {
    any: [
      'Thy harvests are the envy of the realm, {to}. May the rains favour thee.',
      'We hear thy ships are the finest afloat, {to}. A fair sight upon the horizon.',
      'Thy envoy was a gracious guest, {to}. Our table is ever open to thee.',
      'Long live thee, {to}, and long may thy borders hold.',
      'The bards sing of thy courage, {to}, though they sing flat.',
    ],
    pacifist: [
      'May thy winters be mild and thy children many, {to}.',
      'We have sent thee a cask of our best ale, {to}. Drink to a quiet year.',
    ],
  },
  plea: {
    any: [
      'The wolves are at our gates, {to}. We beg thee: send aid ere we fall.',
      '{foe} presses us hard, {to}. Stand with us, and our debt shall be long remembered.',
      'Our walls crumble, good {to}. A single company would turn the tide.',
      'We are outnumbered, {to}. Remember that thy turn may come next.',
    ],
  },
  threat: {
    imperialist: [
      'Thy lands lie fair and poorly guarded, {to}. It would be a pity if something befell them.',
      'Pay tribute, {to}, or be counted among my subjects ere the harvest.',
      'I have measured thy country for a new banner, {to}. It is mine.',
      'Thy coast is long, {to}, and my fleet is patient.',
    ],
  },
  boast: {
    any: [
      'A new banner flies upon a far shore, {to}. Thy sea is smaller than thou thoughtest.',
      'Behold, {to}: {place} is ours. The world grows narrower for thee.',
      'We have planted our flag at {place}, {to}. Do come and look, if thou darest.',
    ],
  },
  betrayal: {
    any: [
      'Thy word was a candle in a gale, {to}. Traitor!',
      'We trusted thy oath, {to}. May it choke thee.',
      'Cursed be the day we clasped thy hand, {to}. Thou hast broken faith.',
    ],
  },
  thanks: {
    any: [
      'Thy aid came in the hour of need, {to}. We shall not forget it.',
      'Many thanks for thy spears, {to}. The harvest feast shall be in thy honour.',
    ],
  },
}

/** Cooldowns (game seconds) per kind between the same two kingdoms, and the shortest gap between any two letters. */
const COOL: Record<LetterKind, number> = { declare: 30, taunt: 90, insult: 150, peace: 60, alliance: 60, compliment: 240, plea: 200, threat: 300, boast: 240, betrayal: 60, thanks: 300 }
const URGENT = new Set<LetterKind>(['declare', 'peace', 'alliance', 'betrayal'])
const GAP = 7, URGENT_GAP = 2.5, KEEP = 40

const hash = (...n: number[]) => { let h = 2166136261; for (const v of n) { h ^= Math.floor(v * 1000) & 0xffffffff; h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967296 }
const toneOf = (g: Game, k: number): Tone => g.kingdoms[k].temperament as Tone

export function writeLetter(g: Game, from: number, to: number, kind: LetterKind, ctx: { place?: string; foe?: number } = {}) {
  if (from === to || g.kingdoms[from].isPlayer || g.kingdoms[to].isPlayer || !g.kingdoms[from].alive) return // (AI to AI only: the player reads their mail over the shoulder)
  const key = `${from}>${to}:${kind}`
  if (g.time < (g.letterCool.get(key) ?? 0)) return
  if (g.time - g.letterAt < (URGENT.has(kind) ? URGENT_GAP : GAP)) return
  const pools = BANK[kind], tone = toneOf(g, from)
  const list = [...(pools[tone] ?? []), ...(pools.any ?? [])]
  if (!list.length) return
  const raw = list[Math.floor(hash(g.time, from, to, g.letters.length) * list.length)]
  const text = raw.replace('{to}', g.kingdoms[to].name).replace('{from}', g.kingdoms[from].name).replace('{foe}', ctx.foe !== undefined ? g.kingdoms[ctx.foe].name : 'the enemy').replace('{place}', ctx.place ?? 'that town')
  g.letters.push({ id: g.letterId++, t: g.time, from, to, kind, text })
  if (g.letters.length > KEEP) g.letters.splice(0, g.letters.length - KEEP)
  g.letterCool.set(key, g.time + COOL[kind]); g.letterAt = g.time
}

/** A relation changed (see Diplomacy.changes). */
export function onRelationChange(g: Game, c: { a: number; b: number; prev: string; next: string; text?: string }) {
  const hostile = (r: string) => r === 'conflict' || r === 'war' || r === 'total'
  if (hostile(c.next) && !hostile(c.prev)) { if (c.next !== 'conflict') writeLetter(g, c.a, c.b, 'declare') }
  else if (c.next === 'neutral' && hostile(c.prev)) writeLetter(g, c.a, c.b, 'peace')
  else if (c.next === 'allied') { writeLetter(g, c.a, c.b, 'alliance'); writeLetter(g, c.b, c.a, 'thanks') }
  else if (c.prev === 'allied' && c.next === 'neutral' && /betray/i.test(c.text ?? '')) writeLetter(g, c.b, c.a, 'betrayal')
}

/** A town changed hands: the winner gloats to the loser. */
export function onCapture(g: Game, winner: number, loser: number, placeName: string, settlement: boolean) {
  writeLetter(g, winner, loser, 'taunt', { place: placeName })
  void settlement
}
export function onColony(g: Game, k: number, place: string) {
  const rivals = g.kingdoms.filter(o => o.id !== k && o.alive && !o.isPlayer && g.diplomacy.get(k, o.id) !== 'allied')
  if (rivals.length) writeLetter(g, k, rivals[Math.floor(hash(g.time, k) * rivals.length)].id, 'boast', { place })
}

/** Every few seconds, one kingdom may write to another: an insult across the front, praise to a friend, a plea, a threat. */
export function lettersTick(g: Game) {
  if (g.tickCount % 175 !== 0) return
  const ai = g.kingdoms.filter(k => k.alive && !k.isPlayer && g.ownedTowns(k.id) > 0)
  if (ai.length < 2) return
  const pick = <T,>(xs: T[], salt: number) => xs[Math.floor(hash(g.time, salt) * xs.length)]
  const roll = hash(g.time, 7), towns = (k: number) => g.ownedTowns(k)
  const pairs: { a: number; b: number }[] = []
  for (const A of ai) for (const B of ai) if (A.id !== B.id) pairs.push({ a: A.id, b: B.id })
  const sel = (f: (a: number, b: number) => boolean, salt: number) => { const c = pairs.filter(p => f(p.a, p.b)); return c.length ? pick(c, salt) : null }
  if (roll < 0.3) { // an insult between enemies (imperialists are the rudest)
    const p = sel((a, b) => (g.diplomacy.get(a, b) === 'war' || g.diplomacy.get(a, b) === 'total') && g.kingdoms[a].temperament !== 'pacifist', 11); if (p) writeLetter(g, p.a, p.b, 'insult')
  } else if (roll < 0.55) { // praise for a friend, or a civil word for a neighbour at peace
    const p = sel((a, b) => (g.diplomacy.get(a, b) === 'allied' || g.diplomacy.get(a, b) === 'neutral') && g.kingdoms[a].temperament !== 'imperialist' || g.diplomacy.get(a, b) === 'allied', 13); if (p) writeLetter(g, p.a, p.b, 'compliment')
  } else if (roll < 0.8) { // the weaker party in a war asks the others for help
    const p = sel((a, b) => { const foe = ai.find(f => f.id !== a && f.id !== b && (g.diplomacy.get(a, f.id) === 'war' || g.diplomacy.get(a, f.id) === 'total') && towns(f.id) > towns(a) * 1.3); return !!foe && g.diplomacy.get(a, b) !== 'war' && g.diplomacy.get(a, b) !== 'total' && g.diplomacy.get(b, a) !== 'conflict' && (g.diplomacy.get(a, b) === 'allied' || hash(g.time, a, b) < 0.25) }, 17)
    if (p) { const foe = ai.find(f => f.id !== p.a && f.id !== p.b && (g.diplomacy.get(p.a, f.id) === 'war' || g.diplomacy.get(p.a, f.id) === 'total') && towns(f.id) > towns(p.a) * 1.3); writeLetter(g, p.a, p.b, 'plea', { foe: foe?.id }) }
  } else { // an imperialist eyes a smaller neighbour
    const p = sel((a, b) => g.kingdoms[a].temperament === 'imperialist' && g.diplomacy.get(a, b) === 'neutral' && towns(b) < towns(a) && towns(b) > 0, 19); if (p) writeLetter(g, p.a, p.b, 'threat')
  }
}
