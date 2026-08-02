/* ============================================================
   COLWYN — Shopify Storefront Integration (shopify.js)
   Used by: shop.html ONLY. Do not include this file on any
   other page — it is the single source of truth for checkout.

   Flow: find the product's first available variant -> create a
   Shopify cart with that variant -> redirect to the returned
   checkoutUrl. Any button with the "js-shopify-checkout" class
   triggers this flow.
   ============================================================ */

const SHOPIFY = Object.freeze({
  endpoint: 'https://shopwithcolwyn.myshopify.com/api/2026-07/graphql.json',
  storefrontToken: '21a19528129a9871116d17a0311feb2e',
  productId: 'gid://shopify/Product/8632929747129'
});

const purchaseButtons = [...document.querySelectorAll('.js-shopify-checkout')];
const shopifyStatus = document.getElementById('shopifyStatus');
let checkoutInProgress = false;
let statusTimer;

/* Toggle the "Preparing checkout…" loading state on every checkout button */
function setCheckoutLoading(isLoading) {
  purchaseButtons.forEach(button => {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
    button.setAttribute('aria-disabled', String(isLoading));
    button.setAttribute('aria-busy', String(isLoading));
    button.innerHTML = isLoading ? 'Preparing checkout&hellip;' : button.dataset.originalLabel;
  });
}

/* Show a temporary error toast near the bottom of the screen */
function showShopifyError(message) {
  window.clearTimeout(statusTimer);
  shopifyStatus.textContent = message;
  shopifyStatus.hidden = false;
  statusTimer = window.setTimeout(() => { shopifyStatus.hidden = true; }, 8000);
}

/* Thin wrapper around a Storefront API GraphQL request */
async function shopifyRequest(query, variables) {
  const response = await fetch(SHOPIFY.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY.storefrontToken
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) throw new Error(`Shopify request failed (${response.status})`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map(error => error.message).join('; '));
  return payload.data;
}

/* Look up the product's first available variant, create a cart with it,
   and redirect the browser to Shopify's hosted checkout. */
async function createShopifyCheckout() {
  const productData = await shopifyRequest(`
    query ProductForCheckout($id: ID!) {
      product(id: $id) {
        variants(first: 250) {
          nodes { id availableForSale }
        }
      }
    }
  `, { id: SHOPIFY.productId });

  const variant = productData.product?.variants?.nodes?.find(item => item.availableForSale);
  if (!variant) throw new Error('No available product variant was found');

  const cartData = await shopifyRequest(`
    mutation CreateCart($input: CartInput!) {
      cartCreate(input: $input) {
        cart { checkoutUrl }
        userErrors { field message }
      }
    }
  `, { input: { lines: [{ merchandiseId: variant.id, quantity: 1 }] } });

  const cartResult = cartData.cartCreate;
  if (cartResult.userErrors?.length) {
    throw new Error(cartResult.userErrors.map(error => error.message).join('; '));
  }
  if (!cartResult.cart?.checkoutUrl) throw new Error('Shopify did not return a checkout URL');
  window.location.assign(cartResult.cart.checkoutUrl);
}

/* Wire up every checkout button on the page */
purchaseButtons.forEach(button => {
  button.addEventListener('click', async event => {
    event.preventDefault();
    if (checkoutInProgress) return;

    checkoutInProgress = true;
    shopifyStatus.hidden = true;
    setCheckoutLoading(true);

    try {
      await createShopifyCheckout();
    } catch (error) {
      console.error('Unable to create Shopify checkout:', error);
      showShopifyError('We couldn\'t start checkout right now. Please check your connection and try again.');
      checkoutInProgress = false;
      setCheckoutLoading(false);
    }
  });
});
