// cc-tamagotchi's type contract: the values it keeps in $.state, and the shapes they are made of.

export type SpeciesId =
  | 'egg'
  | 'bit'
  | 'nibble'
  | 'bytey'
  | 'glitchy'
  | 'assertoise'
  | 'refactopus'
  | 'shellby'
  | 'grepossum'
  | 'commitmunk'
  | 'owlgorithm'
  | 'spaghetto'
  | 'unicorn'

export type Stage = 'egg' | 'baby' | 'child' | 'teen' | 'adult'

/** What Claude's work and the person's care added up to over the pet's life. */
export type PetStats = {
  toolCalls: number
  edits: number
  tests: number
  testFails: number
  commits: number
  pushes: number
  shell: number
  searches: number
  agents: number
  errors: number
  turns: number
  nightTurns: number
  tokens: number
  meals: number
  snacks: number
  games: number
  wins: number
  cleans: number
  meds: number
  pats: number
  scolds: number
}

/** The pet, as kept in $.store and shared by every session on the machine. */
export type Pet = {
  v: 1
  /** Seeds every random choice its life makes, so all sessions simulate the same pet. */
  id: string
  name: string
  species: SpeciesId
  generation: number
  /** When the egg appeared, when it hatched, and when its current form began (ms since the epoch). */
  born: number
  hatchedAt: number | null
  evolvedAt: number
  /** How far its life has been simulated, a whole minute at a time. */
  at: number
  /** 0 to 100: four hearts of 25. */
  hunger: number
  happy: number
  discipline: number
  /** Grams. */
  weight: number
  /** Bugs on the screen: what this pet leaves behind. At most four. */
  bugs: number
  /** Doses of medicine still needed; 0 is healthy. */
  sick: number
  asleep: boolean
  /** Put to bed by the person: Claude's work does not wake it. */
  tucked: boolean
  /** The last time Claude or the person did anything. After a while without, it naps. */
  lastActive: number
  lastMeal: number | null
  lastPat: number
  tantrum: boolean
  /** The need it is calling about, the awake minutes it has waited, and whether that was counted. */
  calling: Need | null
  callWait: number
  callingCounted: boolean
  /** Care mistakes: a call left unanswered for too long. They shape what it grows into. */
  mistakes: number
  /** Minutes of hard neglect (starving and miserable, or sick); in classic mode too many and it leaves. */
  neglect: number
  /** When a vacation began: its time stands still until the person ends it. */
  vacation: number | null
  gone: { at: number; cause: 'neglect' } | null
  rev: number
  stats: PetStats
}

export type Need = 'hungry' | 'sad' | 'sick' | 'bugs' | 'tantrum'

/** One line of the hall of fame: a pet that has gone. */
export type Memorial = {
  name: string
  species: SpeciesId
  generation: number
  born: number
  gone: number
  toolCalls: number
  commits: number
}

export type BandMode = 'auto' | 'big' | 'on' | 'line' | 'off'
export type ShellColor = 'coral' | 'mint' | 'grape' | 'sky' | 'banana' | 'ink'

export type Settings = {
  band: BandMode
  /** Show the pet's face beside the spinner while Claude works. */
  spinner: boolean
  sound: boolean
  /** classic: a badly neglected pet leaves. gentle: it never does. */
  mode: 'classic' | 'gentle'
  shell: ShellColor
}

export type ReactionKind =
  | 'eat'
  | 'snack'
  | 'refuse'
  | 'happy'
  | 'pat'
  | 'clean'
  | 'medicine'
  | 'scold'
  | 'cheer'
  | 'flinch'
  | 'party'
  | 'nibble'
  | 'hatch'
  | 'evolve'
  | 'sleep'
  | 'wake'
  | 'win'
  | 'lose'

/** An animation the screens play once. `id` grows with each, so a screen knows a new one began. */
export type Reaction = { kind: ReactionKind; id: number; at: number; from?: SpeciesId }

export type View = 'main' | 'stats' | 'help' | 'history' | 'game' | 'name'

/** The left-or-right game: five rounds, three wins make it happy. */
export type Game = {
  round: number
  wins: number
  /** Which way it looked last round, and which way the person guessed. */
  answer: 'left' | 'right' | null
  guess: 'left' | 'right' | null
  isOver: boolean
}

export type Speech = { text: string; at: number }

// inside the augmentation a name resolves in claude-code first (it has a Settings of its own),
// so the contract names its values through aliases no module there shares
export type TamagotchiPet = Pet
export type TamagotchiSettings = Settings
export type TamagotchiView = View
export type TamagotchiGame = Game
export type TamagotchiReaction = Reaction
export type TamagotchiSpeech = Speech
export type TamagotchiMemorial = Memorial

declare module 'claude-code' {
  interface PluginState {
    'cc-tamagotchi': {
      pet: TamagotchiPet | null
      settings: TamagotchiSettings
      view: TamagotchiView
      game: TamagotchiGame | null
      reaction: TamagotchiReaction | null
      speech: TamagotchiSpeech | null
      working: boolean
      graveyard: TamagotchiMemorial[]
    }
  }
}
