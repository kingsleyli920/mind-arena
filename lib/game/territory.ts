/** 两个地图视图共用的 territory-grid.json 格式。grid 是 base64 编码的郡国索引。 */
export interface TerritoryGrid {
  meta: { west: number; north: number; cellSize: number; cols: number; rows: number; none: number };
  order: string[];
  grid: string;
}
