/* Opens the print window for name tags, then returns to check-in. */
(function () {
  'use strict';
  var body = document.body;
  var back = body.getAttribute('data-return') || '/checkin';
  var printBtn = document.querySelector('[data-print]');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  if (!body.hasAttribute('data-autoprint')) return;
  var done = false;
  var goBack = function () { if (done) return; done = true; setTimeout(function () { window.location.href = back; }, 400); };
  window.addEventListener('afterprint', goBack);
  var images = Array.prototype.slice.call(document.images);
  Promise.all(images.map(function (img) {
    return img.complete ? Promise.resolve() : new Promise(function (r) { img.onload = img.onerror = r; });
  })).then(function () { setTimeout(function () { window.print(); }, 150); });
})();
