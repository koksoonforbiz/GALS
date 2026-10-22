/**
 * Student-facing instructions for the puzzles, as approved in
 * docs/EF_battery_v2/ONLINE_ADAPTATION.md §3. Neutral wording only (this
 * ships in the student bundle): no task or construct names.
 */
export type TaskCode = 'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'w6' | 'w7';

/** Shown before the first step of each part (keyed by step.part). */
export const PART_INSTRUCTIONS: Record<string, string[]> = {
  fwd: [
    'Some numbers will appear one at a time. When they have finished, type them in the same order, then press Enter.',
  ],
  bwd: ['Now type the numbers backwards. For example, if you see 7 then 1, type 1 7.'],
  lns: [
    'A mix of numbers and letters will appear one at a time. When they have finished, type the numbers first, from smallest to largest, and then the letters in alphabetical order. For example, if you see 9 C 3, type 3 9 C.',
  ],
  'practice-plus': [
    'Add 3 to each number. Type the answer and press Enter.',
    'Let’s practise first.',
  ],
  'practice-minus': ['Subtract 3 from each number. Type the answer and press Enter.'],
  'practice-alt': ['Add 3, then subtract 3, in turn. Type the answer and press Enter.'],
  list1: [
    'Add 3 to each number.',
    'Type each answer and press Enter. Work as quickly as you can without making mistakes.',
  ],
  list2: [
    'Subtract 3 from each number.',
    'Type each answer and press Enter. Work as quickly as you can without making mistakes.',
  ],
  list3: [
    'Add 3 to the first number, subtract 3 from the second, add 3 to the third, and so on.',
    'Type each answer and press Enter. Work as quickly as you can without making mistakes.',
  ],
  letter1: [
    'Type as many words as you can that begin with the letter shown, as quickly as you can. Press Enter after each word.',
    'For example, for the letter N you might type nail, night, near. Do not use names of people or places, like Nancy or Nepal, and do not use numbers. Also, do not type the same word again with a different ending, like eat and eating. You will have one minute.',
  ],
  letter2: ['Next letter. The same rules apply. You will have one minute.'],
  letter3: ['Next letter. The same rules apply. You will have one minute.'],
  category: ['Now type as many different animals as you can. You have one minute.'],
  switch: [
    'Now switch back and forth between two kinds of things: one of the first kind, then one of the second kind, and so on.',
    'For example, if the kinds were colours and body parts, you would type red, arm, blue, leg. You have one minute.',
  ],
  A: [
    'Each sentence has its last word missing. As soon as you see it, type one word that completes the sentence so that it makes good sense, then press Enter. Be as quick as you can.',
  ],
  B: [
    'Now type a word that does not fit the sentence in any way — a word that has nothing to do with the sentence and makes it nonsense.',
    'For example, for “The rabbit hopped across the …”, you might type “umbrella”. Be as quick as you can.',
  ],
  'W-keys': [
    'Press the key for each word, going along the row.',
    'F = red, J = green, K = blue. Let’s learn the keys first.',
  ],
  'C-keys': [
    'Press the key for the colour of the ink of each item.',
    'F = red, J = green, K = blue.',
  ],
  'CW-keys': [
    'Press the key for the colour of the INK, not the word.',
    'F = red, J = green, K = blue.',
  ],
  P1: ['Click the circles in order: 1, 2, 3, and so on.'],
  P2: ['Click the circles in order, switching between numbers and letters: 1, A, 2, B, 3, C, …'],
};

export const GRID_INSTRUCTIONS: Record<'W' | 'C' | 'CW', string> = {
  W: 'Press the key for each word, going down each column.',
  C: 'Press the key for the colour of the ink of each item, going down each column.',
  CW: 'Press the key for the colour of the INK, not the word, going down each column.',
};
export const GRID_RULES =
  'F = red, J = green, K = blue. If you make a mistake, the item flashes red — press the right key and carry on. You have 45 seconds.';

export const TRAIL_TEST_INSTRUCTIONS: Record<'P1' | 'P2', string> = {
  P1: 'Click the numbers in order: 1, 2, 3, … up to 25, as quickly as you can.',
  P2: 'Switch between numbers and letters in order: 1, A, 2, B, 3, C, … up to 13, as quickly as you can.',
};

export const KEEP_GOING = 'Keep going — any other words?';
export const ANY_WORD = 'Any word';
export const BREAK_TEXT = 'Take a short break if you like. Continue when you are ready.';
