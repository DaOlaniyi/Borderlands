export const UNIT_NAMES: string[] = [
  'Aldric', 'Bertram', 'Cedric', 'Dunstan', 'Edmund', 'Faramond', 'Godric', 'Hadrian', 'Ivo', 'Jorvik',
  'Kendrick', 'Leofric', 'Merek', 'Norbert', 'Osric', 'Percival', 'Quentin', 'Roderick', 'Sigmund', 'Theobald',
  'Ulric', 'Vance', 'Wulfstan', 'Xavier', 'Yorick', 'Zephyr', 'Alaric', 'Baldwin', 'Cuthbert', 'Dagobert',
  'Eadric', 'Florian', 'Gareth', 'Hugh', 'Isembard', 'Jasper', 'Kelwin', 'Lambert', 'Mortimer', 'Nigel',
  'Oswin', 'Piers', 'Radulf', 'Stephen', 'Tristan', 'Uther', 'Valdemar', 'Warin', 'Aelfric', 'Beowulf',
  'Conrad', 'Drogo', 'Eustace', 'Fulk', 'Gawain', 'Harold', 'Ingram', 'Jocelyn', 'Kay', 'Lancelin',
  'Maynard', 'Nicolas', 'Odo', 'Peregrine', 'Ranulf', 'Sewell', 'Tancred', 'Urien', 'Viggo', 'Wystan',
  'Adela', 'Brienne', 'Cecily', 'Dagny', 'Elowen', 'Freya', 'Gwendolyn', 'Hild', 'Isolde', 'Joan',
  'Katelyn', 'Lioness', 'Maud', 'Nesta', 'Oriel', 'Petronella', 'Rowena', 'Sigrid', 'Thora', 'Ursula',
  'Vivienne', 'Wynne', 'Ysolde', 'Alienor', 'Brunhild', 'Clemence', 'Edith', 'Ottilie', 'Rhiannon', 'Sunniva',
]

export const KINGDOM_NAMES: string[] = [
  'Aldermere', 'Brackenholt', 'Caerwyn', 'Dunmarrow', 'Eldenmoor', 'Fenwick', 'Greywater', 'Highcairn', 'Ironvale', 'Jarrowdale',
  'Kingsreach', 'Lothmere', 'Marrowgate', 'Northwatch', 'Oakenhelm', 'Pinefell', 'Ravensmoor', 'Stormhaven', 'Thornwall', 'Umberfield',
  'Valmere', 'Westmarch', 'Yarrowby', 'Ashcombe', 'Blackthorn', 'Crowhurst', 'Draymoor', 'Ebonridge', 'Frostholm', 'Goldmeade',
]

/** Draw a name for a new unit, avoiding names already used when possible. */
export function pickUnitName(rand: () => number, used: Set<string>): string {
  const free = UNIT_NAMES.filter(n => !used.has(n))
  const pool = free.length ? free : UNIT_NAMES
  return pool[Math.floor(rand() * pool.length)]
}

export function kingdomTier(towns: number): { title: string; level: number } {
  if (towns <= 0) return { title: 'Exiles', level: 0 }
  if (towns <= 3) return { title: 'Clan', level: 1 }
  if (towns <= 5) return { title: 'Village', level: 2 }
  if (towns <= 10) return { title: 'Tribe', level: 3 }
  if (towns <= 20) return { title: 'Kingdom', level: 4 }
  return { title: 'Empire', level: 5 }
}
