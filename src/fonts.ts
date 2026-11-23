// Fonts are bundled (no network needed) so the preview and the headless export renderer match.
import '@fontsource/assistant/400.css';
import '@fontsource/assistant/500.css';
import '@fontsource/assistant/600.css';
import '@fontsource/assistant/700.css';
import '@fontsource/assistant/800.css';
import '@fontsource/karantina/400.css';
import '@fontsource/karantina/700.css';
import '@fontsource/anton/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/press-start-2p/400.css';

export const FONT_WEIGHTS: Record<string, number[]> = {
  Assistant: [400, 500, 600, 700, 800],
  Karantina: [400, 700],
  Anton: [400],
  Inter: [400, 600, 700, 800],
  'JetBrains Mono': [500, 700],
  'Press Start 2P': [400],
};

/** Canvas text needs every face loaded up front; Hebrew and Latin subsets are separate files. */
export async function loadFonts() {
  const jobs: Promise<unknown>[] = [];
  for (const [family, weights] of Object.entries(FONT_WEIGHTS)) {
    for (const w of weights) {
      jobs.push(document.fonts.load(`${w} 40px "${family}"`, 'Hello 123'));
      if (family === 'Assistant' || family === 'Karantina') jobs.push(document.fonts.load(`${w} 40px "${family}"`, 'שלום עולם'));
    }
  }
  await Promise.allSettled(jobs);
  // the user's own fonts (uploaded and Google Fonts): the same stylesheet for the editor and the export renderer
  const { loadCustomFonts } = await import('./customFonts');
  await loadCustomFonts();
  await document.fonts.ready;
}
