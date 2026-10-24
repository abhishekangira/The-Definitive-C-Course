// Rio's pixel art: one character per pixel. Edit the rows by hand.
//
// Grid. A sprite is `{ x, y, rows }`. `x, y` is the top-left of `rows` on the 96 x 96 grid. WarriorArt.tsx turns one
// frame into SVG paths and computes the aura, the dark-page rim, the shadow and the Great Ape's night sky.
//
// Characters.
//   `.`   empty. On a base sprite the pixel is transparent. On a patch it leaves the pixel underneath unchanged.
//   ` `   erase (a space, `ERASE`). A patch paints that pixel transparent, so a later frame can remove ink.
//   any other character is a colour in PALETTE. Colours are fixed hex values.
//
// Frames. A frame is a full sprite, an optional `shift`, then optional patches (a later patch wins, and a space erases).
// `shift` moves pixels on rows [top, bottom) by dx, dy before the patches. `fill` repaints the vacated row where the
// body continued (deleting it cracks the neck). Tips come from tools/rio/derive-frames.mjs and stay hand-editable.
//   idle      four frames. 1 and 2 shift the head and upper torso up 1px with `fill`; 2 also stretches a tip; 3 is the tip.
//             Under `.still`, the header head draws the first frame of the streak mood's list (`worried[0]` when at risk); the gallery always draws `idle[0]`.
//   defeated  kidDown, a 1px head droop (`dy` 1), then that droop with a hair tip poked sideways.
//   worried   three frames. 0 is the sprite plus its worried patch. 1 and 2 shift the hair or fur rows by 1px in x.
//   blink     the resting eyes. `blinkForIdle` moves it by that frame's `shift.dy` (`IDLE_BLINK_DY`). Absent for the ape.
// The aura is not in these rows: WarriorArt computes it (`aura="none" | "flicker" | "blaze"`).
import type { FormId } from '../progress/warrior';

export interface PixelSprite { x: number; y: number; rows: readonly string[] }

/** A patch character that paints the pixel transparent. `.` leaves the pixel underneath unchanged. */
export const ERASE = ' ';

/** Rows [top, bottom) move by `dx` and `dy`. `fill` restores the vacated row where the body continued below. */
export interface BandShift { top: number; bottom: number; dx?: number; dy?: number; fill?: boolean }

/** A sprite, an optional band shift, then patches. A space in a patch erases. */
export interface SpriteFrame { sprite: PixelSprite; shift?: BandShift; patches?: readonly PixelSprite[] }

export const PALETTE: Readonly<Record<string, string>> = {
  '6': '#8fd4ff',
  '7': '#2f7fb8',
  '8': '#fff1dc',
  '9': '#c9a07a',
  'A': '#fff58a',
  'B': '#b06400',
  'C': '#e8c8b4',
  'D': '#a35a37',
  'E': '#8c6a5c',
  'F': '#f05870',
  'G': '#ffd0b0',
  'H': '#585a70',
  'J': '#80607a',
  'K': '#0e0c12',
  'L': '#241420',
  'M': '#10164a',
  'N': '#5068dc',
  'O': '#ffc04a',
  'P': '#ff7a80',
  'Q': '#9c3a00',
  'S': '#ffe0bd',
  'T': '#0a7a62',
  'U': '#c88400',
  'V': '#560a1c',
  'X': '#6a3c18',
  'Z': '#ff3030',
  'a': '#ffd61f',
  'b': '#f0a000',
  'c': '#c9a08c',
  'd': '#dc9466',
  'e': '#141018',
  'f': '#cf2840',
  'g': '#1f1f28',
  'h': '#33343f',
  'i': '#ffffff',
  'j': '#5c3f52',
  'k': '#1c1418',
  'l': '#3c2636',
  'm': '#1b2672',
  'n': '#2b40aa',
  'o': '#ff9418',
  'p': '#6e1c22',
  'q': '#df6402',
  'r': '#d8282c',
  's': '#f8c495',
  't': '#1ccfa6',
  'u': '#ffd21a',
  'v': '#931530',
  'w': '#ffffff',
  'x': '#a0652f',
  'y': '#e8c040',
  'z': '#c8102e',
};

export const SPRITES = {
  kid: { x: 24, y: 27, rows: [
    '.....................kk........k...............',
    '....................kggk......kgk..............',
    '...........k........kgHk....kkggk..............',
    '..........kgkk.....kHhHgk..kHHgHk.....k........',
    '...........kgHkk...kHhHgk.kHhggk...kkkgk.......',
    '...........kHhHgkk.kHhhHgkHhhgHkkkkHggk........',
    '............kHhHggkHhhhHhHhhhgHkHHHggk.........',
    '.............kHhHhHhhhhHhhhhhHhHhhggk..........',
    '.......kkkk..kHhhHhhhhhhhhhhhHhhhggk...........',
    '......kHHggkkkkHhhHhhhhhhhhhhhhhggk............',
    '.......kHHhHHHHhhhhhhhhhhhhhhhhhhggkkk.........',
    '........kHHHHHhhhhhhhhhhhhhhhhhhhhhHggkkk......',
    '.........kkHhhHHhhhhhhhhhhhhhhhhhgggghHggk.....',
    '...........kHhhhhhhhhKhhhhKhhhhhhhhhhgggk......',
    '............kHhhhhhKKdKhgKdKhKhhhggkkkkk.......',
    '..........kkkHhhhgKdKddKKSddKdKhggk............',
    '........kkHHHHHhhgKSSddKKSddKdKhhggk...........',
    '.......kHHHHhhhhhgKSsssSSsssddKhggggk..........',
    '........kkkHhhhhggeeeSsssddeeegkkHgggk.........',
    '...........kkkkkKKSSSssssssSddKk.kkkkgk........',
    '...............kdKeeeeSsddeeeeddk....k.........',
    '...............kddieieSsddeieiddk..............',
    '...............kdddeeSsssddeedddk..............',
    '...............kddSSSssssssSddddk..............',
    '................kkdsssdddSssddkk...............',
    '..................kSssssSssddk.....kk..........',
    '..................kdddDppDSddk....kddk.........',
    '...................kdddPPSddk....kSsddk........',
    '....................kSsSSddk....kSsdsddk.......',
    '....................kddddddk....kSsssddk.......',
    '................kkkkMDddddDMkkkk.kSsddk........',
    '..............kkmMOqqDDDDDDOqqMmkkkSddkk.......',
    '.............kNNNMOOOqMNmMOOOqMNNmNNNNmmk......',
    '.......kk...kNnmMOOoqqMnmMOooOqMmmNnnnmmk......',
    '.....kkXXk..kNnmMOoooqqMMOoooqqMmmNnnnmmk......',
    '...kkxxxXXkkSDDDMOoooqqMMOoooqqMDDSSSddk.......',
    '..kxxxxxXXkkSsdDMOoooooOOooooqqMDssssddk.......',
    '.kxxxxxXXkkSssdDMOoooooooooooqqMDsssssddk......',
    '.kxxxXXkkkSsssdDOoooooooooooooqqDsssssddk......',
    '.kxXXXk.kSsssddkOqooooooooooooqqkkSsssddk......',
    '.kxXXk..kSssddkkOqooooooooooooqqk.kSssddk......',
    'kxxXXk.kSssddk.kOqooooooooooooqqk..kkddk.......',
    'kxXXXk..kSssddkkOqooooooooooooqqk....kk........',
    'kxxXXk...kSsddkkMMMMMMMMMMMMMMMMk..............',
    'kxxxXXk..kdNNNmmNnmNmmNNNNNNNnmmk..............',
    '.kxxxXXk..kNnnmmNmmNnmmNnnnnnnmmk..............',
    '..kxxxXXk.kNmmSdDmMNnmmNMMMMMMMMk..............',
    '...kxxxXXkkkkSssdDqMnMmMOOOOOOOqqk.............',
    '....kxxxxxxXXDssdDqMMqMMOoooooooqqk............',
    '.....kxxxxxXXQDDDqqMMqMMOooooooOoqqk...........',
    '......kxxxXXQoOOqqMmMqMMOoooooooOoqqk..........',
    '.....kXkxXXQooqOqqMmMqMMOoooooooOqoqqk.........',
    '......k.kkQooqOoqqMmMqMmkOqoooqooOqoqqk........',
    '.........kOooOooqqMmmkmmkkkqooqoooOoqqk........',
    '........kOooqOooqqqMmkkk..kqoooqooOqoqqk.......',
    '.......kOoooOoooqoqqk......kqooqoooOooqqk......',
    '.......kOooqooooqoqqk......kqooqooooqoqqk......',
    '......kOoooqooooqqkk........kkOqooooqooqqk.....',
    '.....kOoooqooooqqqk..........kOoqooooqooqqk....',
    '.....kOooooooooqqk............kOqoooooooqqk....',
    '.....kOooooooooqqk............kOqoooooooqqk....',
    '....kmQqqqqqqqqqqk............kqqqqqqqqqqQmk...',
    '...kkmQQQQQQQQQQQk............kQQQQQQQQQQQmkk..',
    '..kNNnNNNNNNNNNmmk............kmmNNNNNNNNNnmmk.',
    '.kwwwwwNnnnnnnnmmk............kmmnnnnnnmmwwwwwk',
    '.kwwwwwNnnnnnnnmmmk..........kNmmnnnnnnmmwwwwwk',
    '.krrrrrrrrrrrrrrrrrk........krrrrrrrrrrrrrrrrrk',
    '..kkkkkkkkkkkkkkkkk..........kkkkkkkkkkkkkkkkk.',
  ] },
  kidDown: { x: 24, y: 27, rows: [
    '.....................kk........k...............',
    '....................kggk......kgk..............',
    '...........k........kgHk....kkggk..............',
    '..........kgkk.....kHhHgk..kHHgHk.....k........',
    '...........kgHkk...kHhHgk.kHhggk...kkkgk.......',
    '...........kHhHgkk.kHhhHgkHhhgHkkkkHggk........',
    '............kHhHggkHhhhHhHhhhgHkHHHggk.........',
    '.............kHhHhHhhhhHhhhhhHhHhhggk..........',
    '.......kkkk..kHhhHhhhhhhhhhhhHhhhggk...........',
    '......kHHggkkkkHhhHhhhhhhhhhhhhhggk............',
    '.......kHHhHHHHhhhhhhhhhhhhhhhhhhggkkk.........',
    '........kHHHHHhhhhhhhhhhhhhhhhhhhhhHggkkk......',
    '.........kkHhhHHhhhhhhhhhhhhhhhhhgggghHggk.....',
    '...........kHhhhhhhhhKhhhhKhhhhhhhhhhgggk......',
    '............kHhhhhhKKdKhgKdKhKhhhggkkkkk.......',
    '..........kkkHhhhgKdKddKKSddKdKhggk............',
    '........kkHHHHHhhgKSSddKKSddKdKhhggk...........',
    '.......kHHHHhhhhhgKSsssSSsssddKhggggk..........',
    '........kkkHhhhhgKSddeeddeeSddKkkHgggk.........',
    '...........kkkkkKKdeeSSssddeedKk.kkkkgk........',
    '...............kdKSSSssssssSddddk....k.........',
    '...............kddeeeeSsddeeeeddk..............',
    '...............kdddeeSsssddeedddk..............',
    '...............kddd6Sssssdd889ddk..............',
    '................kkd6Ssddddd898kk...............',
    '..................k7SsssSdd889k................',
    '..................kdsddDDDSddk.................',
    '...................kddDSddDdk..................',
    '....................kSSssddk...................',
    '....................kddddddk...................',
    '................kkkkMDddddDMkkkk...............',
    '..............kkmMOqqDDDDDDOqqMmkk.............',
    '.............kNNNMOOOqMNmMOOOqMNNmk............',
    '.......kk...kNnmMOOoqqMnmMOooOqMnmmk...........',
    '.....kkXXk..kNnmMOoooqqMMOoooqqMnmmk...........',
    '...kkxxxXXkkSDDDMOoooqqMMOoooqqMDDDdk..........',
    '..kxxxxxXXkkSsdDMOoooooOOooooqqMDsddk..........',
    '.kxxxxxXXk.kSsdDMOoooooooooooqqMDsddk..........',
    '.kxxxXXkk..kSsdDOoooooooooooooqqDsddk..........',
    '.kxXXXk....kSsdDOqooooooooooooqqDsddk..........',
    '.kxXXk....kSssdDOqooooooooooooqqDssddk.........',
    'kxxXXk....kSsddkOqooooooooooooqqkSsddk.........',
    'kxXXXk....kSsddkOqooooooooooooqqkSsddk.........',
    'kxxXXk....kSsddkMMMMMMMMMMMMMMMMkSsddk.........',
    'kxxxXXk...kNNNmmNnmNmmNNNNNNNnmmNNNmmk.........',
    '.kxxxXXk..kNnnmmNmmNnmmNnnnnnnmmNnnmmk.........',
    '..kxxxXXk.kmddmMMMMNnmmNMMMMMMMMMmddmk.........',
    '...kxxxXXkkSsdDOOqqMnMmMOOOOOOOqqDsddk.........',
    '....kxxxxXXDsdDOoqqMMqMMOooooooqqDsddk.........',
    '.....kxxxXXDsdDOOqqMMqMMOooooooOqDsddk.........',
    '......kxxxXXDDOOqqMmMqMMOoooooooOqDDk..........',
    '.....kXkxXXQOOqOqqMmMqMMOoooooooOqOqqk.........',
    '......k.kkQooqOoqqMmMqMmkOqoooqooOqoqqk........',
    '.........kOooOooqqMmmkmmkkkqooqoooOoqqk........',
    '........kOooqOooqqqMmkkk..kqoooqooOqoqqk.......',
    '.......kOoooOoooqoqqk......kqooqoooOooqqk......',
    '.......kOooqooooqoqqk......kqooqooooqoqqk......',
    '......kOoooqooooqqkk........kkOqooooqooqqk.....',
    '.....kOoooqooooqqqk..........kOoqooooqooqqk....',
    '.....kOooooooooqqk............kOqoooooooqqk....',
    '.....kOooooooooqqk............kOqoooooooqqk....',
    '....kmQqqqqqqqqqqk............kqqqqqqqqqqQmk...',
    '...kkmQQQQQQQQQQQk............kQQQQQQQQQQQmkk..',
    '..kNNnNNNNNNNNNmmk............kmmNNNNNNNNNnmmk.',
    '.kwwwwwNnnnnnnnmmk............kmmnnnnnnmmwwwwwk',
    '.kwwwwwNnnnnnnnmmmk..........kNmmnnnnnnmmwwwwwk',
    '.krrrrrrrrrrrrrrrrrk........krrrrrrrrrrrrrrrrrk',
    '..kkkkkkkkkkkkkkkkk..........kkkkkkkkkkkkkkkkk.',
  ] },
  warrior: { x: 25, y: 0, rows: [
    '....................k........kgk..............',
    '...................kgk.....kkggk..............',
    '..........k.......kHHgk...kHHHgk..............',
    '.........kgkk.....kHHgk.kkHhgHk...............',
    '..........kgHkk...kHhHgkHHhhHgk...kkkk........',
    '..........kHhHgkkkHhhHhHhhhhHgkkkkHHggk.......',
    '...........kHhHggkHhhhHhhhhHhhHHHHhggk........',
    '............kHhHhHhhhhHhhhhHhhhhhhgHk.........',
    '............kHhhHhhhhhhhhhhhhhhhhgHk..........',
    '......kkkkkkkkHhhHhhhhghhhhhhhhhHHk...........',
    '.....kHHHHHHHHhhhhhhgghhhhhhhhhHhggkkkkk......',
    '......kHhhHHHhhhhhgghhhhhhhhhhhgghhHHHggk.....',
    '.......kkHhhhHHhhghhhKhhhhKhhhhhhgggghhggk....',
    '.........kkHhhhhhhKgKdKhgKdKhhhhhhhhggkkk.....',
    '...........kHhhhgKdKSddKKddKhhhhhggkkk........',
    '.........kkkHhhhgKeSsddKKddeeHhhggkk..........',
    '.......kkHHHHHhgKddeeeddeeeddKgghhggk.........',
    '......kHHHHhhhhgKSsSSSssSSSddKhKgggggkk.......',
    '.......kkkHhhhKggeeeeSsddeeeegKdkkkHgggk......',
    '..........kkkkdKgieeSsssddeeiKddk..kkkk.......',
    '.............kddKdeSsssssddedKddk.............',
    '.............kddSdSssssssssSddddk.............',
    '..............kdkdsssdddSssddkdk..............',
    '...............kkSdsdddDSssddkk...............',
    '.................kdsssSSssddk.................',
    '.................kddddDDdSddk.................',
    '..................kdsSSSSddk..................',
    '..................kDdsssddDk..................',
    '..................kDddddddDk..................',
    '...............kkkkDdsSSsdDkkkk...............',
    '.......kkkkkkkkOOqqDdssssdDOOqqkkkkkkkk.......',
    '......kNNNNmMOOooqqDDDDDDDDOoooqqMNNNmmk......',
    '.....kNnNNmMOoooooqqMNNNmMOoooooqqMnNNmmk.....',
    '....kNnNnmMOoOOoooqqMnnnmMOooooOOqqMnnNmmk....',
    '...kNnNNNmMOoOoOOooqqMnmMOoooOOoOqqMnNNNmmk...',
    '...kNnnnnmMOooOOoooqqMnmMOooooOOoqqMnnnnmmk...',
    '..kNnnnnnmMOoooooooqqMnmMOoooooooqqMnnnnnmmk..',
    '..kNnnnnmMOoooooooooqqMMOoooooooooqqMnnnnmmk..',
    '..kNnnnnmMOooqooooooqqMMOoooooooqoqqMnnnnmmk..',
    '.kNmnnnnmMOoooqoooooooOOoooooooqooqqMnnnnnmmk.',
    '.kNmnnnnmMOoooqooooooooooooooooqooqqMnnnnnmmk.',
    '.kNmnnnnmMqqoooqooooooooooooooqoooqqMnnnnnmmk.',
    '.kNmnnnnmMqqooooqooooooooooooqooooqqMnnnnnmmk.',
    '..kmmmmmmMqqooooqooooooooooooqooooqqMmmmmmmk..',
    '..kSSSSddkqqoooooqooooooooooqoooooqqkSSSSddk..',
    '.kSdssSsdDqqMMMMMMMMMMMMMMMMMMMMMMqqDssSssddk.',
    '.kSdssSsdDqqMnnNNNNNNNNNNNNNNNNnmMqqDssSssddk.',
    '.kSdsssSddkkNnmmNNmmNnnnnnnnnnnnmmkkSsSsssddk.',
    '.kSdsssSddkNnmmNnNnmmNnnnnnnnnnnnmmkSsSsssddk.',
    '.kSdsssSddkNnmmNnnnmmNnnnnnnnnnnnmmkSsSsssddk.',
    '..kdsssddkkMMMMMNnnnmmMMMMMMMMMMMMMkkSsssddk..',
    '..kdsssddkkOOOqqMnnnmMOOqqqqOOOOOqqkkSsssddk..',
    '..kSsddddkOoooqqMnmnmMOoqqqqooooooqqkSdddddk..',
    '.kSssssddkOoooqqMnmnmMOoqqqoooooooqqkSssssddk.',
    '.kSssSsdDOooooqqMnmMnmMOqqqooooooooqqDssSsddk.',
    'kSdssSsdDOoooqqMnmMqMmMOqqqooooooooqqDssSssddk',
    'kSdsssSdDOooqqqMnmMqMmMOqqoooooooqoqqDsSsssddk',
    'kSdsssSdDOoOoqqMnmMqMmMOqoooooooooOqqDsSsssddk',
    'kSdssssdDOOqoqqMnmMqMmMOooooooooooqOqDsssssddk',
    'kSdssssdDOOooqqMnmMqMMOooooooqoooooOqDsssssddk',
    'kNNNNNNNmMqooqqMMmMOOOoooooooqOoooqqMNNNNNNmmk',
    'kNnnnnnnmMOooooOqMMOooooooooooOoooqqMnnnnnnmmk',
    'kNnnnnnnmMOoooOqoOOooqqqqoooooqOooqqMnnnnnnmmk',
    'kmmmmmmmmMOoooOqoooooqqqqoooooqOooqqMmmmmmmmmk',
    'kSSSSSSdDOooooOqoooqoqqqqoqoooqOoooqqDSSSSSddk',
    'kSddddddDOoooOqoooOqoqqqqoqOoooqOooqqDdddddddk',
    'kSsssssdDOoooOqoooOqoqqqqoqOoooqOooqqDsssssddk',
    'kSsssssdDOoooOqoooOqqqkkOoqOoooqOooqqDsssssddk',
    '.kdDDDDDOooooOqoooOqqqkkOoqOoooqOoooqqDDDDDdk.',
    '..kOOOOOooooOqooooOqqk..kOqOooooqOooooOOOqqk..',
    '..kOqqooooooOqooooOqqk..kOqOooooqOooooooqqqk..',
    '..kOqqooooqoooooooOqqk..kOqOoooooooqooooqqqk..',
    '..kOqqoooOqoooooooOqqk..kOqOoooooooqOoooqqqk..',
    '..kOqqoooOoooooooooqqk..kOooooooooooOoooqqqk..',
    '..kOqqooOqooooooooqqk....kOoooooooooqOooqqqk..',
    '..kOqqooOqoooooqooqqk....kOoooqoooooqOooqqqk..',
    '..kOqqooOqooooOqooqqk....kOoooqOooooqOooqqqk..',
    '...kqqooOoooooOqooqqk....kOoooqOoooooOooqqk...',
    '...kqqoOqoooooOqooqqk....kOoooqOoooooqOoqqk...',
    '...kqqoOqooooooOqqqk......kOoqOooooooqOoqqk...',
    '....kOoooooooooOqqqk......kOoqOooooooooqqk....',
    '....kOoooooooooOqqqk......kOoqOooooooooqqk....',
    '.....kOqqqqqqqqqqqk........kqqqqqqqqqqqqk.....',
    '......kqQQQQQQQQQQk........kQQQQQQQQQQqk......',
    '.......kNNNmmrNNmmk........kmmmmrNNNNmk.......',
    '.......kNNNmmrNnmmk........kmmmmrNnNNmk.......',
    '.......kNNNmmrNnmmk........kmmmmrNnNNmk.......',
    '.......kNNNmmrNnmmk........kmmmmrNnNNmk.......',
    '.....kkmyyyyyyyyyyyk......kyyyyyyyyyyymkk.....',
    '....kNNnNNNNNNNNmmmk......kNmmNNNNNNNNnmmk....',
    '...kNnnnnnnnnnnnmmmk......kNmmnnnnnnnnnnmmk...',
    '..kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk..',
    '..kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk..',
    '..krrrrrrrrrrrrrrrrrk....krrrrrrrrrrrrrrrrrk..',
    '...kkkkkkkkkkkkkkkkk......kkkkkkkkkkkkkkkkk...',
  ] },
  golden: { x: 25, y: 0, rows: [
    '.......kbkk..........kk.......kbk........k....',
    '........kbAk........kbbk....kkbbk......kkbk...',
    '........kAbAkk.....kAaAbk..kAAbbk....kkbbk....',
    '.........kAaAbkk...kAaAbk.kAaabbk...kAbbk.....',
    '.........kAaaAbbk.kAaaAbbkAaabbk..kkAbbk......',
    '..k.......kAaaAbbkAaaaaAaAaaabbkkkAAbbk.......',
    '.kbkkkk....kAaaAaAaaaaaAaaaaabbkAAaabbk.......',
    '..kAAbbkkkkkAaaaAaaaaaaAaaaaaabAaaabbk........',
    '...kkAAAAbbkkAaaaAaaaaaaaaaaabaaaabbk.........',
    '.....kAAAaaAAaaaaaaaaaaaaaaaabaaabbk...kkkkk..',
    '......kkAAAaaaaaaaAAaaaaaaaaaaaabbkkkkkAAAbbk.',
    '........kkAAAaaaAAaaaaaaaaaaaaaabaAAAAAbbkkk..',
    '..........kAaAAAaaBBBaaaBBBBBaaaaaaaabbkk.....',
    '.........kkAaaaabBSddBbBSSSddBaaaabbbkk.......',
    '......kkkAAaaaaabBSddBBSsssddBaabbkkk.........',
    '....kkAAAAAAAAaabBbddBBSsddbBaaabbkk..........',
    '...kAAAAAaaaaaabBddbbABdbbbddBabbbbbkkk.......',
    '....kkkkAaaaaaabBSsddBSsSSSddBBkkkbbbbbkk.....',
    '........kkkkkkBbbeeeeBSddeeeeBddk.kkkkkbbk....',
    '.............kdBbitedBSsddetiBddk......kk.....',
    '.............kddBdTSsSsssddTdBddk.............',
    '.............kddSdSssssssssSddddk.............',
    '..............kdkdsssdddSssddkdk..............',
    '...............kkSdsdddDSssddkk...............',
    '.................kdsssSSssddk.................',
    '.................kddddDDdSddk.................',
    '..................kdsSSSSddk..................',
    '..................kDdsssddDk..................',
    '..................kDddddddDk..................',
    '...............kkkkDdsSSsdDkkkk...............',
    '.......kkkkkkkkOOqqDdssssdDOOqqkkkkkkkk.......',
    '......kNNNNmMOOooqqDDDDDDDDOoooqqMNNNmmk......',
    '.....kNnNNmMOoooooqqMNNNmMOoooooqqMnNNmmk.....',
    '....kNnNnmMOoOOoooqqMnnnmMOooooOOqqMnnNmmk....',
    '...kNnNNNmMOoOoOOooqqMnmMOoooOOoOqqMnNNNmmk...',
    '...kNnnnnmMOooOOoooqqMnmMOooooOOoqqMnnnnmmk...',
    '..kNnnnnnmMOoooooooqqMnmMOoooooooqqMnnnnnmmk..',
    '..kNnnnnmMOoooooooooqqMMOoooooooooqqMnnnnmmk..',
    '..kNnnnnmMOooqooooooqqMMOoooooooqoqqMnnnnmmk..',
    '.kNmnnnnmMOoooqoooooooOOoooooooqooqqMnnnnnmmk.',
    '.kNmnnnnmMOoooqooooooooooooooooqooqqMnnnnnmmk.',
    '.kNmnnnnmMqqoooqooooooooooooooqoooqqMnnnnnmmk.',
    '.kNmnnnnmMqqooooqooooooooooooqooooqqMnnnnnmmk.',
    '..kmmmmmmMqqooooqooooooooooooqooooqqMmmmmmmk..',
    '..kSSSSddkqqoooooqooooooooooqoooooqqkSSSSddk..',
    '.kSdssSsdDqqMMMMMMMMMMMMMMMMMMMMMMqqDssSssddk.',
    '.kSdssSsdDqqMnnNNNNNNNNNNNNNNNNnmMqqDssSssddk.',
    '.kSdsssSddkkNnmmNNmmNnnnnnnnnnnnmmkkSsSsssddk.',
    '.kSdsssSddkNnmmNnNnmmNnnnnnnnnnnnmmkSsSsssddk.',
    '.kSdsssSddkNnmmNnnnmmNnnnnnnnnnnnmmkSsSsssddk.',
    '..kdsssddkkMMMMMNnnnmmMMMMMMMMMMMMMkkSsssddk..',
    '..kdsssddkkOOOqqMnnnmMOOqqqqOOOOOqqkkSsssddk..',
    '..kSsddddkOoooqqMnmnmMOoqqqqooooooqqkSdddddk..',
    '.kSssssddkOoooqqMnmnmMOoqqqoooooooqqkSssssddk.',
    '.kSssSsdDOooooqqMnmMnmMOqqqooooooooqqDssSsddk.',
    'kSdssSsdDOoooqqMnmMqMmMOqqqooooooooqqDssSssddk',
    'kSdsssSdDOooqqqMnmMqMmMOqqoooooooqoqqDsSsssddk',
    'kSdsssSdDOoOoqqMnmMqMmMOqoooooooooOqqDsSsssddk',
    'kSdssssdDOOqoqqMnmMqMmMOooooooooooqOqDsssssddk',
    'kSdssssdDOOooqqMnmMqMMOooooooqoooooOqDsssssddk',
    'kNNNNNNNmMqooqqMMmMOOOoooooooqOoooqqMNNNNNNmmk',
    'kNnnnnnnmMOooooOqMMOooooooooooOoooqqMnnnnnnmmk',
    'kNnnnnnnmMOoooOqoOOooqqqqoooooqOooqqMnnnnnnmmk',
    'kmmmmmmmmMOoooOqoooooqqqqoooooqOooqqMmmmmmmmmk',
    'kSSSSSSdDOooooOqoooqoqqqqoqoooqOoooqqDSSSSSddk',
    'kSddddddDOoooOqoooOqoqqqqoqOoooqOooqqDdddddddk',
    'kSsssssdDOoooOqoooOqoqqqqoqOoooqOooqqDsssssddk',
    'kSsssssdDOoooOqoooOqqqkkOoqOoooqOooqqDsssssddk',
    '.kdDDDDDOooooOqoooOqqqkkOoqOoooqOoooqqDDDDDdk.',
    '..kOOOOOooooOqooooOqqk..kOqOooooqOooooOOOqqk..',
    '..kOqqooooooOqooooOqqk..kOqOooooqOooooooqqqk..',
    '..kOqqooooqoooooooOqqk..kOqOoooooooqooooqqqk..',
    '..kOqqoooOqoooooooOqqk..kOqOoooooooqOoooqqqk..',
    '..kOqqoooOoooooooooqqk..kOooooooooooOoooqqqk..',
    '..kOqqooOqooooooooqqk....kOoooooooooqOooqqqk..',
    '..kOqqooOqoooooqooqqk....kOoooqoooooqOooqqqk..',
    '..kOqqooOqooooOqooqqk....kOoooqOooooqOooqqqk..',
    '...kqqooOoooooOqooqqk....kOoooqOoooooOooqqk...',
    '...kqqoOqoooooOqooqqk....kOoooqOoooooqOoqqk...',
    '...kqqoOqooooooOqqqk......kOoqOooooooqOoqqk...',
    '....kOoooooooooOqqqk......kOoqOooooooooqqk....',
    '....kOoooooooooOqqqk......kOoqOooooooooqqk....',
    '.....kOqqqqqqqqqqqk........kqqqqqqqqqqqqk.....',
    '......kqQQQQQQQQQQk........kQQQQQQQQQQqk......',
    '.......kNNNmmrNNmmk........kmmmmrNNNNmk.......',
    '.......kNNNmmrNnmmk........kmmmmrNnNNmk.......',
    '.......kNNNmmrNnmmk........kmmmmrNnNNmk.......',
    '.......kNNNmmrNnmmk........kmmmmrNnNNmk.......',
    '.....kkmyyyyyyyyyyyk......kyyyyyyyyyyymkk.....',
    '....kNNnNNNNNNNNmmmk......kNmmNNNNNNNNnmmk....',
    '...kNnnnnnnnnnnnmmmk......kNmmnnnnnnnnnnmmk...',
    '..kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk..',
    '..kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk..',
    '..krrrrrrrrrrrrrrrrrk....krrrrrrrrrrrrrrrrrk..',
    '...kkkkkkkkkkkkkkkkk......kkkkkkkkkkkkkkkkk...',
  ] },
  mane: { x: 20, y: 0, rows: [
    '..........................kk........k...................',
    '.........................kbbk......kbk..................',
    '.............k..........kAbAk....kkbbk..................',
    '............kbkk.......kAaaAbk..kAAbbk..................',
    '.............kbbkkk....kAaaAbk.kAaabbk..................',
    '..............kAAbbkk.kAaaaaAbkAaabbk......k............',
    '..............kAaaabAkAaaaaaAaAaaabbkkk.kkkbk...........',
    '...............kAaaaaAaaaaaaAaaaaabbAbbkAbbk............',
    '..............kkAaaaaaAaaaaaaaaaaabbbAAAbbk.............',
    '.............kAbbAaaaaaaaaaaaaaaaabaAaabbbk.............',
    '............kbAAbbAaaaaAAaaaaaaaaaaaaabbAbbk............',
    '..........kkAabbAAaaaAAaaaaBBBaaaaaaabbAaabbkk..........',
    '.........kAAbbAAaaAAAaaaabBSddBaaaaabbAaabbbbbk.........',
    '........kAbbAAaaaaaaaaaBabBSsddBabaaaaAbbbbAAbbk........',
    '.......kAabbAaaaaaaaabBdBBSssddBaBaaabbaabbAaabbk.......',
    '......kAaaaabbAAAAAabBddBBSssddBBdBaaaaaabbAaaabbk......',
    '.....kAabbAAAAbbAaaabBddBBddddddddBabbbAAAAaaAaabbk.....',
    '....kAaaaaAAAAaabbAabBSsSSSssSSSddBBAbbbbbbAaAaaabbk....',
    '...kAaaaaAaaaaaaabbBbbeeeeSsddeeeeBdDAaAAbbbbbAaaabbk...',
    '....kAaaaAaaaaaaabbDBbiteSsssddetiBdDAaaaaaAAAAaabbk....',
    '.....kAaaAaaaaaaabbDdBdTSsssssddTdBdDAaaaaaaaaAabbk.....',
    '......kkAaaaaaaaabbDdDdSssssssssSdDdDAaaaaaaaabAkk......',
    '......kbAaaaaaaaaabbDbDsssdddSssdDbDAaaaaaaaaaaAbk......',
    '......kbaaaaaaaaaaaabbDdsdddDSssdDAAaaaaaaaaaaabbk......',
    '.....kbaaaaaaaaaaaaaabbDsssSSssdDAaaaaaaaaaaaaaabbk.....',
    '.....kbaaaaaaaaaaaaaabbDdddDDdSdDAaaaaaaaaaaaaaabbk.....',
    '....kAbaAaaaaaaaaaaaaabbDsSSSSdDAaaaaaaaaaaaaaaAabbk....',
    '...kAabaAaaaaaaaaaaaaabbDdsssddDAaaaaaaaaaaaaaaAabbbk...',
    '..kAabaaAaaaaaaaaaaaaabbDddddddDAaaaaaaaaaaaaaaAaabbbk..',
    '.kAaabaAaaaaaaaaaaaaaabbDdsSSsdDAaaaaaaaaaaaaaaaAababbk.',
    'kAaaabaAaaaaaaaaaabbQQQQDdssssdDQQQQAaaaaaaaaaaaAabaabbk',
    '.kkAaaaAaabbMMMMMMQQooqqDDDDDDDDOoooQQMMMMMMAaaaAaabbkk.',
    '...kkkAAabbMnNNmMOoooooqqMNNNmMOoooooqqMnNNmMAaaAbkkk...',
    '......kkbbMnNnmMOoOOoooqqMnnnmMOooooOOqqMnnNmMbbkk......',
    '.....kbbbMnNNNmMOoOoOOooqqMnmMOoooOOoOqqMnNNNmMAbbk.....',
    '.....kbbbMnnnnmMOooOOoooqqMnmMOooooOOoqqMnnnnmMAbbk.....',
    '.....kbbMnnnnnmMOoooooooqqMnmMOoooooooqqMnnnnnmMbbk.....',
    '....kbbbMnnnnmMOoooooooooqqMMOoooooooooqqMnnnnmMAbbk....',
    '...kAbbbMnnnnmMOooqooooooqqMMOoooooooqoqqMnnnnmMAabbk...',
    '...kAbbMmnnnnmMOoooqoooooooOOoooooooqooqqMnnnnnmMAbbk...',
    '..kAabbMmnnnnmMOoooqooooooooooooooooqooqqMnnnnnmMAbbbk..',
    '..kAbbbMmnnnnmMqqoooqooooooooooooooqoooqqMnnnnnmMAabbk..',
    '.kAabbbMmnnnnmMqqooooqooooooooooooqooooqqMnnnnnmMAabbbk.',
    'kAaababbMmmmmmMqqooooqooooooooooooqooooqqMmmmmmMAaababbk',
    '.kkAaabbDSSSdDbQqoooooqooooooooooqoooooqQbDSSSdDAaabbkk.',
    '...kkkbDdssSsdDqqMMMMMMMMMMMMMMMMMMMMMMqqDssSssdDbkkk...',
    '......kSdssSsdDQQMnnNNNNNNNNNNNNNNNNnmMQQDssSssddk......',
    '.....kbDdsssSdDbbMnmmNNmmNnnnnnnnnnnnmMbbDsSsssdDbk.....',
    '.....kbDdsssSdDbMnmmNnNnmmNnnnnnnnnnnnmMbDsSsssdDbk.....',
    '.....kbDdsssSdDbMnmmNnnnmmNnnnnnnnnnnnmMbDsSsssdDbk.....',
    '.....kbbDsssdDbbMMMMMNnnnmmMMMMMMMMMMMMMbbDsssdDbbk.....',
    '....kAbbDsssdDbbQOOqqMnnnmMOOqqqqOOOOOqQbbDsssdDAbbk....',
    '...kAbbbDsdddDbQoooqqMnmnmMOoqqqqooooooqQbDddddDAabbk...',
    '...kAbbDssssdDbQoooqqMnmnmMOoqqqoooooooqQbDssssdDAbbk...',
    '..kAabbDssSsdDQooooqqMnmMnmMOqqqooooooooqQDssSsdDAbbbk..',
    '..kAbbDdssSsdDOoooqqMnmMqMmMOqqqooooooooqqDssSssdDbbbk..',
    '.kAabbDdsssSdDOooqqqMnmMqMmMOqqoooooooqoqqDsSsssdDbabbk.',
    '..kkkbDdsssSdDOoOoqqMnmMqMmMOqoooooooooOqqDsSsssdDbkkk..',
    '.....kSdssssdDOOqoqqMnmMqMmMOooooooooooqOqDsssssddk.....',
    '.....kSdssssdDOOooqqMnmMqMMOooooooqoooooOqDsssssddk.....',
    '.....kNNNNNNNmMqooqqMMmMOOOoooooooqOoooqqMNNNNNNmmk.....',
    '.....kNnnnnnnmMOooooOqMMOooooooooooOoooqqMnnnnnnmmk.....',
    '.....kNnnnnnnmMOoooOqoOOooqqqqoooooqOooqqMnnnnnnmmk.....',
    '.....kmmmmmmmmMOoooOqoooooqqqqoooooqOooqqMmmmmmmmmk.....',
    '.....kSSSSSSdDOooooOqoooqoqqqqoqoooqOoooqqDSSSSSddk.....',
    '....kbDddddddDOoooOqoooOqoqqqqoqOoooqOooqqDddddddDbk....',
    '....kbDsssssdDOoooOqoooOqoqQQqoqOoooqOooqqDsssssdDbk....',
    '...kbbDsssssdDOoooOqoooOqqQbbQoqOoooqOooqqDsssssdDbbk...',
    '....kkkdDDDDDOooooOqoooOqqQbbQoqOoooqOoooqqDDDDDdkkk....',
    '.......kOOOOOooooOqooooOqQbkkbQqOooooqOooooOOOqqk.......',
    '.......kOqqooooooOqooooOqQbkkbQqOooooqOooooooqqqk.......',
    '.......kOqqooooqoooooooOqQbkkbQqOoooooooqooooqqqk.......',
    '.......kOqqoooOqoooooooOqqk..kOqOoooooooqOoooqqqk.......',
    '.......kOqqoooOoooooooooqQk..kQooooooooooOoooqqqk.......',
    '.......kOqqooOqooooooooqQbk..kbQoooooooooqOooqqqk.......',
    '.......kOqqooOqoooooqooqqk....kOoooqoooooqOooqqqk.......',
    '.......kOqqooOqooooOqooqqk....kOoooqOooooqOooqqqk.......',
    '........kqqooOoooooOqooqqk....kOoooqOoooooOooqqk........',
    '........kqqoOqoooooOqooqqk....kOoooqOoooooqOoqqk........',
    '........kqqoOqooooooOqqqk......kOoqOooooooqOoqqk........',
    '.........kOoooooooooOqqqk......kOoqOooooooooqqk.........',
    '.........kOoooooooooOqqqk......kOoqOooooooooqqk.........',
    '..........kOqqqqqqqqqqqk........kqqqqqqqqqqqqk..........',
    '...........kqQQQQQQQQQQk........kQQQQQQQQQQqk...........',
    '............kNNNmmrNNmmk........kmmmmrNNNNmk............',
    '............kNNNmmrNnmmk........kmmmmrNnNNmk............',
    '............kNNNmmrNnmmk........kmmmmrNnNNmk............',
    '............kNNNmmrNnmmk........kmmmmrNnNNmk............',
    '..........kkmyyyyyyyyyyyk......kyyyyyyyyyyymkk..........',
    '.........kNNnNNNNNNNNmmmk......kNmmNNNNNNNNnmmk.........',
    '........kNnnnnnnnnnnnmmmk......kNmmnnnnnnnnnnmmk........',
    '.......kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk.......',
    '.......kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk.......',
    '.......krrrrrrrrrrrrrrrrrk....krrrrrrrrrrrrrrrrrk.......',
    '........kkkkkkkkkkkkkkkkk......kkkkkkkkkkkkkkkkk........',
  ] },
  crimson: { x: 23, y: 0, rows: [
    '..........k...........kk........kgk............................',
    '.........kgkk........kggk.....kkggk............................',
    '..........kggkk......kHHgk..kkHgHk.............................',
    '..........kHHggkk...kHhHgkkkHHhHgk......kkk....................',
    '...........kHHhggkkkkHhHgggHhhhHgk.kkkkkHggk...................',
    '...........kHhHhhgggHhhhHhHhhhHgggkHHHHHgHk....................',
    '...........kHhhHhhhHhhhhHhhhhhHhHHHhhhhHHk.....................',
    '............kHhhHhhhhhhhHhhhhHhhhhhhhhHgk......................',
    '...kkkkk...kgHhhhHhhhhhhhhhhhHhhhhhhhHgk.......................',
    '..kHHHggkkkHggHhhhHhhhhhhhhhhhhhhhhHHggk.......................',
    '...kHHHhHHHHHHhhhhhhhhhhhhhhhhhhhhHggHggkk.....................',
    '....kkHHHHhhhhhhhhggDDDDDDDDDDHhhhhhhHHHggkkkk.................',
    '......kHhhHHHhhhhggDsssssssssdDHhhhhggggggggggk................',
    '......kgHhhhhHHhhggDsssssssssdDHhhhhhhhhhggkkk.................',
    '......kHggHhhhhhggDsssssssssssdDHhhhhhhggggk...................',
    '.....kHhhggHhhhhggDeeSsssssddeeDHhhhggHHHhggk..................',
    '....kHhhhggHhhhhggDddeeeddeeeSdDHhhhggHhhhhggk.................',
    '...kHhhggHHhhhhggDdzzzzSsddzzzzdDHhghggHhhhhggk................',
    '....kgHHHhhHHHggDdzeeeeSsddeeeezdDHhggggHhhggk.................',
    '...kHHhHHHHhhhggDdziueSsssddeuizdDHhhhggggHkk..................',
    '....kkHhhhhhhhggDdddUSsssssddUdddDHhhhhhgggk...................',
    '.....kHHHggHhhggDdDdSssssssssSdDdDHHHggHhhggk..................',
    '.....kHhhhhHHggggDgDsssdddSssdDgDHhhhhhHHHgHk..................',
    '....kHHhhhhhhhhggggDdsdddDSssdDgHhhhhhhhhhhHgk.................',
    '....kHHhhhhhhhhhhHggDsssSSssdDHHhhhhhhhhhhhHgk.................',
    '...kHHhhhhhhhhhhhhggDdddDDdSdDHhhhhhhhhhhhhhHgk................',
    '..kHhHhhhhhhhhhhhhhggDsSSSSdDHhhhhhhhhhhhhhhHggk...............',
    '.kHhhhhhhhhhhhhhhhhggDdsssddDHhhhhhhhhhhhhhhhhggk..............',
    '..kkkHhhhhhhhhhhhhhggDddddddDHhhhhhhhhhhhhhggkkk...............',
    '.....kkkHhhhhhhhhhhggDdsSSsdDHhhhhhhhhhhggkkk..................',
    '......kHhhhhhhhggDDDDDdssssdDDDDDHhhhhhhhgHk...................',
    '......kHgVVVVVVVVVSddDdssssdDSddVVVVVVVVVgHk...................',
    '.....kgHVfffvvFFVSsssSSSSSSSSssddVFvFfffvVHgk..................',
    '.....kVVfFFvvFFvVSSSSSssddssSSSSSVfFvFfFFfVVk..................',
    '....kFffFffvvFfvVSSSSSSsddsSSSSSSVfvvFfffFfvvk.................',
    '...kFffffffvvFvVSsssssssddssssssddVvvFffffffvvk................',
    '...kFffffffvvFvVSsssssssddssssssddVvvFffffffvvk................',
    '...kFfffffvvFvfvVddsssssddsssssddVffvvFfffffvvk................',
    '..kFfvffffvvFfvvVddddddddddddddddVfvvvFfffffvvvk...............',
    '..kFfvffffvvFfvVSsssddddddddddssddVfvvFfffffvvvk...............',
    '..kFfvffffvvFfvVSsssSSssddssSSssddVfvvFfffffvvvk...............',
    '.kkFfvffffvvFfvVSsssdddsddsdddssddVfvvFfffffvvvkk..............',
    '..kFfvffffvvFvfvVSssssssddsssssddVffvvFfffffvvvk...............',
    '...kFvffffvvFfvvVSssSSssddssSSsddVfvvvFfffffvvk................',
    '...kFfffffvvFfvVSsssdddsddsdddssddVfvvFfffffvvk................',
    '...kFfffFfvvkvMMMMMMMMMMMMMMMMMMMMMMvkFffFffvvk................',
    '..kkFfffFfvvkvMnnNNNNNNNNNNNNNNNNnmMvkFffFffvvkk...............',
    '.kkkFffffFvvkkNnmmNNmmNnnnnnnnnnnnmMvkFfFfffvvkkk..............',
    '..kkFffffFvvkNnmmNnNnmmNnnnnnnnnnnnmMvFfFfffvvkk...............',
    '...kvffffFvvkNnmmNnnnmmNnnnnnnnnnnnmMvFfFfffvvk................',
    '...kvffffvvkkMMMMMNnnnmmMMMMMMMMMMMMMvvFffffvvk................',
    '...kFvfvvvvkkOOOqqMnnnmMOOqqqqOOOOOqQvFFfvvfvvk................',
    '...kFvfffvvkOoooqqMnmnmMOoqqqqooooooqQvvvfffvvk................',
    '...kFffffvvkOoooqqMnmnmMOoqqqoooooooqQvFffffvvk................',
    '..kFfffFfvVOooooqqMnmMnmMOqqqooooooooqQVffFffvvk...............',
    '.kkFvffFfvVOoooqqMnmMqMmMOqqqooooooooqqVffFffvvkk........kk....',
    'kkFfvfffFvVOooqqqMnmMqMmMOqqoooooooqoqqVfFfffvvvkk......kvvk...',
    '.kFfvfffFvVOoOoqqMnmMqMmMOqoooooooooOqqVfFfffvvvk......kFfvvk..',
    '.kFfvffffvVOOqoqqMnmMqMmMOooooooooooqOqVfffffvvvk......kFfvvk..',
    '..kFvffffvVOOooqqMnmMqMMOooooooqoooooOqVfffffvvk........kFfvvk.',
    '..kNNNNNNNmMqooqqMMmMOOOoooooooqOoooqqMNNNNNNmMvk.......kFfvvk.',
    '..kNnnnnnnmMOooooOqMMOooooooooooOoooqqMnnnnnnmMvk.......kFffvvk',
    '..kNnnnnnnmMOoooOqoOOooqqqqoooooqOooqqMnnnnnnmMvk........kFfvvk',
    '..kmmmmmmmmMOoooOqoooooqqqqoooooqOooqqMmmmmmmmMvvk......kFffvvk',
    '..kSSSSSSdDOooooOqoooqoqqqqoqoooqOoooqqDSSSSSdDvvkk....kFfffvvk',
    '..kSddddddDOoooOqoooOqoqqqqoqOoooqOooqqDddddddDFfvvkkkkFfffvvk.',
    '..kSsssssdDOoooOqoooOqoqqqqoqOoooqOooqqDsssssdDFfffFFFFfffvvk..',
    '..kSsssssdDOoooOqoooOqqqkkOoqOoooqOooqqDsssssdDFffffffffffvvk..',
    '...kdDDDDDOooooOqoooOqqqkkOoqOoooqOoooqqDDDDDDFffFFFfffffvvk...',
    '....kOOOOOooooOqooooOqqk..kOqOooooqOooooOOOqQFffffffFFFffvvk...',
    '....kOqqooooooOqooooOqqk..kOqOooooqOooooooqqqkkkFfffffffvvk....',
    '....kOqqooooqoooooooOqqk..kOqOoooooooqooooqqqk..kkvvvffvvk.....',
    '....kOqqoooOqoooooooOqqk..kOqOoooooooqOoooqqqk....kkkvvvk......',
    '....kOqqoooOoooooooooqqk..kOooooooooooOoooqqqk.......kkk.......',
    '....kOqqooOqooooooooqqk....kOoooooooooqOooqqqk.................',
    '....kOqqooOqoooooqooqqk....kOoooqoooooqOooqqqk.................',
    '....kOqqooOqooooOqooqqk....kOoooqOooooqOooqqqk.................',
    '.....kqqooOoooooOqooqqk....kOoooqOoooooOooqqk..................',
    '.....kqqoOqoooooOqooqqk....kOoooqOoooooqOoqqk..................',
    '.....kqqoOqooooooOqqqk......kOoqOooooooqOoqqk..................',
    '......kOoooooooooOqqqk......kOoqOooooooooqqk...................',
    '......kOoooooooooOqqqk......kOoqOooooooooqqk...................',
    '.......kOqqqqqqqqqqqk........kqqqqqqqqqqqqk....................',
    '........kqQQQQQQQQQQk........kQQQQQQQQQQqk.....................',
    '.........kNNNmmrNNmmk........kmmmmrNNNNmk......................',
    '.........kNNNmmrNnmmk........kmmmmrNnNNmk......................',
    '.........kNNNmmrNnmmk........kmmmmrNnNNmk......................',
    '.........kNNNmmrNnmmk........kmmmmrNnNNmk......................',
    '.......kkmyyyyyyyyyyyk......kyyyyyyyyyyymkk....................',
    '......kNNnNNNNNNNNmmmk......kNmmNNNNNNNNnmmk...................',
    '.....kNnnnnnnnnnnnmmmk......kNmmnnnnnnnnnnmmk..................',
    '....kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk.................',
    '....kNmmmmmnnnnnnnmmmk......kNmmnnnnnnnmmmmmmk.................',
    '....krrrrrrrrrrrrrrrrrk....krrrrrrrrrrrrrrrrrk.................',
    '.....kkkkkkkkkkkkkkkkk......kkkkkkkkkkkkkkkkk..................',
  ] },
  ape: { x: 5, y: 0, rows: [
    '..........................................kLk.........................................',
    '....................................k.....kLk.....k...................................',
    '...................................kLk...kLLLk...kLk..................................',
    '...................................kLLk..kLLLk..kLLk..................................',
    '...................................kLLLk.kLLLk.kLLLk..................................',
    '..............................k....kLLLLkLLLLLkLLLLk....k.............................',
    '.............................kLk...kLLLLLLLLLLLlLLLk...kLk............................',
    '.............................kLLkk.kLLLLLLLLLLLlLLLk.kkLLk............................',
    '..............................kLLLklLLLLLLLLLLLlLLLkkLLLk.............................',
    '..............................kLLLLklLLLLLLLLLLlLLLkLLLLk.............................',
    '........................kk....kLLLLLlLLLLLLLLLLlLLLLLLLLk...kk........................',
    '.......................kllkkkkkLLLLLLlLLLLLLLLLlLLLLLLLkkkkkllk.......................',
    '........................kJJJJllLLLLLLlLLLJJllLLLLLLLLLLJJJJllk........................',
    '.........................kJjjjllLLLLLLJJJjjjjJJllLLLLLLJjjllk.........................',
    '..........................kJjjllLLJJJJjjjjjjjjjjjJJllLLJjllk..........................',
    '...........................klcllJJjjjjjjjjjjjjjjjjjjllllclk...........................',
    '............................klccLlllllJjjjjjjjlllllllLcclk............................',
    '.............................klLllllllllJjjjllllllllllLlk.............................',
    '..............................kllllllllllllllllllllllllk..............................',
    '..............................kllllllllllllllllllllllllk..............................',
    '..............................kJjJJllZZGllllllGZZJJJJllk..............................',
    '..............................kJjjjjjllEEEEEEEEJJjjjjllk..............................',
    '..............................kJjjjllEEccccccccEEJjjjllk..............................',
    '......kk......................kJjjllEccccccccccccEJjjllk......................kk......',
    '...kkkcckkk...................kJjllEccccLLccLLccccEJjllk...................kkkcckkk...',
    '..kcccccccck...................kJllEccccccccccccccEJllk...................kcccccccck..',
    '.kcccCCCcccck..................kJllEccccccppccccccEJllk..................kccccCCCccck.',
    'kcccccccccccck..................klEccccppppppppccccElk..................kcccccccccccck',
    'kccEEEEEEEEEck...................klEccwpZZZZZZpwccElk...................kcEEEEEEEEEcck',
    'kcccccccccccck..................kkkcccpZZZZZZZZpccckkk..................kcccccccccccck',
    'kcccccccccccck................kkJllEccpZZGGGGZZpccEJllkk................kcccccccccccck',
    'kccEEEEEEEEEck....kkkkkk...kkkJJjjllEEppZZZZZZppEEJjjjllkkk...kkkkkk....kcEEEEEEEEEcck',
    'kcccccccccccck..kkJJJJllkkkJJJjjjjjllEEwppZZppwEEJjjjjjjJllkkkJJJJllkk..kcccccccccccck',
    '.kcccccccccck.kkJJjjjjjjllJjjjjjjjjjjllEEEppEEEJJjjjjjjjjjllJJjjjjjjllkk.kcccccccccck.',
    '.klccEccEcclkkJJjjjjjJJJjjllJjjjjjjjjJJJJJJJJJJJJjjjjjjjllJJjjJJJjjjjjllkklccEccEcclk.',
    '.kJJllccJJllkkJjjJJJJjjjjjllJjjjJJJJJjjjjjjjjjjjjJJJJJjjllJjjjjjjJJJJjllkkJJllccJJllk.',
    '.kJjjjJJjjllkJjJJjjjjjjjjjjllJJJjJJJJJjjjjjjjjjjJJJJJjJJJJjjjjjjjjjjjJJllkJjjjJJjjllk.',
    '.kJjjjjjjjjjJjjjjjjjjjjjjjjjllJJJjjjjjjjjjjjjjjjjjjjjJJJJjjjjjjjjjjjjjjjjJjjjjjjjjllk.',
    '.kJjjjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjjjllk.',
    '.kJjjjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjjjllk.',
    '.kJljjjjjjJjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjJjjjjjjllk.',
    '.kJljjjjjjJjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjJjjjjjjllk.',
    '.kJljjjjjjJjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjJjjjjjjllk.',
    '.kJljjjjjjJjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjJjjjjjjllk.',
    '.kJljjjjjjJjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjJjjjjjjllk.',
    '.kljjjjjjjJjjjjjjjjjjjjjjjllljjjjjjjjjjjjjjjjjjjjjjjjjjjllJjjjjjjjjjjjjjjjjJjjjjjjllk.',
    '.kljjjjjjjJjjjjjjjjjjjjjllJJlllljjjjjjjjjjjjjjjjjjjjjjllllllJjjjjjjjjjjjjjjJjjjjjjllk.',
    '.kljjjjjjjJjjjjjjjjjjjllJJjjjjlllljjjjjjjjjjjjjjjjjjlllljjjjllJjjjjjjjjjjjjJjjjjjjllk.',
    '.kljjjjjjjjjjjjjjljllJJJjjjjjjjjllllljjjjjjjjjjjjllllljjjjjjjjJllJjjljjjjjjjjjjjjjllk.',
    '.kljjjjjjjjjjjjjljllJjjjjjjjjjjjjjlllllljjjjjjlllllljjjjjjjjjjjjllJjjljjjjjjjjjjjjllk.',
    '.kljjjjjjjjjjjjljllJjljjjjjjjjjjjjjjjlljlljjlljlljjjjjjjjjjjjjjjlllJjjljjjjjjjjjjjllk.',
    '.kJjjjjjjjjjjjljllkJjljjjjjjjjjjjjjjjjjlljjjjlljjjjjjjjjjjjjjjjjlllkJjjljjjjjjjjjjllk.',
    '.kJjjjjjjjjjjljllkkJjljjjjjjjjjjjjjjjjjjjjlljjjjjjjjjjjjjjjjjjjjlllkkJjjljjjjjjjjjllk.',
    '.kJjjjjjjjjjlllkk.kJjljjjjjjjjjjjjjjjjjjjjlljjjjjjjjjjjjjjjjjjjjlllk.kkJjljjjjjjjjllk.',
    '..kJjjjjjjjlllk....kJjljjjjjjjjJjjjjjjjjjjlljjjjjjjjjjJjjjjjjjjlllk....kJjljjjjjjllk..',
    '..kJjjjjjjlllk.....kJjljjjjjjjjjJJjjjjjjjjlljjjjjjjjJJjjjjjjjjjlllk.....kJjljjjjjllk..',
    '...kJjjjjlllk......kJjljjjjjjjjjjjJJjjjjjjlljjjjjjJJjjjjjjjjjjjlllk......kJjljjjllk...',
    '....kkJjllkk........kJljjjjjjjjjjjjjJJjjjjlljjjjJJjjjjjjjjjjjjjllk........kkJjllkk....',
    '......kkkk..........kJljjjjjjjjjjjjjjjjjjjlljjjjjjjjjjjjjjjjjjjllk..........kkkk......',
    '....................kJljjjjjjjjjjjjjjjjjjjlljjjjjjjjjjjjjjjjjjjllk............kkkk....',
    '.....................kljjjjjlljjjjjjjjjjjjlljjjjjjjjjjjjlljjjjllk............kJJllk...',
    '.....................kJljjjjjjlljjjjjjjjjjlljjjjjjjjjjlljjjjjjllk............kJjllk...',
    '.....................kJljjjjjjjjlljjjjjjjjlljjjjjjjjlljjjjjjjjllk............kJjjllk..',
    '.....................kJljjjjjjjjjjllljjjjjlljjjjjllljjjjjjjjjjllk............kJjjllk..',
    '......................klljjjjjjjjjjjjlljjjlljjjlljjjjjjjjjjjjllk.............kJjjllk..',
    '......................kJljjjjjjjjjjjjjjlljjjjlljjjjjjjjjjjjjjllk.............kJjjllk..',
    '......................kJjljjjjjjjjjjjjjjjlllljjjjjjjjjjjjjjjlllk.............kJjjjllk.',
    '.......................kJljjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjllk..............kJjjjllk.',
    '.......................kJljjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjllk..............kJjjjllk.',
    '.......................kJjljjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjlllk...............kJjjllk.',
    '........................kJljjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjllk................kJjjjllk',
    '........................kJljjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjllk...............kJjjjjllk',
    '........................kJjljjjjjjjjjjjjjjjjjjjjjjjjjjjjjjlllk..............kJjjjjjllk',
    '.........................kJljjjjjjjjjjjjjjjjjjjjjjjjjjjjjjlllkkk...........kJjjjjjjllk',
    '.........................klljjjjjjjjjjjjjjjjjjjjjjjjjjjjjlllJJllkkk.......kJjjjjjjllk.',
    '.........................klJljjjjjjjjjjjjjjjjjjjjjjjjjjjjlllJjjjJllkkkk..kJjjjjjjllk..',
    '.........................kllljjjjjjjjjjjjjjjjjjjjjjjjjjjllllJjjjjjjJJllkkJjjjjjjllk...',
    '.........................kllJjjjjjjjjjjjjjjjjjjjjjjjjjjjllllJjjjjjjjjjjJJjjjjjjllk....',
    '.........................kJllJjjjjjjjjjjjjjjjjjjjjjjjjjllJllJjjjjjjjjjjjjjjjjjllk.....',
    '.........................kJlllJjjjjjjjjjjjjjjjjjjjjjjjllJjllljjjjjjjjjjjjjjjjllk......',
    '.........................kJljjJllJjjjjjjjjjjjjjjjjjllJJJjjllJlljjjjjjjjjjjjjllk.......',
    '........................kJjljjjjjJJJllkkJjjjllkkJJJJJjjjjjlllkkllljjjjjjjjjllk........',
    '........................kJljjjjjjjjjllk.kkkkkk.kJjjjjjjjjjjllk.kkkllljjjjjllk.........',
    '........................kJljjjjjjjjllk..........kJjjjjjjjjjllk....kkklljjjllk.........',
    '........................kJljjjjjjjjllk..........kJjjjjjjjjjllk.......kklllkk..........',
    '........................kJljjjjjjjjllk..........kJjjjjjjjjjllk.........kkk............',
    '........................kJljjjjjjjjllk..........kJjjjjjjjjjllk........................',
    '......................kkccccccccccllk............kllcccccccccckk......................',
    '.....................kcccccccccccccck............kcccccccccccccck.....................',
    '....................kcccccccccccccccck..........kcccccccccccccccck....................',
    '...................kcccccccccccccccccck........kcccccccccccccccccck...................',
    '....................kcccccccccccccccck..........kcccccccccccccccck....................',
    '.....................kcEccEccEccEccEk............kEccEccEccEccEck.....................',
    '......................kkcccccccccckk..............kkcccccccccckk......................',
    '........................kkkkkkkkkk..................kkkkkkkkkk........................',
  ] },
} as const satisfies Record<string, PixelSprite>;

export const PATCHES = {
  'kid-worried': { x: 41, y: 45, rows: [
    'KSddeeddeeSddK',
    'gee.SS..Sddee.',
    '..............',
    '..ieied.eieid.',
    '..d.eS.d.e.d..',
    '..s.S....S....',
    '..............',
    '..............',
    '......dD.dD...',
    '......DddD....',
    '.......s......',
  ] },
  'kid-blink': { x: 42, y: 47, rows: [
    'Sssss.ssssdd',
    'e.e......e.e',
    'SSS....sSSd.',
    '.ss......s..',
  ] },
  'ape-worried': { x: 42, y: 12, rows: [
    '..................6..',
    '.................666J',
    '..................6J.',
    '.....................',
    '.....................',
    '.....................',
    '.....................',
    '.....................',
    '..Z......Z...........',
    '.....................',
    '.....................',
    '.....................',
    '.....................',
    '.....................',
    '.....cc..............',
    '..cccccccc...........',
    '.cccccccccc..........',
    'EEccccEEEEc..........',
    '.cEEEEccccEE.........',
    '.EEEEEEEEEE..........',
    '..EEEEEEEE...........',
    '.....EE..............',
  ] },
  'warrior-worried': { x: 41, y: 14, rows: [
    '............K.',
    '..S......SsddK',
    '.S.d......S...',
    'geee....ddeeeH',
    'Kd...ed.e...dK',
    '..i.eS.d.e.i..',
    '..deS...d.ed..',
    '..sS......Ss..',
    '..............',
    '..............',
    '..............',
    '.....Dd.DdD...',
    '....ddDddD....',
    '......S.......',
  ] },
  'warrior-blink': { x: 41, y: 18, rows: [
    'KSssss.ssssddK',
    '.e..eS.d.e..e.',
    '.SS.S....SSd..',
    '..s........s..',
  ] },
  'golden-worried': { x: 40, y: 15, rows: [
    '...S......ssddB',
    '..S.d......S...',
    'abBbb....ddbbBb',
    '.Bd....d.e...d.',
    '...ite..d.eti..',
    '...dTS...d.Td..',
    '...sS......Ss..',
    '...............',
    '...............',
    '...............',
    '......Dd.DdD...',
    '.....ddDddD....',
    '.......S.......',
  ] },
  'golden-blink': { x: 41, y: 18, rows: [
    'BSsdd..ssssdd',
    '.ee.e..d.e.ee',
    '.SS.S....SSd.',
    '..s........s.',
  ] },
  'mane-worried': { x: 41, y: 16, rows: [
    '..........S..',
    '.ddd....ddd..',
    'Bd...ed.e...d',
    '..iteS.d.eti.',
    '..dTS...d.Td.',
    '..sS......Ss.',
    '.............',
    '.............',
    '.............',
    '.....Dd.DdD..',
    '....ddDddD...',
    '......S......',
  ] },
  'mane-blink': { x: 41, y: 18, rows: [
    'BSssss.ssssdd',
    '.ee.eS.d.e.ee',
    '.SS.S....SSd.',
    '..s........s.',
  ] },
  'crimson-worried': { x: 41, y: 15, rows: [
    '.sss.....sssd',
    '.s.d......Ss.',
    '.............',
    '.d...ed.e...d',
    '..iueS.d.eui.',
    'S.dUS...d.US.',
    '..sS......Ss.',
    '.............',
    '.............',
    '.............',
    '.....Dd.DdD..',
    '....ddDddD...',
    '......S......',
  ] },
  'crimson-blink': { x: 41, y: 18, rows: [
    '.SSSSs.ssSSdd',
    '.ee.eS.d.e.ee',
    'SSS.S....SSS.',
    '..s........s.',
  ] },
  // --- derived frames: tools/rio/derive-frames.mjs (hand-editable) ---
  'kid-idle-2': { x: 35, y: 26, rows: [
    '.........k.........k........',
    'k...........................',
    '...........................k',
    '............................',
    '..............k.............',
  ] },
  'kid-idle-3': { x: 35, y: 26, rows: [
    '..........k.........k.......',
    '............................',
    'k...........................',
    '...........................k',
    '...............k............',
  ] },
  'warrior-idle-2': { x: 35, y: -1, rows: [
    '.........k.......k.......',
    'k........................',
    '.........................',
    '........................k',
  ] },
  'warrior-idle-3': { x: 35, y: -1, rows: [
    '..........k........k.....',
    '.........................',
    'k........................',
    '.........................',
    '........................k',
    '.....k...................',
  ] },
  'golden-idle-2': { x: 36, y: -1, rows: [
    'k........k.......k..........k',
    '.............................',
    '.............................',
    '.......................k.....',
  ] },
  'golden-idle-3': { x: 33, y: -1, rows: [
    'b............k........k..........k',
    '..................................',
    '.....k............................',
  ] },
  'mane-idle-2': { x: 33, y: -1, rows: [
    '............k.........k',
    'k......................',
    '.......................',
    '.....k.................',
    '.................k.....',
  ] },
  'mane-idle-3': { x: 33, y: -1, rows: [
    '.............k.........k',
    '........................',
    'k.......................',
    '........................',
    '.....k............k.....',
  ] },
  'crimson-idle-2': { x: 34, y: -1, rows: [
    'k.........k........k..........',
    '..............................',
    '.....k.......................k',
  ] },
  'crimson-idle-3': { x: 33, y: -1, rows: [
    'k...........k.........k',
    '.......................',
    '.......................',
    '.....k...........k.....',
  ] },
  'ape-idle-2': { x: 35, y: -1, rows: [
    '......k.............k......',
    '...........k...............',
    '...........................',
    '...........................',
    'k.........................k',
  ] },
  'ape-idle-3': { x: 35, y: -1, rows: [
    '............k..............',
    '......k.............k......',
    '...........................',
    '...........................',
    '...........................',
    'k.........................k',
  ] },
  'kidDown-2': { x: 36, y: 28, rows: [
    '....................k.......',
    '............................',
    'k...........................',
    '...........................k',
  ] },
  // --- end derived frames ---
} as const satisfies Record<string, PixelSprite>;

const frame = (sprite: PixelSprite, ...patches: PixelSprite[]): SpriteFrame =>
  patches.length ? { sprite, patches } : { sprite };

const shifted = (sprite: PixelSprite, shift: BandShift, ...patches: PixelSprite[]): SpriteFrame =>
  patches.length ? { sprite, shift, patches } : { sprite, shift };

const BREATH: Record<FormId, BandShift> = {
  kid: { top: 27, bottom: 60, dy: -1, fill: true },
  warrior: { top: 0, bottom: 33, dy: -1, fill: true },
  golden: { top: 0, bottom: 33, dy: -1, fill: true },
  mane: { top: 0, bottom: 33, dy: -1, fill: true },
  crimson: { top: 0, bottom: 33, dy: -1, fill: true },
  ape: { top: 0, bottom: 41, dy: -1, fill: true },
};

const HAIR_ROWS: Record<FormId, number> = { kid: 10, warrior: 8, golden: 8, mane: 8, crimson: 8, ape: 8 };

const hair = (form: FormId, dx: number): BandShift => {
  const top = BREATH[form].top;
  return { top, bottom: top + HAIR_ROWS[form], dx };
};

const KID_DROOP: BandShift = { top: 27, bottom: 54, dy: 1 };

export const FORM_FRAMES: Record<FormId, {
  idle: readonly SpriteFrame[];
  defeated?: readonly SpriteFrame[];
  worried?: readonly SpriteFrame[];
  blink?: PixelSprite;
}> = {
  kid: {
    idle: [frame(SPRITES.kid), shifted(SPRITES.kid, BREATH.kid), shifted(SPRITES.kid, BREATH.kid, PATCHES['kid-idle-2']), frame(SPRITES.kid, PATCHES['kid-idle-3'])],
    defeated: [frame(SPRITES.kidDown), shifted(SPRITES.kidDown, KID_DROOP), shifted(SPRITES.kidDown, KID_DROOP, PATCHES['kidDown-2'])],
    worried: [frame(SPRITES.kid, PATCHES['kid-worried']), shifted(SPRITES.kid, hair('kid', 1), PATCHES['kid-worried']), shifted(SPRITES.kid, hair('kid', -1), PATCHES['kid-worried'])],
    blink: PATCHES['kid-blink'],
  },
  warrior: {
    idle: [frame(SPRITES.warrior), shifted(SPRITES.warrior, BREATH.warrior), shifted(SPRITES.warrior, BREATH.warrior, PATCHES['warrior-idle-2']), frame(SPRITES.warrior, PATCHES['warrior-idle-3'])],
    worried: [frame(SPRITES.warrior, PATCHES['warrior-worried']), shifted(SPRITES.warrior, hair('warrior', 1), PATCHES['warrior-worried']), shifted(SPRITES.warrior, hair('warrior', -1), PATCHES['warrior-worried'])],
    blink: PATCHES['warrior-blink'],
  },
  golden: {
    idle: [frame(SPRITES.golden), shifted(SPRITES.golden, BREATH.golden), shifted(SPRITES.golden, BREATH.golden, PATCHES['golden-idle-2']), frame(SPRITES.golden, PATCHES['golden-idle-3'])],
    worried: [frame(SPRITES.golden, PATCHES['golden-worried']), shifted(SPRITES.golden, hair('golden', 1), PATCHES['golden-worried']), shifted(SPRITES.golden, hair('golden', -1), PATCHES['golden-worried'])],
    blink: PATCHES['golden-blink'],
  },
  mane: {
    idle: [frame(SPRITES.mane), shifted(SPRITES.mane, BREATH.mane), shifted(SPRITES.mane, BREATH.mane, PATCHES['mane-idle-2']), frame(SPRITES.mane, PATCHES['mane-idle-3'])],
    worried: [frame(SPRITES.mane, PATCHES['mane-worried']), shifted(SPRITES.mane, hair('mane', 1), PATCHES['mane-worried']), shifted(SPRITES.mane, hair('mane', -1), PATCHES['mane-worried'])],
    blink: PATCHES['mane-blink'],
  },
  crimson: {
    idle: [frame(SPRITES.crimson), shifted(SPRITES.crimson, BREATH.crimson), shifted(SPRITES.crimson, BREATH.crimson, PATCHES['crimson-idle-2']), frame(SPRITES.crimson, PATCHES['crimson-idle-3'])],
    worried: [frame(SPRITES.crimson, PATCHES['crimson-worried']), shifted(SPRITES.crimson, hair('crimson', 1), PATCHES['crimson-worried']), shifted(SPRITES.crimson, hair('crimson', -1), PATCHES['crimson-worried'])],
    blink: PATCHES['crimson-blink'],
  },
  ape: {
    idle: [frame(SPRITES.ape), shifted(SPRITES.ape, BREATH.ape), shifted(SPRITES.ape, BREATH.ape, PATCHES['ape-idle-2']), frame(SPRITES.ape, PATCHES['ape-idle-3'])],
    worried: [frame(SPRITES.ape, PATCHES['ape-worried']), shifted(SPRITES.ape, hair('ape', 1), PATCHES['ape-worried']), shifted(SPRITES.ape, hair('ape', -1), PATCHES['ape-worried'])],
  },
};

/**
 * The crouch for the transformation, derived from the standing frame: rows above `hip` (head, torso, arms) drop by
 * `drop`, the trouser rows [hip, cuff) lose `drop` rows from the thigh and bow outward up to `splay` px at the knee
 * (left of `CROUCH_CX` moves left, the rest right), and the shins and feet from `cuff` down stay planted. So the feet,
 * the shadow and the aura's base stay where the standing pose has them.
 */
export interface CrouchCut { hip: number; cuff: number; drop: number; splay: number }
export const CROUCH_CX = 48;
export const CROUCH: Record<FormId, CrouchCut> = {
  kid: { hip: 81, cuff: 88, drop: 3, splay: 2 },
  warrior: { hip: 69, cuff: 82, drop: 5, splay: 3 },
  golden: { hip: 69, cuff: 82, drop: 5, splay: 3 },
  mane: { hip: 69, cuff: 82, drop: 5, splay: 3 },
  crimson: { hip: 69, cuff: 82, drop: 5, splay: 3 },
  ape: { hip: 81, cuff: 87, drop: 2, splay: 2 },
};

const crouchCache = new WeakMap<PixelSprite, PixelSprite>();

/** The crouched pose of `standing` (a composed frame of `form`). Whole-pixel moves of its own pixels only. */
export function crouchSprite(form: FormId, standing: PixelSprite): PixelSprite {
  const hit = crouchCache.get(standing);
  if (hit) return hit;
  const { hip, cuff, drop, splay } = CROUCH[form];
  const cells = new Map<string, string>();
  const put = (x: number, y: number, ch: string) => { cells.set(`${x},${y}`, ch); };
  const at = (x: number, y: number) => {
    const ch = standing.rows[y - standing.y]?.[x - standing.x];
    return ch && ch !== '.' ? ch : undefined;
  };
  const width = standing.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const xs = Array.from({ length: width }, (_, i) => standing.x + i);
  for (let y = cuff; y < standing.y + standing.rows.length; y++) {
    for (const x of xs) { const ch = at(x, y); if (ch) put(x, y, ch); }
  }
  // The thigh loses `drop` rows, spread over the band's inside (its top row and the hem stay).
  const band = Array.from({ length: cuff - hip }, (_, i) => hip + i);
  const inner = band.slice(1, -2);
  const cut = new Set(Array.from({ length: drop }, (_, k) => inner[Math.round(((k + 0.5) * inner.length) / drop - 0.5)]));
  const kept = band.filter(y => !cut.has(y));
  const knee = kept.length * 0.55;
  kept.forEach((src, t) => {
    const f = t < knee ? (t + 1) / (knee + 1) : (kept.length - t) / (kept.length - knee);
    const dx = Math.max(0, Math.round(splay * f));
    const y = hip + drop + t;
    for (const x of xs) {
      const ch = at(x, src);
      if (ch) put(x < CROUCH_CX ? x - dx : x + dx, y, ch);
    }
    // Where the two legs are still joined, close the gap the bow opens with the pixels either side of the middle.
    const l = at(CROUCH_CX - 1, src);
    const r = at(CROUCH_CX, src);
    if (dx && l && r) {
      for (let k = 1; k <= dx; k++) { put(CROUCH_CX - 1 - dx + k, y, l); put(CROUCH_CX + dx - k, y, r); }
    }
  });
  // Head, torso and arms last, so the fists stay in front of the trousers.
  for (let y = standing.y; y < hip; y++) {
    for (const x of xs) { const ch = at(x, y); if (ch) put(x, y + drop, ch); }
  }
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const key of cells.keys()) {
    const [x, y] = key.split(',').map(Number);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
  }
  const rows = Array.from({ length: y1 - y0 }, (_, j) => Array.from({ length: x1 - x0 }, (_, i) => cells.get(`${x0 + i},${y0 + j}`) ?? '.').join(''));
  const out: PixelSprite = { x: x0, y: y0, rows };
  crouchCache.set(standing, out);
  return out;
}

/** `shift.dy` of each kid idle frame. The other forms use the same list. */
export const IDLE_BLINK_DY: readonly number[] = FORM_FRAMES.kid.idle.map(entry => entry.shift?.dy ?? 0);

const blinkShiftCache = new WeakMap<PixelSprite, Map<number, PixelSprite>>();

export function blinkForIdle(patch: PixelSprite, frame: SpriteFrame): PixelSprite {
  const dy = frame.shift?.dy ?? 0;
  if (dy === 0) return patch;
  let byDy = blinkShiftCache.get(patch);
  if (!byDy) blinkShiftCache.set(patch, byDy = new Map());
  let hit = byDy.get(dy);
  if (!hit) byDy.set(dy, hit = { x: patch.x, y: patch.y + dy, rows: patch.rows });
  return hit;
}

const composedCache = new WeakMap<SpriteFrame, PixelSprite>();

const paintPart = (grid: string[][], x0: number, y0: number, part: PixelSprite) => {
  part.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      grid[part.y + j - y0][part.x + i - x0] = ch === ERASE ? '.' : ch;
    }
  });
};

const applyShift = (grid: string[][], x0: number, y0: number, shift: BandShift) => {
  const dx = shift.dx ?? 0;
  const dy = shift.dy ?? 0;
  const height = grid.length;
  const width = grid[0].length;
  const at = (x: number, y: number) => {
    const j = y - y0;
    const i = x - x0;
    if (j < 0 || i < 0 || j >= height || i >= width) return undefined;
    return grid[j][i];
  };
  const clears: { x: number; y: number }[] = [];
  const writes: { x: number; y: number; ch: string }[] = [];
  for (let y = shift.top; y < shift.bottom; y++) {
    for (let x = x0; x < x0 + width; x++) {
      const ch = at(x, y);
      if (!ch || ch === '.') continue;
      clears.push({ x, y });
      writes.push({ x: x + dx, y: y + dy, ch });
      if (shift.fill && y === shift.bottom - 1) {
        const below = at(x, y + 1);
        if (below && below !== '.') writes.push({ x, y, ch });
      }
    }
  }
  for (const cell of clears) grid[cell.y - y0][cell.x - x0] = '.';
  for (const cell of writes) grid[cell.y - y0][cell.x - x0] = cell.ch;
};

export function composeFrame(frame: SpriteFrame): PixelSprite {
  const hit = composedCache.get(frame);
  if (hit) return hit;
  const parts = [frame.sprite, ...(frame.patches ?? [])];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    const w = p.rows.reduce((m, r) => Math.max(m, r.length), 0);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + w);
    y1 = Math.max(y1, p.y + p.rows.length);
  }
  const shift = frame.shift;
  if (shift) {
    const dx = shift.dx ?? 0;
    const dy = shift.dy ?? 0;
    const sw = frame.sprite.rows.reduce((m, r) => Math.max(m, r.length), 0);
    x0 = Math.min(x0, frame.sprite.x + dx);
    x1 = Math.max(x1, frame.sprite.x + sw + dx);
    y0 = Math.min(y0, shift.top + dy);
    y1 = Math.max(y1, shift.bottom + dy);
  }
  const grid = Array.from({ length: y1 - y0 }, () => Array.from({ length: x1 - x0 }, () => '.'));
  paintPart(grid, x0, y0, frame.sprite);
  if (shift) applyShift(grid, x0, y0, shift);
  for (const p of frame.patches ?? []) paintPart(grid, x0, y0, p);
  const out: PixelSprite = { x: x0, y: y0, rows: grid.map(r => r.join('')) };
  composedCache.set(frame, out);
  return out;
}

/**
 * The perfect-lesson dab, re-posed from the standing frame's own pixels (no new art). Each part lifts the cells inside
 * its boxes (minus `skip` colours) out of the figure, applies `op` (a flip or a quarter turn), then a shear that moves
 * row j left by `shear` px per row above the part's last row (so a vertical arm leans up and out), and is pasted with
 * its top-left at `at`. Parts paint in order over the rest, so the bent arm crosses the face. The head band
 * [top, bottom) between x0 and x1 moves by dx, dy and leans `lean` px per row into the elbow. `prune` drops leftover
 * pieces smaller than that (hair that only hung beside an arm); any piece under 3 cells is dropped as a shear speck.
 * Keep every cell inside WarriorArt's mask grid (x -8..103, y -14..97).
 */
type Box = readonly [x0: number, y0: number, x1: number, y1: number];
export interface DabPart { boxes: readonly Box[]; skip?: string; op?: 'flipY' | 'flipX' | 'rotR'; shear?: number; at: readonly [number, number] }
export interface DabCut { head: { top: number; bottom: number; x0?: number; x1?: number; dx: number; dy: number; lean: number }; prune?: number; parts: readonly DabPart[] }
const SUIT_DAB: DabCut = {
  head: { top: 0, bottom: 30, dx: -2, dy: 3, lean: 0.1 },
  parts: [
    { boxes: [[25, 30, 36, 44], [25, 44, 35, 69]], op: 'flipY', shear: 0.5, at: [28, -3] },
    { boxes: [[61, 30, 73, 44]], op: 'rotR', at: [48, 28] },
    { boxes: [[62, 44, 73, 69]], op: 'flipY', shear: 0.5, at: [50, 7] },
  ],
};
export const DAB: Record<FormId, DabCut> = {
  kid: {
    head: { top: 27, bottom: 58, dx: -1, dy: 2, lean: 0.08 },
    parts: [
      { boxes: [[33, 59, 42, 80]], skip: 'xXOoqQ', op: 'flipY', shear: 0.75, at: [36, 40] },
      { boxes: [[56, 52, 67, 72]], shear: 0.5, at: [52, 42] },
    ],
  },
  warrior: SUIT_DAB,
  golden: SUIT_DAB,
  mane: {
    head: { top: 0, bottom: 30, x0: 30, x1: 66, dx: -2, dy: 3, lean: 0.1 },
    prune: 60,
    parts: [
      { boxes: [[25, 30, 37, 44], [25, 44, 36, 69]], skip: 'Aab', op: 'flipY', shear: 0.5, at: [29, -3] },
      { boxes: [[59, 30, 72, 44]], skip: 'Aab', op: 'rotR', at: [49, 28] },
      { boxes: [[60, 44, 72, 69]], skip: 'Aab', op: 'flipY', shear: 0.5, at: [51, 7] },
    ],
  },
  crimson: {
    head: { top: 0, bottom: 30, dx: -2, dy: 3, lean: 0.1 },
    prune: 40,
    parts: [
      { boxes: [[24, 30, 39, 45], [24, 45, 37, 51], [24, 51, 34, 70]], op: 'flipY', shear: 0.5, at: [27, -4] },
      { boxes: [[72, 54, 90, 76]], at: [63, 54] },
      { boxes: [[57, 30, 71, 45]], op: 'rotR', at: [46, 28] },
      { boxes: [[59, 45, 71, 51], [61, 51, 72, 70]], op: 'flipY', shear: 0.5, at: [50, 8] },
    ],
  },
  // The ape's raised left arm already reaches up and out; its right forearm leans across the face.
  ape: {
    head: { top: 0, bottom: 37, x0: 30, x1: 70, dx: -2, dy: 2, lean: 0.06 },
    parts: [{ boxes: [[77, 22, 93, 60]], shear: 0.9, at: [77, 22] }],
  },
};

const cellKey = (x: number, y: number) => `${x},${y}`;

/** Drop 4-connected pieces of fewer than `min` cells. */
function prunePieces(cells: Map<string, string>, min: number) {
  const seen = new Set<string>();
  for (const start of [...cells.keys()]) {
    if (seen.has(start)) continue;
    const piece = [start];
    seen.add(start);
    for (let i = 0; i < piece.length; i++) {
      const [x, y] = piece[i].split(',').map(Number);
      for (const k of [cellKey(x + 1, y), cellKey(x - 1, y), cellKey(x, y + 1), cellKey(x, y - 1)]) {
        if (cells.has(k) && !seen.has(k)) { seen.add(k); piece.push(k); }
      }
    }
    if (piece.length < min) for (const k of piece) cells.delete(k);
  }
}

function toSprite(cells: Map<string, string>): PixelSprite {
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const k of cells.keys()) {
    const [x, y] = k.split(',').map(Number);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
  }
  return { x: x0, y: y0, rows: Array.from({ length: y1 - y0 }, (_, j) => Array.from({ length: x1 - x0 }, (_, i) => cells.get(cellKey(x0 + i, y0 + j)) ?? '.').join('')) };
}

const dabCache = new WeakMap<PixelSprite, PixelSprite>();

/** The dab hold of `standing` (a composed frame of `form`): only moved, flipped and turned cells of that frame. */
export function dabSprite(form: FormId, standing: PixelSprite): PixelSprite {
  const hit = dabCache.get(standing);
  if (hit) return hit;
  const cut = DAB[form];
  const rest = new Map<string, string>();
  standing.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') rest.set(cellKey(standing.x + i, standing.y + j), row[i]); });
  const layers = cut.parts.map(part => {
    const x0 = Math.min(...part.boxes.map(b => b[0])); const y0 = Math.min(...part.boxes.map(b => b[1]));
    const x1 = Math.max(...part.boxes.map(b => b[2])); const y1 = Math.max(...part.boxes.map(b => b[3]));
    let grid = Array.from({ length: y1 - y0 }, () => Array<string>(x1 - x0).fill('.'));
    for (const [bx0, by0, bx1, by1] of part.boxes) {
      for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
        const ch = rest.get(cellKey(x, y));
        if (ch && !part.skip?.includes(ch)) { grid[y - y0][x - x0] = ch; rest.delete(cellKey(x, y)); }
      }
    }
    if (part.op === 'flipY') grid.reverse();
    if (part.op === 'flipX') grid.forEach(r => r.reverse());
    if (part.op === 'rotR') grid = grid[0].map((_, i) => grid.map(r => r[i]).reverse());
    const out = new Map<string, string>();
    grid.forEach((row, j) => {
      const dx = -Math.round((grid.length - 1 - j) * (part.shear ?? 0));
      row.forEach((ch, i) => { if (ch !== '.') out.set(cellKey(part.at[0] + i + dx, part.at[1] + j), ch); });
    });
    return out;
  });
  if (cut.prune) prunePieces(rest, cut.prune);
  const { top, bottom, x0 = -Infinity, x1 = Infinity, dx, dy, lean } = cut.head;
  const all = new Map<string, string>();
  const head: Array<[string, string]> = [];
  for (const [k, ch] of rest) {
    const [x, y] = k.split(',').map(Number);
    if (y >= top && y < bottom && x >= x0 && x < x1) head.push([cellKey(x + dx - Math.round((bottom - 1 - y) * lean), y + dy), ch]);
    else all.set(k, ch);
  }
  for (const [k, ch] of head) all.set(k, ch);
  for (const layer of layers) for (const [k, ch] of layer) all.set(k, ch);
  prunePieces(all, 3);
  const out = toSprite(all);
  dabCache.set(standing, out);
  return out;
}

/** The celebration's loop: stand, wind up (the crouch), the dab hold, then back (the dab, crouched). */
export function dabFrames(form: FormId): readonly PixelSprite[] {
  const standing = composeFrame(FORM_FRAMES[form].idle[0]);
  const dab = dabSprite(form, standing);
  return [standing, crouchSprite(form, standing), dab, crouchSprite(form, dab)];
}
