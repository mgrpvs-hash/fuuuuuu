export interface CellPosition {
  top: number;
  left: number;
}

// 40 cells on perimeter, corners fixed for Monopoly orientation:
// 0: bottom-right START, 10: bottom-left JAIL, 20: top-left FREE PARKING, 30: top-right GO TO JAIL
export function getCellPosition(index: number): CellPosition {
  const slot = index % 40;
  const step = 100 / 10;
  if (slot <= 10) {
    return {
      top: 90,
      left: 90 - slot * step
    };
  }
  if (slot <= 20) {
    return {
      top: 90 - (slot - 10) * step,
      left: 0
    };
  }
  if (slot <= 30) {
    return {
      top: 0,
      left: (slot - 20) * step
    };
  }
  return {
    top: (slot - 30) * step,
    left: 90
  };
}

export function tokenOffset(positionInCell: number) {
  const row = Math.floor(positionInCell / 3);
  const col = positionInCell % 3;
  return {
    x: 8 + col * 18,
    y: 8 + row * 18
  };
}
