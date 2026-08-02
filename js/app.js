/* ============================================================
   COLWYN — Shared JavaScript (app.js)
   Used by: index.html, shop.html
   Contains: FAQ accordion behavior, image lightbox behavior.
   No Shopify / checkout code lives here — see js/shopify.js,
   which is loaded only on shop.html.
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

/* ---------- Image lightbox ----------
   Matches both ".gallery-strip img" (index.html) and
   ".shop-gallery-strip img" (shop.html) so this one file
   covers both pages without needing markup changes. */
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

document.querySelectorAll('.gallery-strip img, .shop-gallery-strip img').forEach(img => {
  img.addEventListener('click', () => {
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightbox.classList.add('open');
  });
});

document.getElementById('lightboxClose').addEventListener('click', () => {
  lightbox.classList.remove('open');
});

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) lightbox.classList.remove('open');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lightbox.classList.remove('open');
});
