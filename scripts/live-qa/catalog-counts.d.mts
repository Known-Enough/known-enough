export interface CatalogCounts {tested:number;valid:number;invalid:number;needsPermission:number;needsClarification:number}
export function safeCatalogCounts(value:unknown):CatalogCounts|null;
