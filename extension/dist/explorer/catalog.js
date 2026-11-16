// The product list (ProductInfos) shared by autocomplete, product search and the product card.
// One request, kept for the page's lifetime; `fresh` loads it again.
const QUERY = `query {
  ProductInfos {
    date
    data {
      ProductID
      Product
      Name
      ProductISIN
      ProductType
      ProductTypeCode
      ProductLine
      Currency
    }
  }
}`;

let pending = null;
let pendingFor = null;

export function fetchProductCatalog(client, { fresh = false } = {}) {
    const key = `${client.endpoint}|${client.apiKey}`;
    if (!pending || fresh || pendingFor !== key) {
        pendingFor = key;
        pending = client.request(QUERY, null, true, { fresh }).then(res => (res.data || []).filter(p => p && p.Product))
            .catch(err => { pending = null; throw err; });
    }
    return pending;
}

export const resetProductCatalog = () => { pending = null; pendingFor = null; };

// Lower-cased text a product is searched by
export const productHaystack = (p, extra = []) => [p.Product, p.Name, p.ProductISIN, p.ProductType, p.Currency, ...extra]
    .filter(Boolean).join(' ').toLowerCase();
