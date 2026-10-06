'use strict';
// The swaying wheat field from the homepage design (two stalk drawings, placed 91 times).
const fs = require('fs');
const path = require('path');
const { raw } = require('../lib/html');

const markup = fs.readFileSync(path.join(__dirname, 'wheat.html'), 'utf8');
module.exports = () => raw(markup);
