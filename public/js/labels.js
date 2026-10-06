/* Opens the print window for name tags, then returns to check-in.
   Inside the Printing page (embedded), it prints and tells the page it's done. */
(function () {
  'use strict';
  var body = document.body;
  var back = body.getAttribute('data-return') || '/checkin';
  var embed = body.hasAttribute('data-embed');
  var printBtn = document.querySelector('[data-print]');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  if (!body.hasAttribute('data-autoprint')) return;
  var done = false;
  var finish = function () {
    if (done) return;
    done = true;
    if (embed) { try { window.parent.postMessage({ type: 'ci-printed' }, window.location.origin); } catch (e) { /* ignore */ } return; }
    setTimeout(function () { window.location.href = back; }, 400);
  };
  window.addEventListener('afterprint', finish);
  var images = Array.prototype.slice.call(document.images);
  Promise.all(images.map(function (img) {
    return img.complete ? Promise.resolve() : new Promise(function (r) { img.onload = img.onerror = r; });
  })).then(function () {
    setTimeout(function () {
      window.print();
      // Some browsers don't fire afterprint inside a frame; print() blocks until the dialog closes.
      if (embed) setTimeout(finish, 500);
    }, 150);
  });
})();
