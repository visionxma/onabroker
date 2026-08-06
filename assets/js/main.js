(function () {
'use strict';
Menu mobile
---------------------------------------------------------------------- */
var toggle = document.querySelector('.nav-toggle');
var nav = document.querySelector('.site-nav');
if (toggle && nav) {
toggle.addEventListener('click', function () {
var isOpen = toggle.getAttribute('aria-expanded') === 'true';
toggle.setAttribute('aria-expanded', String(!isOpen));
nav.setAttribute('data-open', String(!isOpen));
});
nav.addEventListener('click', function (event) {
if (event.target.tagName === 'A') {
toggle.setAttribute('aria-expanded', 'false');
nav.setAttribute('data-open', 'false');
}
});
document.addEventListener('keydown', function (event) {
if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
toggle.setAttribute('aria-expanded', 'false');
nav.setAttribute('data-open', 'false');
toggle.focus();
}
});
}
Botão "voltar ao topo"
---------------------------------------------------------------------- */
var toTop = document.querySelector('.to-top');
if (toTop) {
var ticking = false;
var onScroll = function () {
if (ticking) return;
ticking = true;
window.requestAnimationFrame(function () {
toTop.classList.toggle('is-visible', window.scrollY > 700);
ticking = false;
});
};
window.addEventListener('scroll', onScroll, { passive: true });
toTop.addEventListener('click', function () {
var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
});
}
})();