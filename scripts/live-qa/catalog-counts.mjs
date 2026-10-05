export function safeCatalogCounts(value) {
    const keys = ['tested','valid','invalid','needsPermission','needsClarification'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) return null;
    if (keys.some(key => !Number.isInteger(value[key]) || value[key] < 0 || value[key] > 16) || value.tested < 1 || value.valid + value.invalid + value.needsPermission + value.needsClarification !== value.tested) return null;
    return Object.fromEntries(keys.map(key => [key,value[key]]));
}
