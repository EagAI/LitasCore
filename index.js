require('dotenv').config();

if (process.argv[2] === 'deploy') {
  require('./src/deploy-commands.js');
} else {
  require('./src/index.js');
}
