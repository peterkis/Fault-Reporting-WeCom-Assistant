import type {BoardColumn} from '../../contracts/web01_workbench_contracts.js';

const columns = ['pending', 'active', 'handled'] as const satisfies readonly BoardColumn[];

function loadedColumn(column: BoardColumn): string {
  // Skeletons also use .column-cards. Only a resolved column has this body,
  // including when there are no cards to render.
  return `Boolean(document.querySelector('.board .board-column.${column} .ds-state-content > .column-cards#cards-${column}'))`;
}

export function boardColumnReady(column: BoardColumn): string {
  return `${loadedColumn(column)}&&!document.querySelector('.board .board-column.${column} [data-loading-status]')`;
}

export const boardColumnsReady = [
  ...columns.map(loadedColumn),
  "!document.querySelector('.board [data-loading-status]')",
].join('&&');
