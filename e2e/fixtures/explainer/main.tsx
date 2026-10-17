// Test-only page: the real <Explainer> with a pause-at-step prompt, which no shipped lesson has yet (served by
// e2e/animation.spec.ts through a throwaway Vite server; never part of the app build).
import { createRoot } from 'react-dom/client';
import '../../../src/styles/tokens.css';
import '../../../src/styles/base.css';
import { Explainer, type PausePrompt } from '../../../src/components/Explainer';

const pauses: PausePrompt[] = [
  { step: 'compile', question: 'Which program reads your C source?', options: ['The editor', 'clang', 'The browser tab'], answer: 1, explain: 'clang runs inside the worker.' },
];

// ?pauses=0 renders the same player without the prompt.
const withPauses = new URLSearchParams(location.search).get('pauses') !== '0';
createRoot(document.getElementById('root')!).render(<Explainer id="a01-press-run" pauses={withPauses ? pauses : []} />);
