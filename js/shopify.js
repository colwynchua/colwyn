/* ============================================================
   COLWYN — Shopify Storefront Integration (shopify.js)
   Used by: shop.html ONLY.

   FLOW:
   Add to Cart -> item is added to a real Shopify cart, and the
   cart DRAWER opens so the customer can review quantity/subtotal,
   change quantity, or remove the item. Checkout only happens when
   the customer clicks "Proceed to Checkout" inside the drawer —
   Add to Cart itself never redirects straight to checkout.

   BUNDLE PRICING ARCHITECTURE (approved): each bundle will be its
   own separate Shopify product/variant with its own fixed price
   ($27.99 / $49.99 / $59.99), NOT the same variant at a multiplied
   quantity. This guarantees the displayed price and the price
   Shopify actually charges can never disagree.

   CURRENT STATUS: only "Single Copy" (Buy 1) has a real variant
   today — it's the store's one existing product. "Family Pack" and
   "Best Value Bundle" are disabled placeholders (see the
   `bundleCards` section below) until their own priced variants
   exist in Shopify and their variant IDs are added to
   BUNDLE_VARIANT_IDS. Add to Cart always adds the Single Copy
   variant right now, regardless of card selection, because it's
   the only one that's real.
   ============================================================ */

const SHOPIFY = Object.freeze({
  endpoint: 'https://shopwithcolwyn.myshopify.com/api/2026-07/graphql.json',
  storefrontToken: '21a19528129a9871116d17a0311feb2e',
  productId: 'gid://shopify/Product/8632929747129'
});

// Once real bundle variants exist, add their IDs here (e.g.
// 'family-pack': 'gid://shopify/ProductVariant/...') and switch
// Add to Cart to look up the selected card's variant via this map
// instead of always using SHOPIFY.productId's single variant.
const BUNDLE_VARIANT_IDS = Object.freeze({
  single: null,       // uses SHOPIFY.productId's own variant — always real
  'family-pack': null, // not yet created in Shopify
  'best-value': null   // not yet created in Shopify
});

const CART_ID_STORAGE_KEY = 'colwynCartId';


/* ---------- DOM references ---------- */
const purchaseButtons = [...document.querySelectorAll('.js-shopify-checkout')];
const shopifyStatus = document.getElementById('shopifyStatus');

const cartOverlay = document.getElementById('cartOverlay');
const cartDrawer = document.getElementById('cartDrawer');
const cartDrawerClose = document.getElementById('cartDrawerClose');
const cartDrawerBody = document.getElementById('cartDrawerBody');
const cartDrawerSubtotal = document.getElementById('cartDrawerSubtotal');
const cartCheckoutBtn = document.getElementById('cartCheckoutBtn');
const cartIconButton = document.getElementById('cartIconButton');
const cartCountBadge = document.getElementById('cartCountBadge');

let checkoutInProgress = false;
let statusTimer;
let currentCart = null; // last-known cart state, kept in sync after every mutation

/* ---------- Bundle card selection (visual only) ----------
   IMPORTANT: cards with the "disabled" class (Family Pack, Best Value —
   not yet backed by a real Shopify variant) are completely inert. Clicking
   or pressing Enter/Space on them does nothing at all: no selection change,
   no visual change, and critically, no silent fallback to adding the
   Single Copy variant. Only the Single Copy card is interactive today. */
const bundleCards = [...document.querySelectorAll('.bundle-card[data-bundle]')];

bundleCards.forEach(card => {
  card.addEventListener('click', () => selectBundleCard(card));
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectBundleCard(card);
    }
  });
});

function selectBundleCard(card) {
  if (card.classList.contains('disabled')) return; // inert — see note above

  bundleCards.forEach(c => {
    c.classList.remove('selected');
    c.setAttribute('aria-checked', 'false');
  });
  card.classList.add('selected');
  card.setAttribute('aria-checked', 'true');
}

/* ---------- Loading / error UI ---------- */
function setCheckoutLoading(isLoading) {
  purchaseButtons.forEach(button => {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
    button.setAttribute('aria-disabled', String(isLoading));
    button.setAttribute('aria-busy', String(isLoading));
    button.innerHTML = isLoading ? 'Adding&hellip;' : button.dataset.originalLabel;
  });
}

function showShopifyError(message) {
  window.clearTimeout(statusTimer);
  shopifyStatus.textContent = message;
  shopifyStatus.hidden = false;
  statusTimer = window.setTimeout(() => { shopifyStatus.hidden = true; }, 8000);
}

/* ---------- Storefront API request helper ---------- */
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

/* ---------- GraphQL documents ---------- */
const CART_FIELDS = `
  id
  checkoutUrl
  cost { subtotalAmount { amount currencyCode } }
  lines(first: 50) {
    edges {
      node {
        id
        quantity
        merchandise {
          ... on ProductVariant {
            id
            title
            image { url altText }
            price { amount currencyCode }
            product { title }
          }
        }
        cost { totalAmount { amount currencyCode } }
      }
    }
  }
`;

const FIND_PRODUCT_QUERY = `
  query FindProduct($id: ID!) {
    product(id: $id) {
      variants(first: 250) {
        nodes { id availableForSale }
      }
    }
  }
`;

const CART_QUERY = `query GetCart($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`;

const CART_CREATE = `
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

const CART_LINES_ADD = `
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

const CART_LINES_UPDATE = `
  mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

const CART_LINES_REMOVE = `
  mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

/* ---------- Cart persistence + mutations ---------- */
function getStoredCartId() {
  return window.localStorage.getItem(CART_ID_STORAGE_KEY);
}

function setStoredCartId(cartId) {
  window.localStorage.setItem(CART_ID_STORAGE_KEY, cartId);
}

function clearStoredCartId() {
  window.localStorage.removeItem(CART_ID_STORAGE_KEY);
}

/** Fetch the existing cart, if any. Returns null if there is no stored
 *  cart, or if the stored cart is no longer valid (e.g. expired). */
async function fetchExistingCart() {
  const cartId = getStoredCartId();
  if (!cartId) return null;

  try {
    const data = await shopifyRequest(CART_QUERY, { id: cartId });
    if (!data.cart) {
      clearStoredCartId();
      return null;
    }
    return data.cart;
  } catch (error) {
    console.error('Could not fetch existing cart, starting fresh:', error);
    clearStoredCartId();
    return null;
  }
}

async function findFirstAvailableVariantId() {
  const data = await shopifyRequest(FIND_PRODUCT_QUERY, { id: SHOPIFY.productId });
  const variant = data.product?.variants?.nodes?.find(v => v.availableForSale);
  if (!variant) throw new Error('No available product variant was found');
  return variant.id;
}

/** Add 1 unit of the given variant to the cart, creating a new cart if
 *  none exists yet, or updating the existing line's quantity if the
 *  product is already in the cart (rather than stacking a duplicate line). */
async function addOneUnitToCart(variantId) {
  let cart = await fetchExistingCart();

  if (!cart) {
    const data = await shopifyRequest(CART_CREATE, {
      lines: [{ merchandiseId: variantId, quantity: 1 }]
    });
    if (data.cartCreate.userErrors?.length) {
      throw new Error(data.cartCreate.userErrors.map(e => e.message).join('; '));
    }
    cart = data.cartCreate.cart;
    setStoredCartId(cart.id);
    return cart;
  }

  const existingLine = cart.lines.edges.find(edge => edge.node.merchandise.id === variantId);

  if (existingLine) {
    return updateLineQuantity(cart.id, existingLine.node.id, existingLine.node.quantity + 1);
  }

  const data = await shopifyRequest(CART_LINES_ADD, {
    cartId: cart.id,
    lines: [{ merchandiseId: variantId, quantity: 1 }]
  });
  if (data.cartLinesAdd.userErrors?.length) {
    throw new Error(data.cartLinesAdd.userErrors.map(e => e.message).join('; '));
  }
  return data.cartLinesAdd.cart;
}

async function updateLineQuantity(cartId, lineId, quantity) {
  const data = await shopifyRequest(CART_LINES_UPDATE, {
    cartId,
    lines: [{ id: lineId, quantity }]
  });
  if (data.cartLinesUpdate.userErrors?.length) {
    throw new Error(data.cartLinesUpdate.userErrors.map(e => e.message).join('; '));
  }
  return data.cartLinesUpdate.cart;
}

async function removeLine(cartId, lineId) {
  const data = await shopifyRequest(CART_LINES_REMOVE, { cartId, lineIds: [lineId] });
  if (data.cartLinesRemove.userErrors?.length) {
    throw new Error(data.cartLinesRemove.userErrors.map(e => e.message).join('; '));
  }
  return data.cartLinesRemove.cart;
}

/* ---------- Cart drawer rendering ---------- */
function formatMoney(amount, currencyCode) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(Number(amount));
}

function renderCart(cart) {
  currentCart = cart;
  const lines = cart?.lines?.edges ?? [];
  const totalQuantity = lines.reduce((sum, edge) => sum + edge.node.quantity, 0);

  // Nav badge
  if (totalQuantity > 0) {
    cartCountBadge.textContent = String(totalQuantity);
    cartCountBadge.hidden = false;
  } else {
    cartCountBadge.hidden = true;
  }

  // Empty state
  if (lines.length === 0) {
    cartDrawerBody.innerHTML = '<p class="cart-empty-message">Your cart is empty.</p>';
    cartDrawerSubtotal.textContent = formatMoney(0, 'USD');
    cartCheckoutBtn.disabled = true;
    return;
  }

  cartDrawerBody.innerHTML = '';
  lines.forEach(edge => {
    const line = edge.node;
    const variant = line.merchandise;
    const row = document.createElement('div');
    row.className = 'cart-line-item';
    row.innerHTML = `
      ${variant.image ? `<img src="${variant.image.url}" alt="${variant.image.altText ?? variant.product.title}">` : ''}
      <div style="flex:1;">
        <div class="cart-line-item-title">${variant.product.title}</div>
        <div class="cart-line-item-price">${formatMoney(line.cost.totalAmount.amount, line.cost.totalAmount.currencyCode)}</div>
        <div class="cart-qty-stepper">
          <button type="button" class="cart-qty-decrease" aria-label="Decrease quantity">&minus;</button>
          <span>${line.quantity}</span>
          <button type="button" class="cart-qty-increase" aria-label="Increase quantity">+</button>
          <button type="button" class="cart-line-remove">Remove</button>
        </div>
      </div>
    `;

    row.querySelector('.cart-qty-decrease').addEventListener('click', () => handleQuantityChange(line, -1));
    row.querySelector('.cart-qty-increase').addEventListener('click', () => handleQuantityChange(line, 1));
    row.querySelector('.cart-line-remove').addEventListener('click', () => handleRemoveLine(line));

    cartDrawerBody.appendChild(row);
  });

  cartDrawerSubtotal.textContent = formatMoney(cart.cost.subtotalAmount.amount, cart.cost.subtotalAmount.currencyCode);
  cartCheckoutBtn.disabled = false;
}

async function handleQuantityChange(line, delta) {
  const newQuantity = line.quantity + delta;
  try {
    if (newQuantity < 1) {
      const cart = await removeLine(currentCart.id, line.id);
      renderCart(cart);
    } else {
      const cart = await updateLineQuantity(currentCart.id, line.id, newQuantity);
      renderCart(cart);
    }
  } catch (error) {
    console.error('Could not update cart quantity:', error);
    showShopifyError('Could not update your cart. Please try again.');
  }
}

async function handleRemoveLine(line) {
  try {
    const cart = await removeLine(currentCart.id, line.id);
    renderCart(cart);
  } catch (error) {
    console.error('Could not remove item from cart:', error);
    showShopifyError('Could not remove that item. Please try again.');
  }
}

/* ---------- Drawer open/close ---------- */
function openCartDrawer() {
  cartOverlay.hidden = false;
  cartDrawer.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
}

function closeCartDrawer() {
  cartOverlay.hidden = true;
  cartDrawer.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
}

cartIconButton.addEventListener('click', async () => {
  openCartDrawer();
  // Always show fresh data when the customer opens the cart manually
  const cart = await fetchExistingCart();
  renderCart(cart ?? { lines: { edges: [] } });
});

cartDrawerClose.addEventListener('click', closeCartDrawer);
cartOverlay.addEventListener('click', closeCartDrawer);
document.getElementById('cartContinueBtn').addEventListener('click', closeCartDrawer);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCartDrawer();
});

/* ---------- Proceed to Checkout — the ONLY place that redirects ---------- */
cartCheckoutBtn.addEventListener('click', () => {
  if (currentCart?.checkoutUrl) {
    window.location.assign(currentCart.checkoutUrl);
  }
});

/* ---------- Add to Cart ---------- */
purchaseButtons.forEach(button => {
  button.addEventListener('click', async event => {
    event.preventDefault();
    if (checkoutInProgress) return;

    checkoutInProgress = true;
    shopifyStatus.hidden = true;
    setCheckoutLoading(true);

    try {
      const variantId = await findFirstAvailableVariantId();
      const cart = await addOneUnitToCart(variantId);
      renderCart(cart);
      openCartDrawer();
    } catch (error) {
      console.error('Unable to add item to cart:', error);
      showShopifyError('We couldn\'t add that to your cart right now. Please try again.');
    } finally {
      checkoutInProgress = false;
      setCheckoutLoading(false);
    }
  });
});
