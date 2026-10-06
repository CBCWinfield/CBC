/* Reads the Code 128 barcode on Central pickup tags from a camera picture.
   Used when the browser has no built-in barcode reader (iPhone, iPad, Firefox). */
(function () {
  'use strict';
  var PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232',
  ].map(function (p) { return p.split('').map(Number); });
  var START_B = 104;
  var BIASES = [6, 0, 14];

  // Closest symbol for six runs (bar, space, bar, space, bar, space); -1 if nothing is close.
  function match(runs, at) {
    var sum = 0;
    for (var k = 0; k < 6; k++) sum += runs[at + k];
    var mod = sum / 11;
    var best = -1;
    var bestErr = 1e9;
    for (var v = 0; v < PATTERNS.length; v++) {
      var p = PATTERNS[v];
      var err = 0;
      for (var j = 0; j < 6; j++) { var d = runs[at + j] / mod - p[j]; err += d * d; }
      if (err < bestErr) { bestErr = err; best = v; }
    }
    return bestErr < 1.8 ? best : -1;
  }

  function isStop(runs, at) {
    if (at + 7 > runs.length) return false;
    var want = [2, 3, 3, 1, 1, 1, 2];
    var sum = 0;
    for (var k = 0; k < 7; k++) sum += runs[at + k];
    var mod = sum / 13;
    var err = 0;
    for (var j = 0; j < 7; j++) { var d = runs[at + j] / mod - want[j]; err += d * d; }
    return err < 1.6;
  }

  // runs[0] is a bar. Returns the decoded text, or null.
  function decodeRuns(runs) {
    for (var i = 0; i + 6 <= runs.length; i += 2) {
      if (match(runs, i) !== START_B) continue;
      var startWidth = runs[i] + runs[i + 1] + runs[i + 2] + runs[i + 3] + runs[i + 4] + runs[i + 5];
      if (i > 0 && runs[i - 1] < (startWidth / 11) * 3) continue; // need a light gap before the barcode
      var values = [];
      var j = i + 6;
      var ok = false;
      while (j + 6 <= runs.length && values.length < 40) {
        if (isStop(runs, j)) { ok = true; break; }
        var v = match(runs, j);
        if (v < 0 || v > 102) break;
        values.push(v);
        j += 6;
      }
      if (!ok || values.length < 2) continue;
      var check = values.pop();
      var sum = START_B;
      for (var n = 0; n < values.length; n++) sum += values[n] * (n + 1);
      if (sum % 103 !== check) continue;
      return values.map(function (x) { return String.fromCharCode(x + 32); }).join('');
    }
    return null;
  }

  // Turns one row of grey values into bar/space widths, with a threshold that follows the lighting.
  function rowRuns(grey, width, reverse, bias) {
    var w = Math.max(8, Math.round(width / 14));
    var pre = new Float64Array(width + 1);
    for (var x = 0; x < width; x++) pre[x + 1] = pre[x] + grey[x];
    var runs = [];
    var cur = null;
    var len = 0;
    for (var s = 0; s < width; s++) {
      var i = reverse ? width - 1 - s : s;
      var a = Math.max(0, i - w);
      var b = Math.min(width, i + w + 1);
      var mean = (pre[b] - pre[a]) / (b - a);
      var dark = grey[i] < mean - bias;
      if (cur === null) { if (!dark) continue; cur = true; len = 1; continue; }
      if (dark === cur) len++;
      else { runs.push(len); cur = dark; len = 1; }
    }
    if (len) runs.push(len);
    return runs;
  }

  function decodeImageData(img) {
    var width = img.width;
    var height = img.height;
    var data = img.data;
    var grey = new Float64Array(width);
    var step = Math.max(4, Math.round(height / 60));
    var mid = Math.round(height / 2);
    for (var off = 0; off < height / 2; off += step) {
      var ys = off ? [mid - off, mid + off] : [mid];
      for (var t = 0; t < ys.length; t++) {
        var y = ys[t];
        if (y < 0 || y >= height) continue;
        var base = y * width * 4;
        for (var x = 0; x < width; x++) {
          var p = base + x * 4;
          grey[x] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
        }
        for (var bi = 0; bi < BIASES.length; bi++) {
          var text = decodeRuns(rowRuns(grey, width, false, BIASES[bi])) || decodeRuns(rowRuns(grey, width, true, BIASES[bi]));
          if (text) return text;
        }
      }
    }
    return null;
  }

  window.Scan128 = { decodeImageData: decodeImageData, decodeRuns: decodeRuns };
})();
