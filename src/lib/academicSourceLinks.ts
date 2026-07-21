export function buildDoiUrl(doi: string) {
  const [prefix, ...suffixSegments] = doi.trim().split('/')
  if (!prefix || suffixSegments.length === 0) return null
  return `https://doi.org/${encodeURIComponent(prefix)}/${suffixSegments
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}
