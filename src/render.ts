// Loaded by headless Chrome during export: draws the text layer with the same code as the preview.
import { loadFonts } from './fonts';
import { drawOverlay } from '../shared/renderText';
import type { Project } from '../shared/types';

let project: Project;
let canvas: HTMLCanvasElement;
const w = window as any;
w.__setProject = (p: Project) => {
  project = p;
  canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
};
w.__renderEmpty = () => {
  canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
};
w.__renderAt = (t: number) => {
  drawOverlay(canvas.getContext('2d')!, project, t);
  return canvas.toDataURL('image/png');
};
loadFonts().then(() => (w.__ready = true));
