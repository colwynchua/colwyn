/* ============================================================
   COLWYN — Shared JavaScript (app.js)
   Used by: shop.html only (index.html no longer needs any JS
   after being simplified to a lightweight storytelling page).
   Contains: FAQ accordion behavior, product image gallery
   (click a thumbnail to swap the main product image).
   No Shopify / checkout code lives here — see js/shopify.js.
   ============================================================ */

/* ---------- FAQ accordion ---------- */
document.querySelectorAll('.faq-item').forEach(item => {
  const question = item.querySelector('.faq-q');
  const answer = item.querySelector('.faq-a');

  question.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');

    // Close every other open FAQ item first (single-open accordion behavior)
    document.querySelectorAll('.faq-item').forEach(otherItem => {
      otherItem.classList.remove('open');
      otherItem.querySelector('.faq-a').style.maxHeight = null;
    });

    if (!isOpen) {
      item.classList.add('open');
      answer.style.maxHeight = answer.scrollHeight + 'px';
    }
  });
});

/* ---------- Product image gallery ----------
   Clicking a thumbnail swaps the main product image in place
   (Amazon / modern Shopify style) — no popup/lightbox. A brief
   opacity fade (paired with the CSS transition on .shop-main-image)
   makes the swap feel smooth rather than an instant jump-cut. */
const mainProductImage = document.getElementById('mainProductImage');

if (mainProductImage) {
  document.querySelectorAll('.shop-gallery-strip img').forEach(thumb => {
    thumb.addEventListener('click', () => {
      mainProductImage.style.opacity = '0';

      window.setTimeout(() => {
        mainProductImage.src = thumb.src;
        mainProductImage.alt = thumb.alt;
        mainProductImage.style.opacity = '1';
      }, 150);

      document.querySelectorAll('.shop-gallery-strip figure').forEach(fig => {
        fig.classList.remove('active');
      });
      thumb.closest('figure').classList.add('active');
    });
  });
}
