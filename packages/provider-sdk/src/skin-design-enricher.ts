import {
  skinComponentNames,
  type PixelGrid,
  type SkinComponentName,
  type SkinDesign,
} from './skin-design-schema.js';

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function distance(first: Rgb, second: Rgb): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function seedOf(design: SkinDesign): number {
  const text = [
    design.concept.silhouette,
    design.concept.outfit,
    ...design.concept.signature_details,
  ].join('|');
  let seed = 0x811c9dc5;
  for (const character of text) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 0x01000193);
  }
  return seed >>> 0;
}

function alternatives(design: SkinDesign, symbol: string): string[] {
  const source = rgb(design.palette[symbol] ?? '#000000');
  return Object.keys(design.palette)
    .filter((candidate) => candidate !== symbol)
    .sort(
      (first, second) =>
        distance(source, rgb(design.palette[first]!)) -
        distance(source, rgb(design.palette[second]!)),
    );
}

function replaceAt(row: string, x: number, symbol: string): string {
  return row.slice(0, x) + symbol + row.slice(x + 1);
}

function detailFront(design: SkinDesign, component: SkinComponentName, seed: number): void {
  const grid = design.front[component];
  const width = grid[0]!.length;
  const minimumRows = component === 'head' ? 5 : component === 'torso' ? 6 : 2;
  const minimumColors = component === 'head' || component === 'torso' ? 3 : 2;
  let cursor = 0;

  for (let step = 0; step < minimumRows && new Set(grid).size < minimumRows; step += 1) {
    const y = step % grid.length;
    const x = (seed + step) % width;
    const current = grid[y]![x]!;
    const choices = alternatives(design, current);
    const next = choices[step % Math.min(3, choices.length)] ?? current;
    grid[y] = replaceAt(grid[y]!, x, next);
  }

  while (new Set(grid).size < minimumRows && cursor < grid.length * 3) {
    const counts = new Map<string, number>();
    for (const row of grid) counts.set(row, (counts.get(row) ?? 0) + 1);
    const y = (seed + cursor * 5) % grid.length;
    const row = grid[y]!;
    if ((counts.get(row) ?? 0) > 1) {
      const x = (seed + cursor * 3 + y) % width;
      const current = row[x]!;
      const choices = alternatives(design, current);
      const next = choices[(seed + cursor) % Math.min(3, choices.length)] ?? current;
      grid[y] = replaceAt(row, x, next);
    }
    cursor += 1;
  }

  cursor = 0;
  while (new Set(grid.join('')).size < minimumColors && cursor < grid.length * 2) {
    const y = (seed + cursor * 7) % grid.length;
    const x = cursor % 2 === 0 ? 0 : width - 1;
    const current = grid[y]![x]!;
    const next = alternatives(design, current)[cursor % 2] ?? current;
    grid[y] = replaceAt(grid[y]!, x, next);
    cursor += 1;
  }
}

function boundaryCells(grid: PixelGrid): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y]!.length; x += 1) {
      const symbol = grid[y]![x];
      const boundary =
        x === 0 ||
        x === grid[y]!.length - 1 ||
        y === 0 ||
        y === grid.length - 1 ||
        grid[y]![x - 1] !== symbol ||
        grid[y]![x + 1] !== symbol ||
        grid[y - 1]?.[x] !== symbol ||
        grid[y + 1]?.[x] !== symbol;
      if (boundary) cells.push({ x, y });
    }
  }
  return cells;
}

function visibleOverlay(design: SkinDesign): {
  pixels: number;
  components: Set<SkinComponentName>;
} {
  let pixels = 0;
  const components = new Set<SkinComponentName>();
  for (const layer of [design.overlay_front, design.overlay_back]) {
    for (const component of skinComponentNames) {
      const count = layer[component].join('').replaceAll('.', '').length;
      pixels += count;
      if (count > 0) components.add(component);
    }
  }
  return { pixels, components };
}

function addOverlayDetails(design: SkinDesign, seed: number): void {
  const ranked = skinComponentNames
    .filter((component) => component !== 'head')
    .sort(
      (first, second) =>
        boundaryCells(design.front[second]).length - boundaryCells(design.front[first]).length,
    );
  const targets: SkinComponentName[] = ['head', ranked[seed % ranked.length] ?? 'torso'];
  let state = visibleOverlay(design);

  for (const component of targets) {
    if (state.components.has(component)) continue;
    const cells = boundaryCells(design.front[component]);
    for (let index = 0; index < Math.min(4, cells.length); index += 1) {
      const cell = cells[(seed + index * 7) % cells.length]!;
      const source = design.front[component][cell.y]![cell.x]!;
      const symbol = alternatives(design, source)[0] ?? source;
      design.overlay_front[component][cell.y] = replaceAt(
        design.overlay_front[component][cell.y]!,
        cell.x,
        symbol,
      );
    }
    state = visibleOverlay(design);
  }

  let cursor = 0;
  while ((state.pixels < 12 || state.components.size < 2) && cursor < 80) {
    const component = targets[cursor % targets.length]!;
    const cells = boundaryCells(design.front[component]);
    const cell = cells[(seed + cursor * 11) % cells.length]!;
    const source = design.front[component][cell.y]![cell.x]!;
    const symbol = alternatives(design, source)[cursor % 2] ?? source;
    design.overlay_front[component][cell.y] = replaceAt(
      design.overlay_front[component][cell.y]!,
      cell.x,
      symbol,
    );
    state = visibleOverlay(design);
    cursor += 1;
  }
}

/**
 * 对 LLM 已决定的调色板和区域进行通用边界精修。
 * 算法不认识发型或服装类型，因此不会重新引入固定人物模板。
 */
export function enrichSkinDesignDraft(draft: SkinDesign): SkinDesign {
  const design = structuredClone(draft);
  const seed = seedOf(design);
  skinComponentNames.forEach((component, index) =>
    detailFront(design, component, seed + index * 131),
  );

  const visible = new Set(
    [design.front, design.back]
      .flatMap((layer) => Object.values(layer))
      .flatMap((grid) => grid)
      .join(''),
  );
  const missing = Object.keys(design.palette).filter((symbol) => !visible.has(symbol));
  for (let index = 0; visible.size < 6 && index < missing.length; index += 1) {
    const grid = design.front.torso;
    const y = (seed + index * 5) % grid.length;
    const x = (seed + index * 3) % grid[y]!.length;
    grid[y] = replaceAt(grid[y]!, x, missing[index]!);
    visible.add(missing[index]!);
  }

  addOverlayDetails(design, seed);
  return design;
}
