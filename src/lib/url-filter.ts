// L0 URL classifier — decides whether a URL is likely a product page.
// Pure regex, zero HTTP cost. Blocks non-product URLs before expensive Jina L2 fetch.

const PRODUCT_PATH_RE = /\/(product|products|item|items|p|dp|sku|catalog|shop|store|buy|listing|listings|goods|detail|pd|plp|pdp)\//i
const PRODUCT_SLUG_RE = /\/[a-z0-9%\-_]{3,}\/[a-z0-9%\-_]{4,}(?:\.html?)?(?:\?.*)?$/i
const PRODUCT_ID_RE  = /\/[a-z0-9\-_]*\d{4,}[a-z0-9\-_]*(?:\.html?)?(?:\?.*)?$/i

const JUNK_PATH_RE = /\/(blog|news|article|articles|post|posts|about|contact|help|faq|support|category|categories|tag|tags|search|cart|checkout|account|login|register|wishlist|compare|sitemap|privacy|terms|press|careers|404)\b/i
// Root or single-segment path (e.g. /en, /us, /)
const SHALLOW_PATH_RE = /^\/[^/]{0,5}(?:\?.*)?$/

// Well-known retail domains — any deep path (3+ segments) is likely a product page
const RETAIL_DOMAINS_RE = /\b(amazon|ebay|walmart|bunnings|mitre10|trademe|harveynorman|jbhifi|officeworks|kmart|target|woolworths|coles|aldi|ikea|homedepot|lowes|grainger|toolstation|toolswarehouse|supercheap|repco|autobarn|screwfix|toolstation|b\&q|brico|leroy)\b/i

export function isProductPageUrl(url: string): boolean {
  try {
    const { pathname, hostname } = new URL(url)
    const path = pathname.toLowerCase()

    // Explicit rejection — non-product paths
    if (JUNK_PATH_RE.test(path)) return false
    if (SHALLOW_PATH_RE.test(path)) return false

    // Explicit acceptance — product path segment
    if (PRODUCT_PATH_RE.test(path)) return true

    // Known retail domains: any path with 3+ segments is likely a product
    if (RETAIL_DOMAINS_RE.test(hostname) && pathname.split('/').filter(Boolean).length >= 2) return true

    // Product slug: two deep path segments (e.g. /brand/model-123)
    if (PRODUCT_SLUG_RE.test(path)) return true

    // Numeric product ID in path
    if (PRODUCT_ID_RE.test(path)) return true

    return false
  } catch {
    return false
  }
}
