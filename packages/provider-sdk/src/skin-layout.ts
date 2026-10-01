export type PartName = 'head' | 'torso' | 'arm' | 'leg';
export type Orientation = 'top' | 'bottom' | 'left' | 'front' | 'right' | 'back';
export type Face = {
  x: number;
  y: number;
  w: number;
  h: number;
  shade: number;
  orientation: Orientation;
};

const orientations: Orientation[] = ['top', 'bottom', 'left', 'front', 'right', 'back'];
const shades = [0.12, -0.2, -0.1, 0, -0.1, -0.2];

function faceSet(rects: Array<[number, number, number, number]>): Face[] {
  return rects.map(([x, y, w, h], index) => ({
    x,
    y,
    w,
    h,
    shade: shades[index % 6] ?? 0,
    orientation: orientations[index % 6] ?? 'front',
  }));
}

const staticFaces: Omit<Record<PartName, Face[]>, 'arm'> = {
  head: faceSet([
    [8, 0, 8, 8],
    [16, 0, 8, 8],
    [0, 8, 8, 8],
    [8, 8, 8, 8],
    [16, 8, 8, 8],
    [24, 8, 8, 8],
  ]),
  torso: faceSet([
    [20, 16, 8, 4],
    [28, 16, 8, 4],
    [16, 20, 4, 12],
    [20, 20, 8, 12],
    [28, 20, 4, 12],
    [32, 20, 8, 12],
  ]),
  leg: faceSet([
    [4, 16, 4, 4],
    [8, 16, 4, 4],
    [0, 20, 4, 12],
    [4, 20, 4, 12],
    [8, 20, 4, 12],
    [12, 20, 4, 12],
    [20, 48, 4, 4],
    [24, 48, 4, 4],
    [16, 52, 4, 12],
    [20, 52, 4, 12],
    [24, 52, 4, 12],
    [28, 52, 4, 12],
  ]),
};

function armFaces(armModel: 'steve' | 'alex'): Face[] {
  const width = armModel === 'alex' ? 3 : 4;
  return faceSet([
    [44, 16, width, 4],
    [44 + width, 16, width, 4],
    [40, 20, 4, 12],
    [44, 20, width, 12],
    [44 + width, 20, 4, 12],
    [48 + width, 20, width, 12],
    [36, 48, width, 4],
    [36 + width, 48, width, 4],
    [32, 52, 4, 12],
    [36, 52, width, 12],
    [36 + width, 52, 4, 12],
    [40 + width, 52, width, 12],
  ]);
}

export function baseFaces(armModel: 'steve' | 'alex'): Record<PartName, Face[]> {
  return { ...staticFaces, arm: armFaces(armModel) };
}

export function overlayFaces(armModel: 'steve' | 'alex'): Record<PartName, Face[]> {
  const width = armModel === 'alex' ? 3 : 4;
  return {
    head: faceSet([
      [40, 0, 8, 8],
      [48, 0, 8, 8],
      [32, 8, 8, 8],
      [40, 8, 8, 8],
      [48, 8, 8, 8],
      [56, 8, 8, 8],
    ]),
    torso: faceSet([
      [20, 32, 8, 4],
      [28, 32, 8, 4],
      [16, 36, 4, 12],
      [20, 36, 8, 12],
      [28, 36, 4, 12],
      [32, 36, 8, 12],
    ]),
    arm: faceSet([
      [44, 32, width, 4],
      [44 + width, 32, width, 4],
      [40, 36, 4, 12],
      [44, 36, width, 12],
      [44 + width, 36, 4, 12],
      [48 + width, 36, width, 12],
      [52, 48, width, 4],
      [52 + width, 48, width, 4],
      [48, 52, 4, 12],
      [52, 52, width, 12],
      [52 + width, 52, 4, 12],
      [56 + width, 52, width, 12],
    ]),
    leg: faceSet([
      [4, 32, 4, 4],
      [8, 32, 4, 4],
      [0, 36, 4, 12],
      [4, 36, 4, 12],
      [8, 36, 4, 12],
      [12, 36, 4, 12],
      [4, 48, 4, 4],
      [8, 48, 4, 4],
      [0, 52, 4, 12],
      [4, 52, 4, 12],
      [8, 52, 4, 12],
      [12, 52, 4, 12],
    ]),
  };
}
