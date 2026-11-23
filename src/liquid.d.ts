export interface LiquidOptions {
  scale?: number;
  glass?: number;
  focus?: [number, number, number];
  side?: number;
  pointer?: boolean;
  manual?: boolean;
}
export function mountLiquid(canvas: HTMLCanvasElement, options?: LiquidOptions): { destroy(): void; set(options: LiquidOptions): void; draw(t: number, pointer?: [number, number]): void };
